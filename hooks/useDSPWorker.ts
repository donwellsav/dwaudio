/**
 * useDSPWorker - manages the DSP Web Worker lifecycle
 *
 * Creates a worker via `new Worker(new URL(...))` which Webpack/Turbopack
 * bundles automatically. The worker runs TrackManager + classifier +
 * eqAdvisor off the main thread.
 *
 * The main thread still owns:
 *  - AudioContext + AnalyserNode (Web Audio API requirement)
 *  - getFloatFrequencyData() call (reads from AnalyserNode)
 *  - requestAnimationFrame loop
 *
 * The worker owns:
 *  - TrackManager state
 *  - Advisory map (dedup, harmonic suppression)
 *  - classifyTrack + generateEQAdvisory (CPU-heavy per-peak logic)
 */

'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { WorkerInboundMessage } from '@/lib/dsp/dspWorker'
import type { WorkerRuntimeSettings } from '@/lib/settings/runtimeSettings'
import {
  createDSPWorker,
  createDSPWorkerErrorHandler,
  createDSPWorkerMessageHandler,
  enqueuePendingPeak,
  preparePeakTransfer,
  prepareSpectrumUpdateTransfer,
} from './dspWorkerInternals'
import type {
  DSPWorkerCallbacks,
  DSPWorkerHandle,
  PendingHistorySyncRequest,
  PendingPeakFrame,
  WorkerInitSnapshot,
} from './dspWorkerTypes'
import type { FeedbackHotspotSummary } from '@/lib/dsp/feedbackHistoryShared'

export type { DSPWorkerCallbacks, DSPWorkerHandle } from './dspWorkerTypes'

/**
 * Creates and manages a DSP worker instance.
 *
 * @example
 * const worker = useDSPWorker({
 *   onAdvisory: (a) => setAdvisories(prev => [...prev, a]),
 *   onTracksUpdate: (t) => setTracks(t),
 * })
 */
