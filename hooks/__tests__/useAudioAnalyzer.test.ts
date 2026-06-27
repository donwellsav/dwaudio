// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer'

const mocks = vi.hoisted(() => {
  const analyzer = {
    start: vi.fn<(_options?: { deviceId?: string }) => Promise<void>>(async () => {}),
    stop: vi.fn<(_options?: { releaseMic?: boolean }) => void>(),
    updateSettings: vi.fn(),
    getState: vi.fn(() => ({
      isRunning: true,
      hasPermission: true,
      sampleRate: 48_000,
      fftSize: 8192,
      noiseFloorDb: null,
      effectiveThresholdDb: -35,
    })),
  }

  const dspWorker = {
    init: vi.fn(),
    updateSettings: vi.fn(),
    reset: vi.fn(),
    processPeak: vi.fn(),
    sendSpectrumUpdate: vi.fn(),
    clearPeak: vi.fn(),
    isWorkerPermanentlyDead: false,
    actualFps: 60,
    droppedPercent: 0,
  }

  const derivedSettings = {
    fftSize: 8192,
    maxDisplayedIssues: 8,
  }

  const layered = {
    derivedSettings,
    session: {},
    display: {},
    resetAll: vi.fn(),
  }

  return {
    analyzer,
    dspWorker,
    layered,
    clearMap: vi.fn(),
    clearEarlyWarning: vi.fn(),
    resetFeedbackHistoryForCurrentRun: vi.fn(),
  }
})

vi.mock('@/lib/audio/createAudioAnalyzer', () => ({
  createAudioAnalyzer: vi.fn(() => mocks.analyzer),
}))

vi.mock('@/hooks/useDSPWorker', () => ({
  useDSPWorker: vi.fn(() => mocks.dspWorker),
}))

vi.mock('@/hooks/useAdvisoryMap', () => ({
  useAdvisoryMap: vi.fn(() => ({
    advisories: [],
    onAdvisory: vi.fn(),
    onAdvisoryCleared: vi.fn(),
    clearMap: mocks.clearMap,
  })),
}))

vi.mock('@/lib/dsp/feedbackHistory', () => ({
  resetFeedbackHistoryForCurrentRun: mocks.resetFeedbackHistoryForCurrentRun,
}))

vi.mock('@/lib/settings/runtimeSettings', () => ({
  pickAudioRuntimeSettings: vi.fn(() => ({ fftSize: 8192 })),
  pickWorkerRuntimeSettings: vi.fn(() => ({ fftSize: 8192 })),
}))

vi.mock('@/hooks/useLayeredSettings', () => ({
  useLayeredSettings: vi.fn(() => mocks.layered),
}))

vi.mock('@/hooks/useAnalyzerFrameState', () => ({
  useAnalyzerFrameState: vi.fn(() => ({
    noiseFloorDb: null,
    spectrumStatus: null,
    earlyWarning: null,
    spectrumRef: { current: null },
    tracksRef: { current: [] },
    handleSpectrum: vi.fn(),
    handleTracksUpdate: vi.fn(),
    handleContentTypeUpdate: vi.fn(),
    handleCombPatternDetected: vi.fn(),
    clearEarlyWarning: mocks.clearEarlyWarning,
  })),
}))

describe('useAudioAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.analyzer.start.mockResolvedValue(undefined)
    mocks.analyzer.getState.mockReturnValue({
      isRunning: true,
      hasPermission: true,
      sampleRate: 48_000,
      fftSize: 8192,
      noiseFloorDb: null,
      effectiveThresholdDb: -35,
    })
  })

  it('releases the microphone when the user stops analysis', () => {
    const { result } = renderHook(() => useAudioAnalyzer())

    act(() => {
      result.current.stop()
    })

    expect(mocks.analyzer.stop).toHaveBeenCalledWith({ releaseMic: true })
    expect(result.current.isRunning).toBe(false)
  })

  it('does not leave an unhandled rejection when device switching fails', async () => {
    const error = new Error('Selected input is unavailable')
    mocks.analyzer.start.mockRejectedValueOnce(error)

    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      await result.current.switchDevice('missing-input')
    })

    expect(mocks.analyzer.stop).toHaveBeenCalledWith({ releaseMic: true })
    expect(mocks.analyzer.start).toHaveBeenCalledWith({ deviceId: 'missing-input' })
    expect(result.current.error).toBe(error.message)
    expect(result.current.isStarting).toBe(false)
    expect(result.current.isRunning).toBe(false)
    expect(result.current.hasPermission).toBe(false)
  })

  it('reinitializes the DSP worker after a successful running-device switch', async () => {
    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      await result.current.switchDevice('front-of-house')
    })

    expect(mocks.analyzer.stop).toHaveBeenCalledWith({ releaseMic: true })
    expect(mocks.analyzer.start).toHaveBeenCalledWith({ deviceId: 'front-of-house' })
    expect(mocks.dspWorker.init).toHaveBeenCalledWith({ fftSize: 8192 }, 48_000, 8192)

    await waitFor(() => {
      expect(result.current.isRunning).toBe(true)
    })
    expect(result.current.isStarting).toBe(false)
  })

  it('does not initialize the DSP worker when a pending start resolves stopped', async () => {
    let resolveStart: (() => void) | null = null
    mocks.analyzer.start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveStart = resolve
    }))
    mocks.analyzer.getState.mockReturnValueOnce({
      isRunning: false,
      hasPermission: false,
      sampleRate: 48_000,
      fftSize: 8192,
      noiseFloorDb: null,
      effectiveThresholdDb: -35,
    })
    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      const startPromise = result.current.start()
      result.current.stop()
      resolveStart?.()
      await startPromise
    })

    expect(mocks.dspWorker.init).not.toHaveBeenCalled()
    expect(result.current.isStarting).toBe(false)
    expect(result.current.isRunning).toBe(false)
  })

  it('does not initialize the DSP worker when a pending device switch resolves stopped', async () => {
    let resolveStart: (() => void) | null = null
    mocks.analyzer.start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveStart = resolve
    }))
    mocks.analyzer.getState
      .mockReturnValueOnce({
        isRunning: true,
        hasPermission: true,
        sampleRate: 48_000,
        fftSize: 8192,
        noiseFloorDb: null,
        effectiveThresholdDb: -35,
      })
      .mockReturnValueOnce({
        isRunning: false,
        hasPermission: false,
        sampleRate: 48_000,
        fftSize: 8192,
        noiseFloorDb: null,
        effectiveThresholdDb: -35,
      })
    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      const switchPromise = result.current.switchDevice('front-of-house')
      result.current.stop()
      resolveStart?.()
      await switchPromise
    })

    expect(mocks.dspWorker.init).not.toHaveBeenCalled()
    expect(result.current.isStarting).toBe(false)
    expect(result.current.isRunning).toBe(false)
  })
})
