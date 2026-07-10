'use client'

import type { MutableRefObject } from 'react'
import type { DetectedPeak } from '@/types/advisory'
import type { WorkerInboundMessage, WorkerOutboundMessage } from '@/lib/dsp/dspWorker'
import { logWarn } from '@/lib/utils/logger'
import type {
  DSPWorkerCallbacks,
  PendingHistorySyncRequest,
  PendingPeakFrame,
  WorkerInitSnapshot,
} from './dspWorkerTypes'

const MAX_RESTARTS = 3
const RESTART_DELAY_MS = 500
// Keep a short queue so we smooth over brief worker stalls without letting
// stale peak frames build seconds of extra wall-clock latency.
const MAX_PENDING_PEAKS = 4
const MAX_PENDING_PEAK_AGE_MS = 250
// Dev-only profiler — JSON.stringify on every tracksUpdate is measurable (~150 ms/sec)
// in dev builds. Opt-in via ?profile=tracks so normal dev sessions don't pay it.
const SHOULD_PROFILE_TRACK_PAYLOAD =
  typeof window !== 'undefined' &&
  process.env.NODE_ENV !== 'production' &&
  new URLSearchParams(window.location.search).get('profile') === 'tracks'
const TRACK_PAYLOAD_ENCODER = SHOULD_PROFILE_TRACK_PAYLOAD ? new TextEncoder() : null

interface PeakPoolRefs {
  specPoolRef: MutableRefObject<Float32Array[]>
  tdPoolRef: MutableRefObject<Float32Array[]>
  poolFftSizeRef: MutableRefObject<number>
}

export interface DSPWorkerHandlerRefs extends PeakPoolRefs {
  workerRef: MutableRefObject<Worker | null>
  callbacksRef: MutableRefObject<DSPWorkerCallbacks>
  isReadyRef: MutableRefObject<boolean>
  busyRef: MutableRefObject<boolean>
  pendingPeakQueueRef: MutableRefObject<PendingPeakFrame[]>
  droppedFramesRef: MutableRefObject<number>
  crashedRef: MutableRefObject<boolean>
  permanentlyDeadRef: MutableRefObject<boolean>
  restartCountRef: MutableRefObject<number>
  restartTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  lastInitRef: MutableRefObject<WorkerInitSnapshot | null>
  pendingHistorySyncRef: MutableRefObject<PendingHistorySyncRequest | null>
  pendingResetGenerationRef: MutableRefObject<number | null>
  clearPendingResetOnReadyRef: MutableRefObject<boolean>
  specUpdatePoolRef: MutableRefObject<Float32Array[]>
  outboundMessagesRef: MutableRefObject<number>
  inboundMessagesRef: MutableRefObject<number>
  tracksUpdatesRef: MutableRefObject<number>
  lastTracksPayloadBytesRef: MutableRefObject<number>
  maxTracksPayloadBytesRef: MutableRefObject<number>
}

function scoreDetectedPeak(peak: DetectedPeak): number {
  let score = 0

  if (peak.msdIsHowl) score += 6
  if (peak.msdFastConfirm) score += 5
  if (peak.isHighlyPersistent) score += 3
  else if (peak.isPersistent) score += 1.5
  if (peak.isSubHarmonicRoot) score += 1
  if (peak.harmonicOfHz != null) score -= 4

  score += Math.max(0, Math.min(24, peak.prominenceDb)) / 6
  score += Math.max(0, Math.min(120, peak.qEstimate ?? 0)) / 40
  score += Math.max(0, Math.min(30, peak.phpr ?? 0)) / 10
  score += Math.max(0, Math.min(400, peak.confirmLatencyMs ?? peak.sustainedMs ?? 0)) / 400

  return score
}

function comparePeakPriority(
  aPeak: DetectedPeak,
  aQueuedAtMs: number,
  bPeak: DetectedPeak,
  bQueuedAtMs: number,
): number {
  const byScore = scoreDetectedPeak(bPeak) - scoreDetectedPeak(aPeak)
  if (Math.abs(byScore) > 0.001) return byScore

  const byTimestamp = bPeak.timestamp - aPeak.timestamp
  if (byTimestamp !== 0) return byTimestamp

  return aQueuedAtMs - bQueuedAtMs
}

function comparePendingPeakPriority(a: PendingPeakFrame, b: PendingPeakFrame): number {
  return comparePeakPriority(a.peak, a.queuedAtMs, b.peak, b.queuedAtMs)
}

function findBestPendingPeakIndex(queue: PendingPeakFrame[]): number {
  let bestIndex = 0
  for (let i = 1; i < queue.length; i++) {
    if (comparePendingPeakPriority(queue[i], queue[bestIndex]) < 0) {
      bestIndex = i
    }
  }
  return bestIndex
}

