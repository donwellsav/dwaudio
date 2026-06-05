// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThresholdChange } from '@/hooks/useThresholdChange'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import type { DwaSessionState } from '@/types/settings'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal session state for testing. */
function makeSession(
  overrides: Partial<{
    modeId: DwaSessionState['modeId']
    sensitivityOffsetDb: number
  }> = {},
): DwaSessionState {
  return {
    modeId: overrides.modeId ?? 'speech',
    environment: {
      mainsHumEnabled: true,
      mainsHumFundamental: 'auto',
    },
    liveOverrides: {
      sensitivityOffsetDb: overrides.sensitivityOffsetDb ?? 0,
      inputGainDb: 0,
      autoGainEnabled: false,
      autoGainTargetDb: -18,
      focusRange: { kind: 'preset', id: 'full' },
      eqStyle: 'mode-default',
    },
    diagnostics: {
      showAlgorithmScores: false,
      showPeakMarkers: false,
      verboseLogging: false,
    },
  } as unknown as DwaSessionState
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useThresholdChange', () => {
  it('returns a stable callback when deps do not change', () => {
    const session = makeSession()
    const setSensitivityOffset = vi.fn()

    const { result, rerender } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('computes correct sensitivity offset delta from absolute dB threshold', () => {
    // speech baseline = 20 dB, sensitivityOffsetDb = 0
    // effective = 20 + 0 = 20
    // dragging to 30 dB → delta = 30 - 20 = 10 → new offset = 0 + 10 = 10
    const session = makeSession({ modeId: 'speech' })
    const setSensitivityOffset = vi.fn()

    const { result } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    result.current(30)

    const bl = MODE_BASELINES.speech.feedbackThresholdDb
    expect(bl).toBe(20) // sanity-check baseline
    expect(setSensitivityOffset).toHaveBeenCalledTimes(1)
    expect(setSensitivityOffset).toHaveBeenCalledWith(10)
  })

  it('does NOT call setSensitivityOffset when delta is 0', () => {
    // speech: effective = 20 + 0 = 20 → drag to 20 → delta = 0
    const session = makeSession({ modeId: 'speech' })
    const setSensitivityOffset = vi.fn()

    const { result } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    result.current(20)

    expect(setSensitivityOffset).not.toHaveBeenCalled()
  })

  it('accounts for sensitivityOffsetDb in the delta', () => {
    // speech baseline = 20, sensitivityOffsetDb = 2
    // effective = 20 + 2 = 22
    // drag to 35 → delta = 35 - 22 = 13 → new offset = 2 + 13 = 15
    const session = makeSession({
      modeId: 'speech',
      sensitivityOffsetDb: 2,
    })
    const setSensitivityOffset = vi.fn()

    const { result } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    result.current(35)

    expect(setSensitivityOffset).toHaveBeenCalledTimes(1)
    expect(setSensitivityOffset).toHaveBeenCalledWith(15)
  })

  it('handles negative delta (dragging threshold lower)', () => {
    // speech baseline = 20, offsets = 0
    // effective = 20, drag to 15 → delta = -5 → new offset = 0 + (-5) = -5
    const session = makeSession({ modeId: 'speech' })
    const setSensitivityOffset = vi.fn()

    const { result } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    result.current(15)

    expect(setSensitivityOffset).toHaveBeenCalledWith(-5)
  })

  it('re-creates callback when session.modeId changes', () => {
    const setSensitivityOffset = vi.fn()
    let session = makeSession({ modeId: 'speech' })

    const { result, rerender } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    const first = result.current

    // Switch to a different mode
    session = makeSession({ modeId: 'liveMusic' })
    rerender()

    expect(result.current).not.toBe(first)
  })

  it('uses correct baseline per mode', () => {
    // liveMusic baseline = 42, offsets = 0
    // effective = 42, drag to 50 → delta = 8 → new offset = 0 + 8 = 8
    const session = makeSession({ modeId: 'liveMusic' })
    const setSensitivityOffset = vi.fn()

    const { result } = renderHook(() =>
      useThresholdChange(session, setSensitivityOffset),
    )

    result.current(50)

    const bl = MODE_BASELINES.liveMusic.feedbackThresholdDb
    expect(bl).toBe(42) // sanity-check baseline
    expect(setSensitivityOffset).toHaveBeenCalledWith(8)
  })
})