export function useDSPWorker(callbacks: DSPWorkerCallbacks): DSPWorkerHandle {
  const workerRef = useRef<Worker | null>(null)
  const isReadyRef = useRef(false)
  const busyRef = useRef(false)
  const pendingPeakQueueRef = useRef<PendingPeakFrame[]>([])
  const crashedRef = useRef(false)
  const permanentlyDeadRef = useRef(false)
  const droppedFramesRef = useRef(0)
  const totalFramesRef = useRef(0)
  const callbacksRef = useRef(callbacks)
  const restartCountRef = useRef(0)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInitRef = useRef<WorkerInitSnapshot | null>(null)
  const pendingHistorySyncRef = useRef<PendingHistorySyncRequest | null>(null)
  const resetGenerationRef = useRef(0)
  const pendingResetGenerationRef = useRef<number | null>(null)
  const clearPendingResetOnReadyRef = useRef(false)
  const specPoolRef = useRef<Float32Array[]>([])
  const tdPoolRef = useRef<Float32Array[]>([])
  const poolFftSizeRef = useRef(0)
  const specUpdatePoolRef = useRef<Float32Array[]>([])
  const outboundMessagesRef = useRef(0)
  const inboundMessagesRef = useRef(0)
  const tracksUpdatesRef = useRef(0)
  const lastTracksPayloadBytesRef = useRef(0)
  const maxTracksPayloadBytesRef = useRef(0)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const setupWorkerHandlers = useMemo(() => {
    const setup = (worker: Worker) => {
      const handlerRefs = {
        workerRef,
        callbacksRef,
        isReadyRef,
        busyRef,
        pendingPeakQueueRef,
        droppedFramesRef,
        crashedRef,
        permanentlyDeadRef,
        restartCountRef,
        restartTimerRef,
        lastInitRef,
        pendingHistorySyncRef,
        pendingResetGenerationRef,
        clearPendingResetOnReadyRef,
        specPoolRef,
        tdPoolRef,
        specUpdatePoolRef,
        poolFftSizeRef,
        outboundMessagesRef,
        inboundMessagesRef,
        tracksUpdatesRef,
        lastTracksPayloadBytesRef,
        maxTracksPayloadBytesRef,
      }

      worker.onmessage = createDSPWorkerMessageHandler(worker, handlerRefs)
      worker.onerror = createDSPWorkerErrorHandler(worker, handlerRefs, () => {
        const nextWorker = createDSPWorker()
        setup(nextWorker)
        workerRef.current = nextWorker
        crashedRef.current = false
        return nextWorker
      })
    }

    return setup
  }, [])

  const spawnWorker = useCallback(() => {
    const worker = createDSPWorker()
    setupWorkerHandlers(worker)
    workerRef.current = worker
    return worker
  }, [setupWorkerHandlers])

  useEffect(() => {
    const worker = spawnWorker()

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current)
      }

      const currentWorker = workerRef.current
      if (currentWorker && currentWorker !== worker) {
        worker.terminate()
        currentWorker.terminate()
      } else {
        worker.terminate()
      }

      workerRef.current = null
      isReadyRef.current = false
    }
  }, [spawnWorker])

  const postMessage = useCallback((message: WorkerInboundMessage) => {
    if (crashedRef.current) {
      return
    }

    if (!isReadyRef.current && message.type !== 'init' && message.type !== 'reset') {
      return
    }

      if (workerRef.current) {
        outboundMessagesRef.current++
        workerRef.current.postMessage(message)
      }
    }, [])

  const init = useCallback(
    (settings: WorkerRuntimeSettings, sampleRate: number, fftSize: number) => {
      lastInitRef.current = { settings, sampleRate, fftSize }
      isReadyRef.current = false
      busyRef.current = false
      pendingPeakQueueRef.current = []

      permanentlyDeadRef.current = false
      outboundMessagesRef.current = 0
      inboundMessagesRef.current = 0
      tracksUpdatesRef.current = 0
      lastTracksPayloadBytesRef.current = 0
      maxTracksPayloadBytesRef.current = 0
      if (!workerRef.current) {
        spawnWorker()
      }

      crashedRef.current = false
      postMessage({ type: 'init', settings, sampleRate, fftSize })
    },
    [postMessage, spawnWorker],
  )

  const updateSettings = useCallback(
    (settings: Partial<WorkerRuntimeSettings>) => {
      if (lastInitRef.current) {
        lastInitRef.current = {
          ...lastInitRef.current,
          settings: {
            ...lastInitRef.current.settings,
            ...settings,
          },
        }
      }

      postMessage({ type: 'updateSettings', settings })
    },
    [postMessage],
  )

  const processPeak = useCallback<DSPWorkerHandle['processPeak']>(
    (peak, spectrum, sampleRate, fftSize, timeDomain) => {
      totalFramesRef.current++
      if (busyRef.current || crashedRef.current || !isReadyRef.current) {
        if (
          !crashedRef.current
          && !permanentlyDeadRef.current
          && lastInitRef.current
        ) {
          const droppedCount = enqueuePendingPeak(
            pendingPeakQueueRef.current,
            peak,
            spectrum,
            sampleRate,
            fftSize,
            timeDomain,
          )
          if (droppedCount > 0) {
            droppedFramesRef.current += droppedCount
          }
        }
        return
      }

      busyRef.current = true
      const { message, transferList } = preparePeakTransfer(
        peak,
        spectrum,
        sampleRate,
        fftSize,
        {
          specPoolRef,
          tdPoolRef,
          poolFftSizeRef,
        },
        timeDomain,
      )
      if (workerRef.current) {
        outboundMessagesRef.current++
        workerRef.current.postMessage(message, transferList)
      }
    },
    [],
  )

  const sendSpectrumUpdate = useCallback<DSPWorkerHandle['sendSpectrumUpdate']>(
    (spectrum, crestFactor, sampleRate, fftSize) => {
      if (crashedRef.current || !isReadyRef.current) {
        return
      }

      const { message, transferList } = prepareSpectrumUpdateTransfer(
        spectrum,
        crestFactor,
        sampleRate,
        fftSize,
        specUpdatePoolRef,
      )
      if (workerRef.current) {
        outboundMessagesRef.current++
        workerRef.current.postMessage(message, transferList)
      }
    },
    [],
  )

  const clearPeak = useCallback<DSPWorkerHandle['clearPeak']>(
    (binIndex, frequencyHz, timestamp) => {
      postMessage({ type: 'clearPeak', binIndex, frequencyHz, timestamp })
    },
    [postMessage],
  )

  const reset = useCallback(() => {
    const generation = ++resetGenerationRef.current
    pendingResetGenerationRef.current = generation
    pendingPeakQueueRef.current = []
    pendingHistorySyncRef.current = null
    droppedFramesRef.current = 0
    totalFramesRef.current = 0
    outboundMessagesRef.current = 0
    inboundMessagesRef.current = 0
    tracksUpdatesRef.current = 0
    lastTracksPayloadBytesRef.current = 0
    maxTracksPayloadBytesRef.current = 0
    postMessage({ type: 'reset', generation })
  }, [postMessage])

  const syncFeedbackHistory = useCallback<DSPWorkerHandle['syncFeedbackHistory']>(
    (hotspots: FeedbackHotspotSummary[]) => {
      if (!isReadyRef.current) {
        pendingHistorySyncRef.current = { hotspots: [...hotspots] }
        return
      }

      postMessage({ type: 'syncFeedbackHistory', hotspots })
    },
    [postMessage],
  )

  const terminate = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    workerRef.current?.terminate()
    workerRef.current = null
    isReadyRef.current = false
    busyRef.current = false
    pendingPeakQueueRef.current = []
    pendingResetGenerationRef.current = null
    clearPendingResetOnReadyRef.current = false
  }, [])

  return useMemo(
    () => ({
      get isReady() {
        return isReadyRef.current
      },
      get isCrashed() {
        return crashedRef.current
      },
      get isPermanentlyDead() {
        return permanentlyDeadRef.current
      },
      getBackpressureStats: () => ({
        dropped: droppedFramesRef.current,
        total: totalFramesRef.current,
        ratio:
          totalFramesRef.current > 0
            ? droppedFramesRef.current / totalFramesRef.current
            : 0,
      }),
      getTransportStats: () => ({
        outbound: outboundMessagesRef.current,
        inbound: inboundMessagesRef.current,
        tracksUpdates: tracksUpdatesRef.current,
        lastTracksPayloadBytes: lastTracksPayloadBytesRef.current,
        maxTracksPayloadBytes: maxTracksPayloadBytesRef.current,
      }),
      init,
      updateSettings,
      processPeak,
      sendSpectrumUpdate,
      clearPeak,
      reset,
      terminate,
      syncFeedbackHistory,
    }),
    [
      init,
      updateSettings,
      processPeak,
      sendSpectrumUpdate,
      clearPeak,
      reset,
      terminate,
      syncFeedbackHistory,
    ],
  )
}