function findWeakestPendingPeakIndex(queue: PendingPeakFrame[]): number {
  let weakestIndex = 0
  for (let i = 1; i < queue.length; i++) {
    if (comparePendingPeakPriority(queue[i], queue[weakestIndex]) > 0) {
      weakestIndex = i
    }
  }
  return weakestIndex
}

export function createDSPWorker(): Worker {
  return new Worker(new URL('../lib/dsp/dspWorker.ts', import.meta.url), {
    type: 'module',
  })
}

function writePendingPeakFrame(
  existing: PendingPeakFrame | null,
  peak: DetectedPeak,
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  queuedAtMs: number,
  timeDomain?: Float32Array,
): PendingPeakFrame {
  let pending = existing

  if (!pending || pending.spectrum.length !== spectrum.length || (!!pending.timeDomain) !== (!!timeDomain)) {
    pending = {
      peak: { ...peak },
      spectrum: new Float32Array(spectrum.length),
      sampleRate,
      fftSize,
      queuedAtMs,
      timeDomain: timeDomain ? new Float32Array(timeDomain.length) : undefined,
    }
  } else {
    pending.peak = { ...peak }
  }

  pending.sampleRate = sampleRate
  pending.fftSize = fftSize
  pending.queuedAtMs = queuedAtMs
  pending.spectrum.set(spectrum)

  if (timeDomain) {
    if (!pending.timeDomain || pending.timeDomain.length !== timeDomain.length) {
      pending.timeDomain = new Float32Array(timeDomain.length)
    }
    pending.timeDomain.set(timeDomain)
  } else {
    pending.timeDomain = undefined
  }

  return pending
}

export function enqueuePendingPeak(
  queue: PendingPeakFrame[],
  peak: DetectedPeak,
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  timeDomain?: Float32Array,
): number {
  let droppedCount = 0
  const queuedAtMs = Date.now()
  if (Number.isFinite(peak.timestamp)) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const queuedTimestamp = queue[i].peak.timestamp
      if (Number.isFinite(queuedTimestamp) && peak.timestamp - queuedTimestamp > MAX_PENDING_PEAK_AGE_MS) {
        queue.splice(i, 1)
        droppedCount++
      }
    }
  }

  const existingIndex = queue.findIndex((pending) => pending.peak.binIndex === peak.binIndex)
  if (existingIndex !== -1) {
    queue[existingIndex] = writePendingPeakFrame(
      queue[existingIndex],
      peak,
      spectrum,
      sampleRate,
      fftSize,
      queuedAtMs,
      timeDomain,
    )
    return droppedCount
  }

  if (queue.length < MAX_PENDING_PEAKS) {
    queue.push(
      writePendingPeakFrame(
        null,
        peak,
        spectrum,
        sampleRate,
        fftSize,
        queuedAtMs,
        timeDomain,
      ),
    )
    return droppedCount
  }

  const weakestIndex = findWeakestPendingPeakIndex(queue)
  const weakest = queue[weakestIndex]
  droppedCount++
  if (comparePeakPriority(peak, queuedAtMs, weakest.peak, weakest.queuedAtMs) < 0) {
    queue[weakestIndex] = writePendingPeakFrame(
      weakest,
      peak,
      spectrum,
      sampleRate,
      fftSize,
      queuedAtMs,
      timeDomain,
    )
  }
  return droppedCount
}

export function preparePeakTransfer(
  peak: DetectedPeak,
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  pools: PeakPoolRefs,
  timeDomain?: Float32Array,
): {
  message: Extract<WorkerInboundMessage, { type: 'processPeak' }>
  transferList: ArrayBuffer[]
} {
  if (pools.poolFftSizeRef.current !== fftSize) {
    pools.specPoolRef.current = Array.from(
      { length: 3 },
      () => new Float32Array(spectrum.length),
    )
    pools.tdPoolRef.current = timeDomain
      ? Array.from({ length: 3 }, () => new Float32Array(timeDomain.length))
      : []
    pools.poolFftSizeRef.current = fftSize
  }

  let spectrumBuffer = pools.specPoolRef.current.pop()
  if (!spectrumBuffer || spectrumBuffer.length !== spectrum.length) {
    spectrumBuffer = new Float32Array(spectrum.length)
  }
  spectrumBuffer.set(spectrum)

  const transferList: ArrayBuffer[] = [spectrumBuffer.buffer as ArrayBuffer]

  let timeDomainBuffer: Float32Array | undefined
  if (timeDomain) {
    timeDomainBuffer = pools.tdPoolRef.current.pop()
    if (!timeDomainBuffer || timeDomainBuffer.length !== timeDomain.length) {
      timeDomainBuffer = new Float32Array(timeDomain.length)
    }
    timeDomainBuffer.set(timeDomain)
    transferList.push(timeDomainBuffer.buffer as ArrayBuffer)
  }

  return {
    message: {
      type: 'processPeak',
      peak,
      spectrum: spectrumBuffer,
      sampleRate,
      fftSize,
      timeDomain: timeDomainBuffer,
    },
    transferList,
  }
}

