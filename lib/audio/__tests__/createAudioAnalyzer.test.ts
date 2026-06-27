import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbToLinearLut } from '@/lib/dsp/expLut'
import { createAudioAnalyzer } from '@/lib/audio/createAudioAnalyzer'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
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

vi.mock('@/lib/dsp/feedbackDetector', () => {
  class MockFeedbackDetector {
    constructor() {}

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

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    startMock.mockReset()
    startMock.mockImplementation(async () => {})
    stopMock.mockReset()
    updateSettingsMock.mockReset()
    requestAnimationFrameMock.mockClear()
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
})
