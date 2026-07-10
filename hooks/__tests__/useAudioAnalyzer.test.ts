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
  const resetFrameState = vi.fn()
  const frameState = {
    spectrumRef: { current: null },
    tracksRef: { current: [] },
    handleSpectrum: vi.fn(),
    handleTracksUpdate: vi.fn(),
    handleContentTypeUpdate: vi.fn(),
    handleCombPatternDetected: vi.fn(),
    resetFrameState,
  }
  return {
    analyzer,
    dspWorker,
    layered,
    frameState,
    clearMap: vi.fn(),
    resetFrameState,
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
  pickAudioRuntimeSettings: vi.fn((settings: { fftSize: number }) => ({
    fftSize: settings.fftSize,
  })),
  pickWorkerRuntimeSettings: vi.fn((settings: { fftSize: number }) => ({
    fftSize: settings.fftSize,
  })),
}))

vi.mock('@/hooks/useLayeredSettings', () => ({
  useLayeredSettings: vi.fn(() => mocks.layered),
}))

vi.mock('@/hooks/useAnalyzerFrameState', () => ({
  useAnalyzerFrameState: vi.fn(() => ({
    noiseFloorDb: null,
    spectrumStatus: null,
    earlyWarning: null,
    ...mocks.frameState,
  })),
}))