export function prepareSpectrumUpdateTransfer(
  spectrum: Float32Array,
  crestFactor: number,
  sampleRate: number,
  fftSize: number,
  specUpdatePoolRef: MutableRefObject<Float32Array[]>,
): {
  message: Extract<WorkerInboundMessage, { type: 'spectrumUpdate' }>
  transferList: ArrayBuffer[]
} {
  let spectrumBuffer = specUpdatePoolRef.current.pop()
  if (!spectrumBuffer || spectrumBuffer.length !== spectrum.length) {
    spectrumBuffer = new Float32Array(spectrum.length)
  }
  spectrumBuffer.set(spectrum)

  return {
    message: {
      type: 'spectrumUpdate',
      spectrum: spectrumBuffer,
      crestFactor,
      sampleRate,
      fftSize,
    },
    transferList: [spectrumBuffer.buffer as ArrayBuffer],
  }
}

function flushBufferedPeak(refs: DSPWorkerHandlerRefs) {
  if (refs.busyRef.current || refs.pendingPeakQueueRef.current.length === 0 || !refs.workerRef.current) {
    return
  }

  const now = Date.now()
  for (let i = refs.pendingPeakQueueRef.current.length - 1; i >= 0; i--) {
    if (now - refs.pendingPeakQueueRef.current[i].queuedAtMs > MAX_PENDING_PEAK_AGE_MS) {
      refs.pendingPeakQueueRef.current.splice(i, 1)
      refs.droppedFramesRef.current++
    }
  }

  if (refs.pendingPeakQueueRef.current.length === 0) return
  const bestIndex = findBestPendingPeakIndex(refs.pendingPeakQueueRef.current)
  const buffered = refs.pendingPeakQueueRef.current.splice(bestIndex, 1)[0]

  refs.busyRef.current = true

  const transferList: ArrayBuffer[] = [buffered.spectrum.buffer as ArrayBuffer]
  if (buffered.timeDomain) {
    transferList.push(buffered.timeDomain.buffer as ArrayBuffer)
  }

  refs.outboundMessagesRef.current++
  refs.workerRef.current.postMessage(
    {
      type: 'processPeak',
      peak: buffered.peak,
      spectrum: buffered.spectrum,
      sampleRate: buffered.sampleRate,
      fftSize: buffered.fftSize,
      timeDomain: buffered.timeDomain,
    } satisfies WorkerInboundMessage,
    transferList,
  )
}

function recycleReturnedBuffers(
  refs: DSPWorkerHandlerRefs,
  message: Extract<WorkerOutboundMessage, { type: 'returnBuffers' }>,
) {
  const isPeakReturn = message.source === 'peak'
  if (isPeakReturn) {
    refs.busyRef.current = false
  }

  if (message.spectrum.buffer.byteLength > 0) {
    if (message.source === 'spectrumUpdate') {
      refs.specUpdatePoolRef.current.push(message.spectrum)
    } else {
      refs.specPoolRef.current.push(message.spectrum)
    }
  }

  if (message.timeDomain && message.timeDomain.buffer.byteLength > 0) {
    refs.tdPoolRef.current.push(message.timeDomain)
  }

  if (isPeakReturn) {
    flushBufferedPeak(refs)
  }
}

function replayPendingFeedbackHistory(worker: Worker, refs: DSPWorkerHandlerRefs) {
  if (!refs.pendingHistorySyncRef.current) {
    return
  }

  const { hotspots } = refs.pendingHistorySyncRef.current
  refs.pendingHistorySyncRef.current = null
  worker.postMessage({ type: 'syncFeedbackHistory', hotspots })
}

