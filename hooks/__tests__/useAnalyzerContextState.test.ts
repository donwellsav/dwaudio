// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyzerContextState } from '@/hooks/useAnalyzerContextState'

const mocks = vi.hoisted(() => ({
  start: vi.fn<(_options?: { deviceId?: string }) => Promise<void>>(async () => {}),
  switchDevice: vi.fn<(_deviceId: string) => Promise<void>>(async () => {}),
  refresh: vi.fn<() => Promise<unknown[]>>(async () => []),
  setSelectedDeviceId: vi.fn(),
}))

vi.mock('@/hooks/useAudioAnalyzer', () => ({
  useAudioAnalyzer: vi.fn(() => ({
    isRunning: true,
    start: mocks.start,
    switchDevice: mocks.switchDevice,
    spectrumStatus: {
      peak: -22,
      autoGainDb: 4,
      autoGainEnabled: true,
      autoGainLocked: true,
    },
    settings: {
      autoGainEnabled: false,
    },
  })),
}))

vi.mock('@/hooks/useAudioDevices', () => ({
  useAudioDevices: vi.fn(() => ({
    devices: [{ deviceId: 'mic-1', label: 'Mic 1' }],
    selectedDeviceId: 'mic-1',
    setSelectedDeviceId: mocks.setSelectedDeviceId,
    refresh: mocks.refresh,
  })),
}))

describe('useAnalyzerContextState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with the selected device and refreshes devices while running', async () => {
    const { result } = renderHook(() => useAnalyzerContextState({}))

    await act(async () => {
      await result.current.startWithDevice()
    })

    expect(mocks.refresh).toHaveBeenCalled()
    expect(mocks.start).toHaveBeenCalledWith({ deviceId: 'mic-1' })
    expect(result.current.inputLevel).toBe(-22)
    expect(result.current.isAutoGain).toBe(true)
    expect(result.current.autoGainDb).toBe(4)
    expect(result.current.autoGainLocked).toBe(true)
  })

  it('persists a device selection and switches the running analyzer', () => {
    const { result } = renderHook(() => useAnalyzerContextState({}))

    act(() => {
      result.current.handleDeviceChange('mic-2')
    })

    expect(mocks.setSelectedDeviceId).toHaveBeenCalledWith('mic-2')
    expect(mocks.switchDevice).toHaveBeenCalledWith('mic-2')
  })
})
