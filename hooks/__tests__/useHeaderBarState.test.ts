// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockResolvedTheme: string | undefined = 'dark'
const mockSetTheme = vi.fn()
const mockStart = vi.fn(async () => {})
const mockStop = vi.fn()
const mockHandleDeviceChange = vi.fn()
const mockToggleFreeze = vi.fn()
const mockOnClearAll = vi.fn()
const mockOnClearGEQ = vi.fn()
const mockOnClearRTA = vi.fn()

let mockIsRunning = false
let mockAdvisories: Array<{ id: string }> = []
let mockDismissedIds = new Set<string>()
let mockHasActiveGEQBars = false
let mockHasActiveRTAMarkers = false

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}))

vi.mock('@/contexts/EngineContext', () => ({
  useEngine: () => ({
    isRunning: mockIsRunning,
    start: mockStart,
    stop: mockStop,
    devices: [{ deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' }],
    selectedDeviceId: 'mic-1',
    handleDeviceChange: mockHandleDeviceChange,
  }),
}))

vi.mock('@/contexts/MeteringContext', () => ({
  useMetering: () => ({
    inputLevel: -24,
  }),
}))

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    isFrozen: false,
    toggleFreeze: mockToggleFreeze,
  }),
}))

vi.mock('@/contexts/AdvisoryContext', () => ({
  useAdvisories: () => ({
    advisories: mockAdvisories,
    dismissedIds: mockDismissedIds,
    onClearAll: mockOnClearAll,
    onClearGEQ: mockOnClearGEQ,
    onClearRTA: mockOnClearRTA,
    hasActiveGEQBars: mockHasActiveGEQBars,
    hasActiveRTAMarkers: mockHasActiveRTAMarkers,
  }),
  useAdvisoryData: () => ({
    advisories: mockAdvisories,
    dismissedIds: mockDismissedIds,
    hasActiveGEQBars: mockHasActiveGEQBars,
    hasActiveRTAMarkers: mockHasActiveRTAMarkers,
  }),
  useAdvisoryActions: () => ({
    onClearAll: mockOnClearAll,
    onClearGEQ: mockOnClearGEQ,
    onClearRTA: mockOnClearRTA,
  }),
}))

vi.mock('@/contexts/PA2Context', () => ({
  usePA2: () => ({
    settings: { enabled: true },
    status: 'connected',
    error: null,
    notchSlotsUsed: 2,
    notchSlotsAvailable: 6,
  }),
}))

import { useHeaderBarState } from '../useHeaderBarState'

describe('useHeaderBarState', () => {
  beforeEach(() => {
    mockResolvedTheme = 'dark'
    mockIsRunning = false
    mockAdvisories = []
    mockDismissedIds = new Set()
    mockHasActiveGEQBars = false
    mockHasActiveRTAMarkers = false
    mockSetTheme.mockReset()
    mockStart.mockClear()
    mockStop.mockClear()
    mockHandleDeviceChange.mockClear()
    mockToggleFreeze.mockClear()
    mockOnClearAll.mockClear()
    mockOnClearGEQ.mockClear()
    mockOnClearRTA.mockClear()
  })

  it('detects clearable content from uncleared advisories', () => {
    mockAdvisories = [{ id: 'adv-1' }]
    const { result } = renderHook(() => useHeaderBarState())

    expect(result.current.hasClearableContent).toBe(true)
  })

  it('falls back to GEQ and RTA state when advisories are already dismissed', () => {
    mockAdvisories = [{ id: 'adv-1' }]
    mockDismissedIds = new Set(['adv-1'])
    mockHasActiveGEQBars = true
    const { result } = renderHook(() => useHeaderBarState())

    expect(result.current.hasClearableContent).toBe(true)
  })

  it('clears advisories, GEQ, and RTA together', () => {
    const { result } = renderHook(() => useHeaderBarState())

    act(() => {
      result.current.handleClearDisplays()
    })

    expect(mockOnClearAll).toHaveBeenCalledTimes(1)
    expect(mockOnClearGEQ).toHaveBeenCalledTimes(1)
    expect(mockOnClearRTA).toHaveBeenCalledTimes(1)
  })

  it('starts analysis when stopped and stops when already running', () => {
    const { result, rerender } = renderHook(() => useHeaderBarState())

    act(() => {
      result.current.handleToggleAnalysis()
    })
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(mockStop).not.toHaveBeenCalled()

    mockIsRunning = true
    rerender()

    act(() => {
      result.current.handleToggleAnalysis()
    })
    expect(mockStop).toHaveBeenCalledTimes(1)
  })

  it('toggles the theme using the resolved theme', () => {
    const { result, rerender } = renderHook(() => useHeaderBarState())

    act(() => {
      result.current.toggleTheme()
    })
    expect(mockSetTheme).toHaveBeenCalledWith('light')

    mockResolvedTheme = 'light'
    rerender()

    act(() => {
      result.current.toggleTheme()
    })
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })
})
