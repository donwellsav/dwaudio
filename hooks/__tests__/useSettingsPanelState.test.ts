// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsPanelState } from '@/hooks/useSettingsPanelState'

const mockUseSettings = vi.fn()

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => mockUseSettings(),
}))

describe('useSettingsPanelState', () => {
  beforeEach(() => {
    mockUseSettings.mockReset()

    mockUseSettings.mockReturnValue({
      session: {
        diagnostics: {},
      },
      resetSettings: vi.fn(),
    })
  })

  it('manages uncontrolled tab state', () => {
    const { result } = renderHook(() => useSettingsPanelState({}))

    expect(result.current.activeTab).toBe('live')

    act(() => {
      result.current.setActiveTab('expert')
    })

    expect(result.current.activeTab).toBe('expert')
  })

  it('delegates tab changes in controlled mode', () => {
    const onTabChange = vi.fn()

    const { result } = renderHook(() => useSettingsPanelState({
      activeTab: 'expert',
      onTabChange,
    }))

    expect(result.current.activeTab).toBe('expert')

    act(() => {
      result.current.setActiveTab('live')
    })

    expect(onTabChange).toHaveBeenCalledWith('live')
    expect(result.current.activeTab).toBe('expert')
  })

  it('reports when custom gate overrides are active', () => {
    mockUseSettings.mockReturnValue({
      session: {
        diagnostics: {
          chromaticGateOverride: 0.5,
        },
      },
      resetSettings: vi.fn(),
    })

    const { result } = renderHook(() => useSettingsPanelState({}))

    expect(result.current.hasCustomGates).toBe(true)
  })
})