export function createDSPWorkerMessageHandler(
  worker: Worker,
  refs: DSPWorkerHandlerRefs,
): (event: MessageEvent<WorkerOutboundMessage>) => void {
  return (event) => {
    if (refs.workerRef.current !== worker) return

    refs.inboundMessagesRef.current++
    const message = event.data

    if (
      refs.pendingResetGenerationRef.current !== null &&
      (
        message.type === 'advisory' ||
        message.type === 'advisoryCleared' ||
        message.type === 'tracksUpdate' ||
        message.type === 'contentTypeUpdate' ||
        message.type === 'combPatternUpdate'
      )
    ) {
      return
    }

    switch (message.type) {
      case 'ready':
        if (
          refs.clearPendingResetOnReadyRef.current &&
          refs.workerRef.current === worker
        ) {
          refs.pendingResetGenerationRef.current = null
          refs.clearPendingResetOnReadyRef.current = false
        }
        refs.isReadyRef.current = true
        refs.crashedRef.current = false
        refs.permanentlyDeadRef.current = false
        refs.restartCountRef.current = 0
        replayPendingFeedbackHistory(worker, refs)
        flushBufferedPeak(refs)
        refs.callbacksRef.current.onReady?.()
        break
      case 'resetComplete':
        if (refs.pendingResetGenerationRef.current === message.generation) {
          refs.pendingResetGenerationRef.current = null
        }
        break
      case 'advisory':
        refs.callbacksRef.current.onAdvisory?.(message.advisory)
        break
      case 'advisoryCleared':
        refs.callbacksRef.current.onAdvisoryCleared?.(message.advisoryId)
        break
      case 'tracksUpdate':
        refs.tracksUpdatesRef.current++
        if (TRACK_PAYLOAD_ENCODER) {
          const payloadBytes = TRACK_PAYLOAD_ENCODER.encode(JSON.stringify(message.tracks)).length
          refs.lastTracksPayloadBytesRef.current = payloadBytes
          if (payloadBytes > refs.maxTracksPayloadBytesRef.current) {
            refs.maxTracksPayloadBytesRef.current = payloadBytes
          }
        }
        refs.callbacksRef.current.onTracksUpdate?.(message.tracks, {
          contentType: message.contentType,
          algorithmMode: message.algorithmMode,
          isCompressed: message.isCompressed,
          compressionRatio: message.compressionRatio,
          lastFusionVerdict: message.lastFusionVerdict,
          lastFusionConfidence: message.lastFusionConfidence,
          lastFeedbackProbability: message.lastFeedbackProbability,
          lastReportDecision: message.lastReportDecision,
          lastReportGate: message.lastReportGate,
          lastReportGateReason: message.lastReportGateReason,
          lastReportFrequencyHz: message.lastReportFrequencyHz,
          lastReportTimestamp: message.lastReportTimestamp,
        })
        break
      case 'contentTypeUpdate':
        refs.callbacksRef.current.onContentTypeUpdate?.(
          message.contentType,
          message.isCompressed,
          message.compressionRatio,
        )
        break
      case 'combPatternUpdate':
        refs.callbacksRef.current.onEarlyWarningUpdate?.(message.pattern)
        break
      case 'returnBuffers':
        recycleReturnedBuffers(refs, message)
        break
      case 'error':
        refs.busyRef.current = false
        refs.callbacksRef.current.onError?.(message.message)
        break
      default:
        if (process.env.NODE_ENV === 'development') {
          logWarn(
            '[useDSPWorker] unhandled message type:',
            (message as { type: string }).type,
          )
        }
    }
  }
}

export function createDSPWorkerErrorHandler(
  worker: Worker,
  refs: DSPWorkerHandlerRefs,
  respawnWorker: () => Worker,
): (event: ErrorEvent) => void {
  return (event) => {
    refs.crashedRef.current = true
    refs.isReadyRef.current = false
    refs.busyRef.current = false
    refs.clearPendingResetOnReadyRef.current = true

    const attempt = refs.restartCountRef.current + 1
    const canRestart = attempt <= MAX_RESTARTS && refs.lastInitRef.current !== null

    refs.callbacksRef.current.onError?.(
      canRestart
        ? (event.message ?? 'DSP worker crashed')
        : 'Analysis engine stopped after repeated failures - tap Restart to try again',
    )

    worker.terminate()
    refs.workerRef.current = null

    if (!canRestart) {
      refs.permanentlyDeadRef.current = true
      return
    }

    if (refs.restartTimerRef.current) {
      clearTimeout(refs.restartTimerRef.current)
    }

    // Exponential backoff: 500ms → 1s → 2s (prevents rapid crash loop)
    const backoffMs = RESTART_DELAY_MS * (1 << (attempt - 1))
    refs.restartTimerRef.current = setTimeout(() => {
      refs.restartTimerRef.current = null
      refs.restartCountRef.current = attempt

      const nextWorker = respawnWorker()
      const lastInit = refs.lastInitRef.current
      if (!lastInit) {
        return
      }

      nextWorker.postMessage({
        type: 'init',
        settings: lastInit.settings,
        sampleRate: lastInit.sampleRate,
        fftSize: lastInit.fftSize,
      })
    }, backoffMs)
  }
}
