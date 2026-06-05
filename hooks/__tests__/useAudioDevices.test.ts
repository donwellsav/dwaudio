// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioDevices } from '../useAudioDevices'

const storageMocks = vi.hoisted(() => ({
  load: vi.fn<() => string>(),
  save: vi.fn<(value: string) => void>(),
  clear: vi.fn<() => void>(),
}))

vi.mock('@/lib/storage/dwaStorage', () => ({
  deviceStorage: storageMocks,
}))

function makeDevice(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = 'audioinput',
): MediaDeviceInfo {
  return {
    deviceId,
    groupId: 'group-1',
    kind,
    label,
    toJSON: () => ({ deviceId, groupId: 'group-1', kind, label }),
  } as MediaDeviceInfo
}

describe('useAudioDevices', () => {
  let enumerateDevicesMock: ReturnType<typeof vi.fn<() => Promise<MediaDeviceInfo[]>>>
  let deviceChangeListener: (() => void) | null

  beforeEach(() => {
    enumerateDevicesMock = vi.fn<() => Promise<MediaDeviceInfo[]>>()
    deviceChangeListener = null
    storageMocks.load.mockReset()
    storageMocks.save.mockReset()
    storageMocks.clear.mockReset()
    storageMocks.load.mockReturnValue('')

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: enumerateDevicesMock,
        addEventListener: (_type: 'devicechange', listener: () => void) => {
          deviceChangeListener = listener
        },
        removeEventListener: (_type: 'devicechange', listener: () => void) => {
          if (deviceChangeListener === listener) {
            deviceChangeListener = null
          }
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears a saved selection when the device is no longer present on mount', async () => {
    storageMocks.load.mockReturnValue('missing-mic')
    enumerateDevicesMock.mockResolvedValue([makeDevice('mic-1', 'Stage Left')])

    const { result } = renderHook(() => useAudioDevices())

    await waitFor(() => {
      expect(result.current.devices).toEqual([{ deviceId: 'mic-1', label: 'Stage Left' }])
    })

    expect(result.current.selectedDeviceId).toBe('')
    expect(storageMocks.clear).toHaveBeenCalledTimes(1)
  })

  it('refreshes labels after permission reveals named microphones', async () => {
    enumerateDevicesMock.mockResolvedValueOnce([
      makeDevice('', ''),
      makeDevice('mic-1', ''),
      makeDevice('mic-1', ''),
    ])

    const { result } = renderHook(() => useAudioDevices())

    await waitFor(() => {
      expect(result.current.devices).toEqual([{ deviceId: 'mic-1', label: 'Microphone 1' }])
    })

    enumerateDevicesMock.mockResolvedValueOnce([makeDevice('mic-1', 'Shure Beta 58A')])

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.devices).toEqual([{ deviceId: 'mic-1', label: 'Shure Beta 58A' }])
  })

  it('re-enumerates on devicechange and clears a selection when hardware disappears', async () => {
    enumerateDevicesMock.mockResolvedValueOnce([makeDevice('mic-1', 'Wireless Handheld')])

    const { result } = renderHook(() => useAudioDevices())

    await waitFor(() => {
      expect(result.current.devices).toEqual([{ deviceId: 'mic-1', label: 'Wireless Handheld' }])
    })

    act(() => {
      result.current.setSelectedDeviceId('mic-1')
    })

    enumerateDevicesMock.mockResolvedValueOnce([makeDevice('mic-2', 'Lectern Mic')])

    await act(async () => {
      deviceChangeListener?.()
    })

    await waitFor(() => {
      expect(result.current.devices).toEqual([{ deviceId: 'mic-2', label: 'Lectern Mic' }])
    })

    expect(result.current.selectedDeviceId).toBe('')
    expect(storageMocks.clear).toHaveBeenCalledTimes(1)
  })

  it('does not crash when mediaDevices is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    })
    storageMocks.load.mockReturnValue('saved-device')

    const { result } = renderHook(() => useAudioDevices())

    await act(async () => {
      await expect(result.current.refresh()).resolves.toEqual([])
    })

    expect(result.current.devices).toEqual([])
    expect(result.current.selectedDeviceId).toBe('saved-device')
    expect(enumerateDevicesMock).not.toHaveBeenCalled()
  })
})
