// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileFaderState } from '@/hooks/useMobileFaderState'
import type { DetectorSettings } from '@/types/advisory'

function makeSettings(overrides: Partial<Pick<DetectorSettings, 'feedbackThresholdDb' | 'inputGainDb'>> = {}) {
  return {
    feedbackThresholdDb: 25,
    inputGainDb: 0,
    ...overrides,
  }
}

describe('useMobileFaderState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('routes sensitivity changes to the threshold handler by default', () => {
    const handleThresholdChange = vi.fn()
    const setInputGain = vi.fn()
    const setAutoGain = vi.fn()

    const { result } = renderHook(() => useMobileFaderState({
      settings: makeSettings(),
      isRunning: true,
      inputLevel: -30,
      activeAdvisoryCount: 0,
      isAutoGain: false,
      handleThresholdChange,
      setInputGain,
      setAutoGain,
    }))

    act(() => {
      result.current.mobileFaderOnChange(18)
    })

    expect(result.current.mobileFaderMode).toBe('sensitivity')
    expect(result.current.mobileFaderValue).toBe(25)
    expect(handleThresholdChange).toHaveBeenCalledWith(18)
    expect(setInputGain).not.toHaveBeenCalled()
  })

  it('switches to gain mode and disables auto gain before changing input gain', () => {
    const handleThresholdChange = vi.fn()
    const setInputGain = vi.fn()
    const setAutoGain = vi.fn()

    const { result } = renderHook(() => useMobileFaderState({
      settings: makeSettings({ inputGainDb: 6 }),
      isRunning: true,
      inputLevel: -30,
      activeAdvisoryCount: 0,
      isAutoGain: true,
      handleThresholdChange,
      setInputGain,
      setAutoGain,
    }))

    act(() => {
      result.current.toggleMobileFaderMode()
    })

    act(() => {
      result.current.mobileFaderOnChange(8)
    })

    expect(result.current.mobileFaderMode).toBe('gain')
    expect(result.current.mobileFaderValue).toBe(6)
    expect(setAutoGain).toHaveBeenCalledWith(false)
    expect(setInputGain).toHaveBeenCalledWith(8)
    expect(handleThresholdChange).not.toHaveBeenCalled()
  })

  it('keeps ordinary signal neutral and warns when advisories pile up', () => {
    const { result, rerender } = renderHook((props: {
      feedbackThresholdDb: number
      activeAdvisoryCount: number
    }) => useMobileFaderState({
      settings: makeSettings({ feedbackThresholdDb: props.feedbackThresholdDb }),
      isRunning: true,
      inputLevel: -20,
      activeAdvisoryCount: props.activeAdvisoryCount,
      isAutoGain: false,
      handleThresholdChange: vi.fn(),
      setInputGain: vi.fn(),
      setAutoGain: vi.fn(),
    }), {
      initialProps: {
        feedbackThresholdDb: 26,
        activeAdvisoryCount: 0,
      },
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.mobileGuidance).toEqual({ direction: 'none', urgency: 'none' })

    rerender({
      feedbackThresholdDb: 4,
      activeAdvisoryCount: 3,
    })

    expect(result.current.mobileGuidance).toEqual({ direction: 'down', urgency: 'warning' })
  })
})
