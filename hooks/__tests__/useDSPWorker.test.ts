// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDSPWorker } from '../useDSPWorker'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
import type { DetectedPeak } from '@/types/advisory'
import type { WorkerOutboundMessage } from '@/lib/dsp/dspWorker'

class MockWorker {
  static instances: MockWorker[] = []

  onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: unknown[] = []
  readonly postMessage = vi.fn((message: unknown) => {
    this.messages.push(message)
  })
  readonly terminate = vi.fn()

  constructor(
    readonly url: URL,
    readonly options?: WorkerOptions,
  ) {
    MockWorker.instances.push(this)
  }

  emitMessage(message: WorkerOutboundMessage) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerOutboundMessage>)
  }

  emitError(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

function makePeak(overrides: Partial<DetectedPeak> = {}): DetectedPeak {
  return {
    binIndex: 42,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -18,
    prominenceDb: 12,
    sustainedMs: 180,
    harmonicOfHz: null,
    timestamp: 1234567890,
    noiseFloorDb: -90,
    effectiveThresholdDb: -45,
    ...overrides,
  }
}

describe('useDSPWorker', () => {
  const OriginalWorker = globalThis.Worker

  beforeEach(() => {
    MockWorker.instances = []
    globalThis.Worker = MockWorker as unknown as typeof Worker
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.Worker = OriginalWorker
  })

  it('does not post worker messages before init', () => {
    const onReady = vi.fn()
    const { result } = renderHook(() => useDSPWorker({ onReady }))

    const worker = MockWorker.instances[0]
    expect(worker).toBeDefined()
    expect(worker.messages).toEqual([])

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
    })

    expect(worker.messages[0]).toMatchObject({
      type: 'init',
      sampleRate: 48000,
      fftSize: 8192,
    })

    act(() => {
      worker.emitMessage({ type: 'ready' })
    })

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(result.current.isReady).toBe(true)
    expect(worker.messages).toHaveLength(1)
  })

  it('initializes the worker with the canonical startup defaults', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
    })

    expect(worker.messages[0]).toMatchObject({
      type: 'init',
      settings: expect.objectContaining({
        mode: 'speech',
        feedbackThresholdDb: 26,
        inputGainDb: 0,
        ringThresholdDb: 5,
        trackTimeoutMs: 1000,
      }),
      sampleRate: 48000,
      fftSize: 8192,
    })
  })

  it('queues feedback history sync until the worker is ready', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.syncFeedbackHistory([
        {
          centerFrequencyHz: 1000,
          occurrences: 3,
          lastSeen: 123,
        },
      ])
    })
    expect(worker.messages).toEqual([])

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    expect(worker.messages[1]).toMatchObject({
      type: 'syncFeedbackHistory',
      hotspots: [
        expect.objectContaining({
          centerFrequencyHz: 1000,
          occurrences: 3,
        }),
      ],
    })
  })

  it('does not replay queued feedback history after reset', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      result.current.syncFeedbackHistory([
        {
          centerFrequencyHz: 1000,
          occurrences: 3,
          lastSeen: 123,
        },
      ])
      result.current.reset()
      worker.emitMessage({ type: 'ready' })
    })

    expect(worker.messages).not.toContainEqual(
      expect.objectContaining({ type: 'syncFeedbackHistory' }),
    )
  })

  it('queues startup peaks and flushes them in order once the worker is ready', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]
    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      result.current.processPeak(makePeak({ binIndex: 1 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2 }), spectrum, 48000, 8192, timeDomain)
    })

    const processPeakMessagesBeforeReady = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(processPeakMessagesBeforeReady).toHaveLength(0)
    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 0,
      total: 2,
    })

    act(() => {
      worker.emitMessage({ type: 'ready' })
    })

    const processPeakMessagesAfterReady = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(processPeakMessagesAfterReady).toHaveLength(1)
    expect(processPeakMessagesAfterReady[0].peak.binIndex).toBe(1)

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages).toHaveLength(2)
    expect(flushedMessages[1].peak.binIndex).toBe(2)
  })

  it('keeps one peak outstanding until its buffers return', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 1 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2 }), spectrum, 48000, 8192, timeDomain)
    })

    const processPeakMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(processPeakMessages).toHaveLength(1)
    expect(processPeakMessages[0].peak.binIndex).toBe(1)
    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 0,
      total: 2,
    })

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        source: 'spectrumUpdate',
      })
    })

    const messagesAfterSpectrumReturn = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(messagesAfterSpectrumReturn).toHaveLength(1)

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
      } as unknown as WorkerOutboundMessage)
    })

    const messagesAfterUntaggedReturn = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(messagesAfterUntaggedReturn).toHaveLength(1)

    act(() => {
      worker.emitMessage({ type: 'tracksUpdate', tracks: [] })
    })

    const messagesAfterTracksUpdate = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(messagesAfterTracksUpdate).toHaveLength(1)

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages).toHaveLength(2)
    expect(flushedMessages[1].peak.binIndex).toBe(2)
  })

  it('keeps post-reset peaks queued until the in-flight peak returns', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]
    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
      result.current.processPeak(makePeak({ binIndex: 1, timestamp: 100 }), spectrum, 48000, 8192, timeDomain)
      result.current.reset()
      result.current.processPeak(makePeak({ binIndex: 2, timestamp: 120 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({
        binIndex: 3,
        timestamp: 140,
        prominenceDb: 7,
        qEstimate: 6,
        msdIsHowl: false,
        msdFastConfirm: false,
        isPersistent: false,
        isHighlyPersistent: false,
      }), spectrum, 48000, 8192, timeDomain)
    })

    const messagesBeforeFirstReturn = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect.soft(messagesBeforeFirstReturn.map((message) => message.peak.binIndex)).toEqual([1])

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const messagesAfterFirstReturn = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(messagesAfterFirstReturn.map((message) => message.peak.binIndex)).toEqual([1, 2])

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const messagesAfterSecondReturn = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(messagesAfterSecondReturn.map((message) => message.peak.binIndex)).toEqual([1, 2, 3])
  })

  it('recycles returned peak spectrum buffers sized to the frequency-bin count', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const firstSpectrum = new Float32Array(4096)
    const secondSpectrum = new Float32Array(4096)
    const timeDomain = new Float32Array(8192)

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 1 }), firstSpectrum, 48000, 8192, timeDomain)
    })

    const firstPeakMessage = worker.messages.find((message): message is { type: 'processPeak'; spectrum: Float32Array } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )
    expect(firstPeakMessage).toBeDefined()

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: firstPeakMessage!.spectrum,
        timeDomain: new Float32Array(8192),
        source: 'peak',
      })
    })

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 2 }), secondSpectrum, 48000, 8192, timeDomain)
    })

    const peakMessages = worker.messages.filter((message): message is { type: 'processPeak'; spectrum: Float32Array } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(peakMessages).toHaveLength(2)
    expect(peakMessages[1].spectrum).toBe(firstPeakMessage!.spectrum)
  })

  it('coalesces queued updates for the same bin while the worker is busy', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 1, timestamp: 100, trueFrequencyHz: 1000 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2, timestamp: 120, trueFrequencyHz: 1200 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2, timestamp: 180, trueFrequencyHz: 1225 }), spectrum, 48000, 8192, timeDomain)
    })

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages).toHaveLength(2)
    expect(flushedMessages[1].peak.binIndex).toBe(2)
    expect(flushedMessages[1].peak.timestamp).toBe(180)
    expect(flushedMessages[1].peak.trueFrequencyHz).toBe(1225)
    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 0,
      total: 3,
    })
  })

  it('drops stale queued peaks instead of flushing old detector frames', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 1, timestamp: 0 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2, timestamp: 40 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 3, timestamp: 80 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 4, timestamp: 120 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 5, timestamp: 440 }), spectrum, 48000, 8192, timeDomain)
    })

    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 3,
      total: 5,
    })

    act(() => {
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages).toHaveLength(2)
    expect(flushedMessages[1].peak.binIndex).toBe(5)
    expect(flushedMessages[1].peak.timestamp).toBe(440)
  })

  it('drops a queued peak that becomes stale before the worker releases', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      result.current.processPeak(makePeak({ binIndex: 1, timestamp: 0 }), spectrum, 48000, 8192, timeDomain)
      result.current.processPeak(makePeak({ binIndex: 2, timestamp: 40 }), spectrum, 48000, 8192, timeDomain)
    })

    act(() => {
      vi.advanceTimersByTime(300)
      worker.emitMessage({
        type: 'returnBuffers',
        spectrum: new Float32Array([9, 8, 7, 6]),
        timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
        source: 'peak',
      })
    })

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages).toHaveLength(1)
    expect(flushedMessages[0].peak.binIndex).toBe(1)
    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 1,
      total: 2,
    })
  })

  it('drops the weakest queued peaks when backpressure exceeds the queue limit', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
    })

    const spectrum = new Float32Array([1, 2, 3, 4])
    const timeDomain = new Float32Array([0.1, 0.2, 0.3, 0.4])

    act(() => {
      for (let binIndex = 1; binIndex <= 7; binIndex++) {
        result.current.processPeak(makePeak({
          binIndex,
          timestamp: binIndex * 40,
          prominenceDb: binIndex === 2 ? 19 : 7,
          qEstimate: binIndex === 2 ? 80 : 6,
          phpr: binIndex === 2 ? 24 : 2,
          msdIsHowl: binIndex === 2,
          msdFastConfirm: binIndex === 2,
          isPersistent: binIndex === 2,
          isHighlyPersistent: binIndex === 2,
        }), spectrum, 48000, 8192, timeDomain)
      }
    })

    expect(result.current.getBackpressureStats()).toMatchObject({
      dropped: 2,
      total: 7,
    })

    for (let i = 0; i < 4; i++) {
      act(() => {
        worker.emitMessage({
          type: 'returnBuffers',
          spectrum: new Float32Array([9, 8, 7, 6]),
          timeDomain: new Float32Array([0.4, 0.3, 0.2, 0.1]),
          source: 'peak',
        })
      })
    }

    const flushedMessages = worker.messages.filter((message): message is { type: 'processPeak'; peak: DetectedPeak } =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'processPeak'
    )

    expect(flushedMessages.map((message) => message.peak.binIndex)).toEqual([1, 2, 7, 6, 5])
  })

  it('tracks transport counters for tracksUpdate messages', () => {
    const { result } = renderHook(() => useDSPWorker({}))
    const worker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      worker.emitMessage({ type: 'ready' })
      worker.emitMessage({
        type: 'tracksUpdate',
        tracks: [
          {
            id: 'track-1',
            frequency: 1000,
            amplitude: -18,
            prominenceDb: 12,
            qEstimate: 20,
            bandwidthHz: 50,
            classification: 'unknown',
            severity: 'unknown',
            onsetTime: 1000,
            onsetAmplitudeDb: -24,
            lastUpdateTime: 1020,
            active: true,
            features: {
              stabilityCentsStd: 0,
              harmonicityScore: 0,
              modulationScore: 0,
              velocityDbPerSec: 0,
            },
          },
        ],
      })
    })

    const stats = result.current.getTransportStats()
    expect(stats.inbound).toBeGreaterThanOrEqual(2)
    expect(stats.tracksUpdates).toBe(1)
    // Payload-byte profiling is opt-in via `?profile=tracks` (dev-only). Without the
    // URL param the counters stay at 0 — the test env has no query string, so we
    // only assert the non-negative invariant.
    expect(stats.lastTracksPayloadBytes).toBeGreaterThanOrEqual(0)
    expect(stats.maxTracksPayloadBytes).toBeGreaterThanOrEqual(stats.lastTracksPayloadBytes)
  })

  it('restarts with the latest settings after a worker crash and cleans up the replacement worker', () => {
    vi.useFakeTimers()

    const onError = vi.fn()
    const { result, unmount } = renderHook(() => useDSPWorker({ onError }))
    const firstWorker = MockWorker.instances[0]

    act(() => {
      result.current.init(DEFAULT_SETTINGS, 48000, 8192)
      firstWorker.emitMessage({ type: 'ready' })
    })

    act(() => {
      result.current.updateSettings({
        mode: 'liveMusic',
        feedbackThresholdDb: 31,
      })
    })

    act(() => {
      firstWorker.emitError('worker exploded')
    })

    expect(onError).toHaveBeenCalledWith('worker exploded')
    expect(result.current.isCrashed).toBe(true)
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    const restartedWorker = MockWorker.instances[1]
    expect(restartedWorker).toBeDefined()
    expect(restartedWorker.messages[0]).toMatchObject({
      type: 'init',
      sampleRate: 48000,
      fftSize: 8192,
      settings: expect.objectContaining({
        mode: 'liveMusic',
        feedbackThresholdDb: 31,
      }),
    })

    unmount()

    expect(restartedWorker.terminate).toHaveBeenCalledTimes(1)
  })
})
