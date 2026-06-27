import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbToLinearLut } from '@/lib/dsp/expLut'
import { createAudioAnalyzer } from '@/lib/audio/createAudioAnalyzer'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
import type { FeedbackDetectorCallbacks } from '@/lib/dsp/feedbackDetector'
import type { SpectrumData } from '@/types/advisory'

interface MockDetectorState {
  noiseFloorDb: number | null
  effectiveThresholdDb: number
  sampleRate: number
  fftSize: number
  autoGainEnabled: boolean
  autoGainDb: number
  autoGainLocked: boolean
  rawPeakDb: number
  isSignalPresent: boolean
  algorithmMode: SpectrumData['algorithmMode']
  contentType: SpectrumData['contentType']
  msdFrameCount: number
  isCompressed: boolean
  compressionRatio: number
}

const mockSpectrum = new Float32Array([-80, -36, -20, -48])
const mockState: MockDetectorState = {
  noiseFloorDb: -82,
  effectiveThresholdDb: -35,
  sampleRate: 48_000,
  fftSize: 8192,
  autoGainEnabled: true,
  autoGainDb: 12,
  autoGainLocked: true,
  rawPeakDb: -20,
  isSignalPresent: true,
  algorithmMode: 'auto',
  contentType: 'unknown',
  msdFrameCount: 12,
  isCompressed: false,
  compressionRatio: 1,
}

const startMock = vi.fn(async () => {})
const stopMock = vi.fn()
const updateSettingsMock = vi.fn()
let mockDetectorCallbacks: FeedbackDetectorCallbacks | null = null

vi.mock('@/lib/dsp/feedbackDetector', () => {
  class MockFeedbackDetector {
    constructor(_config: unknown, callbacks: FeedbackDetectorCallbacks = {}) {
      mockDetectorCallbacks = callbacks
    }

    start = startMock
    stop = stopMock
    updateSettings = updateSettingsMock
    getSpectrum = () => mockSpectrum
    getTimeDomain = () => null
    getState = () => mockState
  }

  return {
    FeedbackDetector: MockFeedbackDetector,
  }
})

describe('createAudioAnalyzer', () => {
  const requestAnimationFrameMock = vi.fn(() => 1)
  const cancelAnimationFrameMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)
    startMock.mockReset()
    startMock.mockImplementation(async () => {})
    stopMock.mockReset()
    updateSettingsMock.mockReset()
    requestAnimationFrameMock.mockClear()
    cancelAnimationFrameMock.mockClear()
    mockDetectorCallbacks = null
    Object.assign(mockState, {
      noiseFloorDb: -82,
      effectiveThresholdDb: -35,
      sampleRate: 48_000,
      fftSize: 8192,
      autoGainEnabled: true,
      autoGainDb: 12,
      autoGainLocked: true,
      rawPeakDb: -20,
      isSignalPresent: true,
      algorithmMode: 'auto',
      contentType: 'unknown',
      msdFrameCount: 12,
      isCompressed: false,
      compressionRatio: 1,
    } satisfies MockDetectorState)
  })

  it('keeps peak and crest-factor on the raw spectrum scale when auto-gain is enabled', () => {
    let seenSpectrum: SpectrumData | null = null
    let seenCrestFactor: number | null = null

    const analyzer = createAudioAnalyzer({}, {
      onSpectrum: (data) => {
        seenSpectrum = data
      },
      onSpectrumUpdate: (_spectrum, crestFactor) => {
        seenCrestFactor = crestFactor
      },
    })

    ;(analyzer as unknown as { _isRunning: boolean })._isRunning = true
    ;(analyzer as unknown as { spectrumLoop: (timestamp: number) => void }).spectrumLoop(100)

    const expectedRmsDb = 10 * Math.log10(
      Array.from(mockSpectrum).reduce((sum, value) => sum + dbToLinearLut(value), 0)
      / mockSpectrum.length,
    )

    expect(seenSpectrum).not.toBeNull()
    if (!seenSpectrum) {
      throw new Error('Expected onSpectrum callback to run')
    }

    const spectrumData = seenSpectrum as unknown as SpectrumData

    expect(spectrumData.peak).toBeCloseTo(mockState.rawPeakDb, 5)
    expect(spectrumData.rawPeakDb).toBeCloseTo(mockState.rawPeakDb, 5)
    expect(seenCrestFactor).toBeCloseTo(mockState.rawPeakDb - expectedRmsDb, 5)
  })

  it('boots the detector with the canonical startup defaults', () => {
    createAudioAnalyzer()

    expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: DEFAULT_SETTINGS.mode,
      feedbackThresholdDb: DEFAULT_SETTINGS.feedbackThresholdDb,
      ringThresholdDb: DEFAULT_SETTINGS.ringThresholdDb,
      autoGainTargetDb: DEFAULT_SETTINGS.autoGainTargetDb,
      trackTimeoutMs: DEFAULT_SETTINGS.trackTimeoutMs,
    }))
  })

  it('coalesces concurrent starts into one detector start and spectrum loop', async () => {
    const pendingResolves: Array<() => void> = []
    startMock.mockImplementation(() => new Promise<void>((resolve) => {
      pendingResolves.push(resolve)
    }))

    const analyzer = createAudioAnalyzer()
    const firstStart = analyzer.start()
    const secondStart = analyzer.start()
    const detectorStartCalls = startMock.mock.calls.length

    for (const resolve of pendingResolves) {
      resolve()
    }
    await Promise.allSettled([firstStart, secondStart])

    expect(detectorStartCalls).toBe(1)
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the wrapper running when the detector reports a recoverable analysis error', async () => {
    const analyzer = createAudioAnalyzer()

    await analyzer.start()
    mockDetectorCallbacks?.onError?.('Analysis error: bad frame')

    expect(cancelAnimationFrameMock).not.toHaveBeenCalled()
    expect(analyzer.getState().isRunning).toBe(true)
  })

  it('stops the wrapper when the detector reports an automatic shutdown', async () => {
    const onError = vi.fn()
    const onStateChange = vi.fn()
    const analyzer = createAudioAnalyzer({}, { onError, onStateChange })

    await analyzer.start()
    mockDetectorCallbacks?.onStopped?.('Microphone disconnected')

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1)
    expect(analyzer.getState().isRunning).toBe(false)
    expect(onStateChange).toHaveBeenLastCalledWith(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Microphone disconnected',
    }))

    await analyzer.start()

    expect(startMock).toHaveBeenCalledTimes(2)
  })

  it('does not mark the wrapper running after a pending start is stopped', async () => {
    const pendingResolves: Array<() => void> = []
    startMock.mockImplementation(() => new Promise<void>((resolve) => {
      pendingResolves.push(resolve)
    }))

    const analyzer = createAudioAnalyzer()
    const startPromise = analyzer.start()

    analyzer.stop({ releaseMic: true })
    for (const resolve of pendingResolves) {
      resolve()
    }
    await startPromise

    expect(analyzer.getState().isRunning).toBe(false)
    expect(requestAnimationFrameMock).not.toHaveBeenCalled()
  })
})
