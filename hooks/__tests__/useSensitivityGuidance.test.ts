// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveSensitivityGuidance,
  useSensitivityGuidance,
} from '@/hooks/useSensitivityGuidance'

describe('useSensitivityGuidance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns no guidance when disabled', () => {
    expect(deriveSensitivityGuidance({
      enabled: false,
      isRunning: true,
      activeAdvisoryCount: 0,
      sensitivityDb: 30,
    })).toEqual({ direction: 'none', urgency: 'none' })
  })

  it('warns downward when advisories are piling up', () => {
    expect(deriveSensitivityGuidance({
      enabled: true,
      isRunning: true,
      activeAdvisoryCount: 3,
      sensitivityDb: 18,
    })).toEqual({ direction: 'down', urgency: 'warning' })
  })

  it('does not treat ordinary signal without advisories as missed feedback', () => {
    const { result } = renderHook(() => useSensitivityGuidance({
      enabled: true,
      isRunning: true,
      inputLevel: -20,
      activeAdvisoryCount: 0,
      sensitivityDb: 26,
    }))

    expect(result.current).toEqual({ direction: 'none', urgency: 'none' })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current).toEqual({ direction: 'none', urgency: 'none' })
  })
})
