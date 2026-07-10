// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'
import {
  getEarlyWarningElapsedSeconds,
  getEarlyWarningProgressPercent,
  getEarlyWarningTone,
  hasEarlyWarningContent,
  useEarlyWarningPanelState,
} from '@/hooks/useEarlyWarningPanelState'

function makeEarlyWarning(
  overrides: Partial<EarlyWarning> = {},
): EarlyWarning {
  return {
    timestamp: Date.now() - 2000,
    predictedFrequencies: [1000, 2000],
    fundamentalSpacing: 1000,
    estimatedPathLength: 3.4,
    confidence: 0.82,
    ...overrides,
  }
}

describe('useEarlyWarningPanelState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes visibility and thresholds through pure helpers', () => {
    expect(hasEarlyWarningContent(null)).toBe(false)
    expect(hasEarlyWarningContent(makeEarlyWarning({ predictedFrequencies: [] }))).toBe(false)
    expect(hasEarlyWarningContent(makeEarlyWarning())).toBe(true)

    expect(getEarlyWarningTone(0)).toBe('notice')
    expect(getEarlyWarningTone(5)).toBe('warning')
    expect(getEarlyWarningTone(10)).toBe('critical')

    expect(getEarlyWarningElapsedSeconds(Date.now() - 4999)).toBe(4)
    expect(getEarlyWarningElapsedSeconds(Date.now() - 5000)).toBe(5)

    expect(getEarlyWarningProgressPercent(3)).toBe(20)
    expect(getEarlyWarningProgressPercent(30)).toBe(100)
  })

  it('tracks elapsed seconds while a warning is active', () => {
    const earlyWarning = makeEarlyWarning({ timestamp: Date.now() - 2000 })
    const { result } = renderHook(() =>
      useEarlyWarningPanelState(earlyWarning),
    )

    expect(result.current.isVisible).toBe(true)
    expect(result.current.elapsedSec).toBe(2)
    expect(result.current.confidencePct).toBe(82)
    expect(result.current.progressPercent).toBeCloseTo(13.333333333333334)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.elapsedSec).toBe(3)
    expect(result.current.tone).toBe('notice')
  })

  it('resets elapsed time when the warning clears and toggles expansion', () => {
    const { result, rerender } = renderHook(
      ({ earlyWarning }: { earlyWarning: EarlyWarning | null }) =>
        useEarlyWarningPanelState(earlyWarning),
      {
        initialProps: {
          earlyWarning: makeEarlyWarning() as EarlyWarning | null,
        },
      },
    )

    expect(result.current.isExpanded).toBe(true)

    act(() => {
      result.current.toggleExpanded()
    })

    expect(result.current.isExpanded).toBe(false)

    rerender({ earlyWarning: null })

    expect(result.current.isVisible).toBe(false)
    expect(result.current.elapsedSec).toBe(0)
    expect(result.current.confidencePct).toBe(0)
  })
})