describe('useAudioAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.analyzer.stop.mockReset()
    mocks.layered.derivedSettings = {
      fftSize: 8192,
      maxDisplayedIssues: 8,
    }
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

  it('clears all run-scoped state before an explicit start', async () => {
    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      await result.current.start()
    })

    expect(mocks.resetFeedbackHistoryForCurrentRun).toHaveBeenCalledOnce()
    expect(mocks.clearMap).toHaveBeenCalledOnce()
    expect(mocks.resetFrameState).toHaveBeenCalledOnce()
    expect(mocks.dspWorker.reset).toHaveBeenCalledOnce()
  })

  it('reinitializes worker state when FFT size changes while running', () => {
    const { rerender } = renderHook(() => useAudioAnalyzer())
    vi.clearAllMocks()
    mocks.layered.derivedSettings = {
      fftSize: 4096,
      maxDisplayedIssues: 8,
    }
    mocks.analyzer.getState.mockReturnValue({
      isRunning: true,
      hasPermission: true,
      sampleRate: 48_000,
      fftSize: 4096,
      noiseFloorDb: null,
      effectiveThresholdDb: -35,
    })

    rerender()

    expect(mocks.analyzer.updateSettings).toHaveBeenCalledWith({ fftSize: 4096 })
    expect(mocks.resetFeedbackHistoryForCurrentRun).toHaveBeenCalledOnce()
    expect(mocks.clearMap).toHaveBeenCalledOnce()
    expect(mocks.resetFrameState).toHaveBeenCalledOnce()
    expect(mocks.dspWorker.reset).toHaveBeenCalledOnce()
    expect(mocks.dspWorker.init).toHaveBeenCalledWith({ fftSize: 4096 }, 48_000, 4096)
    expect(mocks.dspWorker.updateSettings).not.toHaveBeenCalled()
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

  it('clears advisories and frame state on a successful running-device boundary', async () => {
    const { result } = renderHook(() => useAudioAnalyzer())

    await act(async () => {
      await result.current.switchDevice('front-of-house')
    })

    expect(mocks.resetFeedbackHistoryForCurrentRun).toHaveBeenCalledOnce()
    expect(mocks.clearMap).toHaveBeenCalledOnce()
    expect(mocks.resetFrameState).toHaveBeenCalledOnce()
    expect(mocks.dspWorker.reset).toHaveBeenCalledOnce()
  })

  it('finishes on device B when B is selected while device A is pending', async () => {
    let resolveA!: () => void
    let resolveB!: () => void
    const pendingA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    const pendingB = new Promise<void>((resolve) => {
      resolveB = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      return options.deviceId === 'A' ? pendingA : pendingB
    })
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchA!: Promise<void>
    let switchB!: Promise<void>

    act(() => {
      switchA = result.current.switchDevice('A')
      switchB = result.current.switchDevice('B')
    })

    expect(switchB).toBe(switchA)
    expect(mocks.analyzer.start).toHaveBeenCalledTimes(1)
    expect(mocks.analyzer.start).toHaveBeenLastCalledWith({ deviceId: 'A' })
    let firstCallerSettled = false
    void switchA.then(() => {
      firstCallerSettled = true
    })

    await act(async () => {
      resolveA()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mocks.analyzer.start).toHaveBeenLastCalledWith({ deviceId: 'B' })
    })
    expect(firstCallerSettled).toBe(false)
    expect(mocks.analyzer.stop.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mocks.dspWorker.init).not.toHaveBeenCalled()

    await act(async () => {
      resolveB()
      await Promise.all([switchA, switchB])
    })

    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.isRunning).toBe(true)
    expect(result.current.isStarting).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('suppresses a stale device failure and waits for the latest device', async () => {
    let rejectA!: (error: Error) => void
    let resolveB!: () => void
    const pendingA = new Promise<void>((_resolve, reject) => {
      rejectA = reject
    })
    const pendingB = new Promise<void>((resolve) => {
      resolveB = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      return options.deviceId === 'A' ? pendingA : pendingB
    })
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchA!: Promise<void>
    let switchB!: Promise<void>

    act(() => {
      switchA = result.current.switchDevice('A')
      switchB = result.current.switchDevice('B')
    })

    expect(mocks.analyzer.start).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectA(new Error('Device A disappeared'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mocks.analyzer.start).toHaveBeenLastCalledWith({ deviceId: 'B' })
    })
    expect(result.current.error).toBeNull()
    expect(result.current.isStarting).toBe(true)
    expect(mocks.dspWorker.init).not.toHaveBeenCalled()

    await act(async () => {
      resolveB()
      await Promise.all([switchA, switchB])
    })

    expect(result.current.error).toBeNull()
    expect(result.current.isRunning).toBe(true)
    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
  })

  it('processes a device request queued while the current switch promise settles', async () => {
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchC: Promise<void> | undefined
    mocks.dspWorker.init.mockImplementationOnce(() => {
      queueMicrotask(() => {
        switchC = result.current.switchDevice('C')
      })
    })
    let switchB!: Promise<void>

    await act(async () => {
      switchB = result.current.switchDevice('B')
      await switchB
      await Promise.resolve()
    })

    expect(switchC).toBe(switchB)
    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(1, { deviceId: 'B' })
    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(2, { deviceId: 'C' })
    expect(mocks.dspWorker.init).toHaveBeenCalledTimes(2)
    expect(result.current.isRunning).toBe(true)
  })

  it('cancels a queued device request when stopped during a pending switch', async () => {
    let resolveA!: () => void
    const pendingA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      return options.deviceId === 'A' ? pendingA : Promise.resolve()
    })
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchPromise!: Promise<void>

    act(() => {
      switchPromise = result.current.switchDevice('A')
      expect(result.current.switchDevice('B')).toBe(switchPromise)
      result.current.stop()
    })

    expect(result.current.isStarting).toBe(false)

    await act(async () => {
      resolveA()
      await switchPromise
    })

    expect(mocks.analyzer.start).toHaveBeenCalledTimes(1)
    expect(mocks.analyzer.start).toHaveBeenCalledWith({ deviceId: 'A' })
    expect(mocks.dspWorker.init).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
  })

  it('does not start a queued device after unmount cancels a pending switch', async () => {
    let resolveA!: () => void
    const pendingA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      return options.deviceId === 'A' ? pendingA : Promise.resolve()
    })
    const { result, unmount } = renderHook(() => useAudioAnalyzer())
    let switchPromise!: Promise<void>

    act(() => {
      switchPromise = result.current.switchDevice('A')
      expect(result.current.switchDevice('B')).toBe(switchPromise)
    })
    unmount()

    await act(async () => {
      resolveA()
      await switchPromise
    })

    expect(mocks.analyzer.start).toHaveBeenCalledTimes(1)
    expect(mocks.analyzer.start).toHaveBeenCalledWith({ deviceId: 'A' })
    expect(mocks.dspWorker.init).not.toHaveBeenCalled()
  })

  it.each([
    ['a different-device', 'C'],
    ['a same-device', 'A'],
  ])('does not let a canceled switch affect %s explicit restart', async (_label, restartDeviceId) => {
    let resolveOldSwitch!: () => void
    const oldSwitch = new Promise<void>((resolve) => {
      resolveOldSwitch = resolve
    })
    mocks.analyzer.start
      .mockImplementationOnce(() => oldSwitch)
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchPromise!: Promise<void>

    act(() => {
      switchPromise = result.current.switchDevice('A')
      result.current.stop()
    })
    await act(async () => {
      await result.current.start({ deviceId: restartDeviceId })
    })

    const stopCallsAfterRestart = mocks.analyzer.stop.mock.calls.length
    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()

    await act(async () => {
      resolveOldSwitch()
      await switchPromise
    })

    expect(mocks.analyzer.stop).toHaveBeenCalledTimes(stopCallsAfterRestart)
    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.isRunning).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('cancels an active switch before a direct start takes ownership', async () => {
    let resolveA!: () => void
    const pendingA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    let adapterStart: Promise<void> | null = null
    const acquiredDevices: string[] = []
    mocks.analyzer.stop.mockImplementation(() => {
      adapterStart = null
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      if (adapterStart) return adapterStart
      const deviceId = options.deviceId ?? ''
      acquiredDevices.push(deviceId)
      if (deviceId === 'A') adapterStart = pendingA
      return adapterStart ?? Promise.resolve()
    })
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchA!: Promise<void>
    let startC!: Promise<void>

    act(() => {
      switchA = result.current.switchDevice('A')
    })
    const stopsBeforeRestart = mocks.analyzer.stop.mock.calls.length

    act(() => {
      startC = result.current.start({ deviceId: 'C' })
    })

    expect(mocks.analyzer.stop).toHaveBeenCalledTimes(stopsBeforeRestart + 1)
    expect(acquiredDevices).toEqual(['A', 'C'])

    await act(async () => {
      await Promise.all([switchA, startC])
    })

    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.isRunning).toBe(true)

    await act(async () => {
      resolveA()
      await Promise.resolve()
    })

    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
    expect(result.current.isRunning).toBe(true)
  })

  it('keeps device B running when stale initial A fails after B starts', async () => {
    let rejectA!: (error: Error) => void
    let resolveB!: () => void
    let isRunning = false
    const pendingA = new Promise<void>((_resolve, reject) => {
      rejectA = reject
    })
    const pendingB = new Promise<void>((resolve) => {
      resolveB = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      return options.deviceId === 'A' ? pendingA : pendingB
    })
    mocks.analyzer.getState.mockImplementation(() => ({
      isRunning,
      hasPermission: isRunning,
      sampleRate: 48_000,
      fftSize: 8192,
      noiseFloorDb: null,
      effectiveThresholdDb: -35,
    }))
    const { result } = renderHook(() => useAudioAnalyzer())
    let startA!: Promise<void>
    let switchB!: Promise<void>

    act(() => {
      startA = result.current.start({ deviceId: 'A' })
      switchB = result.current.switchDevice('B')
    })

    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(1, { deviceId: 'A' })
    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(2, { deviceId: 'B' })

    await act(async () => {
      isRunning = true
      resolveB()
      await switchB
    })

    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.isRunning).toBe(true)

    await act(async () => {
      rejectA(new Error('Device A permission failed late'))
      await startA
    })

    expect(mocks.dspWorker.init).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
    expect(result.current.isRunning).toBe(true)
  })

  it('starts device D after stop retires a canceled switch promise', async () => {
    let resolveA!: () => void
    let resolveD!: () => void
    const pendingA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    const pendingD = new Promise<void>((resolve) => {
      resolveD = resolve
    })
    mocks.analyzer.start.mockImplementation((options = {}) => {
      if (options.deviceId === 'A') return pendingA
      return options.deviceId === 'D' ? pendingD : Promise.resolve()
    })
    const { result } = renderHook(() => useAudioAnalyzer())
    let switchA!: Promise<void>

    act(() => {
      switchA = result.current.switchDevice('A')
      result.current.stop()
    })
    await act(async () => {
      await result.current.start({ deviceId: 'C' })
    })

    let switchD!: Promise<void>
    act(() => {
      switchD = result.current.switchDevice('D')
    })

    expect(switchD).not.toBe(switchA)
    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(3, { deviceId: 'D' })

    await act(async () => {
      resolveA()
      await Promise.resolve()
    })

    let switchE!: Promise<void>
    act(() => {
      switchE = result.current.switchDevice('E')
    })
    expect(switchE).toBe(switchD)

    await act(async () => {
      resolveD()
      await switchE
    })

    expect(mocks.analyzer.start).toHaveBeenNthCalledWith(4, { deviceId: 'E' })
    expect(mocks.dspWorker.init).toHaveBeenCalledTimes(2)
    expect(result.current.isRunning).toBe(true)
    expect(result.current.error).toBeNull()
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
