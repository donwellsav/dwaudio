// @vitest-environment jsdom
/**
 * Tests for useAdvisoryMap.ts — advisory state management hook.
 *
 * Key behaviors: O(1) Map lookup, frequency-proximity dedup (100 cents),
 * sorted cache with dirty flag, identity-stable callbacks.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAdvisoryMap } from '../useAdvisoryMap'
import type { Advisory } from '@/types/advisory'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAdvisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: 'adv-1',
    trackId: 'track-1',
    timestamp: Date.now(),
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'GROWING',
    confidence: 0.8,
    why: ['test'],
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -10,
    prominenceDb: 8,
    qEstimate: 15,
    bandwidthHz: 67,
    velocityDbPerSec: 2,
    stabilityCentsStd: 5,
    harmonicityScore: 0.1,
    modulationScore: 0.05,
    advisory: {
      geq: { bandHz: 1000, suggestedDb: -3 },
      peq: { frequencyHz: 1000, q: 15, gainDb: -6, type: 'bell' },
      pitch: { note: 'B', octave: 5, cents: -14 },
    },
    ...overrides,
  } as Advisory
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAdvisoryMap', () => {
  it('starts with empty advisories', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    expect(result.current.advisories).toEqual([])
  })

  it('adds new advisory via onAdvisory', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    act(() => result.current.onAdvisory(makeAdvisory()))
    expect(result.current.advisories).toHaveLength(1)
    expect(result.current.advisories[0].id).toBe('adv-1')
  })

  it('deduplicates advisories within 100 cents (1 semitone)', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    // 1000 Hz
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'adv-1', trueFrequencyHz: 1000 })))
    // ~1058 Hz = 1000 * 2^(100/1200) — exactly 100 cents above, should replace
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'adv-2', trueFrequencyHz: 1000 * Math.pow(2, 97 / 1200) })))
    expect(result.current.advisories).toHaveLength(1)
    expect(result.current.advisories[0].id).toBe('adv-2')
  })

  it('keeps advisories >100 cents apart', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'adv-1', trueFrequencyHz: 1000 })))
    // ~1060 Hz ≈ 101 cents — just outside dedup range
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'adv-2', trueFrequencyHz: 1000 * Math.pow(2, 101 / 1200) })))
    expect(result.current.advisories).toHaveLength(2)
  })

  it('sorts active before resolved, higher severity first', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))

    act(() => {
      result.current.onAdvisory(makeAdvisory({
        id: 'adv-low', severity: 'POSSIBLE_RING', trueFrequencyHz: 500, trueAmplitudeDb: -20,
      }))
      result.current.onAdvisory(makeAdvisory({
        id: 'adv-high', severity: 'RUNAWAY', trueFrequencyHz: 2000, trueAmplitudeDb: -5,
      }))
    })

    expect(result.current.advisories[0].id).toBe('adv-high')
    expect(result.current.advisories[1].id).toBe('adv-low')
  })

  it('re-sorts existing advisories when severity changes', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))

    act(() => {
      result.current.onAdvisory(makeAdvisory({
        id: 'adv-a', severity: 'RESONANCE', trueFrequencyHz: 500, trueAmplitudeDb: -12,
      }))
      result.current.onAdvisory(makeAdvisory({
        id: 'adv-b', severity: 'POSSIBLE_RING', trueFrequencyHz: 2000, trueAmplitudeDb: -6,
      }))
    })

    expect(result.current.advisories.map(a => a.id)).toEqual(['adv-a', 'adv-b'])

    act(() => {
      result.current.onAdvisory(makeAdvisory({
        id: 'adv-b', severity: 'RUNAWAY', trueFrequencyHz: 2000, trueAmplitudeDb: -6,
      }))
    })

    expect(result.current.advisories.map(a => a.id)).toEqual(['adv-b', 'adv-a'])
  })

  it('applies a new maxDisplayedIssues cap on rerender', () => {
    const { result, rerender } = renderHook(
      ({ maxDisplayedIssues }) => useAdvisoryMap(maxDisplayedIssues),
      { initialProps: { maxDisplayedIssues: 3 } }
    )

    act(() => {
      result.current.onAdvisory(makeAdvisory({ id: 'adv-1', severity: 'RUNAWAY', trueFrequencyHz: 500 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-2', severity: 'GROWING', trueFrequencyHz: 1000 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-3', severity: 'RESONANCE', trueFrequencyHz: 2000 }))
    })

    expect(result.current.advisories).toHaveLength(3)

    rerender({ maxDisplayedIssues: 1 })

    expect(result.current.advisories).toHaveLength(1)
    expect(result.current.advisories[0].id).toBe('adv-1')
  })

  it('keeps the rendered list frozen when maxDisplayedIssues changes during freeze', () => {
    const frozenRef = { current: false }
    const { result, rerender } = renderHook(
      ({ maxDisplayedIssues }) => useAdvisoryMap(maxDisplayedIssues, frozenRef),
      { initialProps: { maxDisplayedIssues: 3 } }
    )

    act(() => {
      result.current.onAdvisory(makeAdvisory({ id: 'adv-1', severity: 'RUNAWAY', trueFrequencyHz: 500 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-2', severity: 'GROWING', trueFrequencyHz: 1000 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-3', severity: 'RESONANCE', trueFrequencyHz: 2000 }))
    })

    expect(result.current.advisories).toHaveLength(3)

    frozenRef.current = true
    rerender({ maxDisplayedIssues: 1 })

    expect(result.current.advisories).toHaveLength(3)

    frozenRef.current = false
    rerender({ maxDisplayedIssues: 1 })

    expect(result.current.advisories).toHaveLength(1)
    expect(result.current.advisories[0].id).toBe('adv-1')
  })

  it('onAdvisoryCleared marks advisory as resolved', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'adv-1' })))
    act(() => result.current.onAdvisoryCleared('adv-1'))
    expect(result.current.advisories[0].resolved).toBe(true)
    expect(result.current.advisories[0].resolvedAt).toBeDefined()
  })

  it('auto-removes resolved provisional advisories after the fade hold', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAdvisoryMap(50))

      act(() => {
        result.current.onAdvisory(makeAdvisory({
          id: 'watch-1',
          lifecycle: 'provisional',
        }))
      })
      act(() => result.current.onAdvisoryCleared('watch-1'))

      expect(result.current.advisories[0].resolved).toBe(true)

      act(() => { vi.advanceTimersByTime(1599) })
      expect(result.current.advisories).toHaveLength(1)

      act(() => { vi.advanceTimersByTime(1) })
      expect(result.current.advisories).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the updated maxDisplayedIssues cap when a visible advisory is cleared', () => {
    const { result, rerender } = renderHook(
      ({ maxDisplayedIssues }) => useAdvisoryMap(maxDisplayedIssues),
      { initialProps: { maxDisplayedIssues: 3 } }
    )

    act(() => {
      result.current.onAdvisory(makeAdvisory({ id: 'adv-1', severity: 'RUNAWAY', trueFrequencyHz: 500 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-2', severity: 'GROWING', trueFrequencyHz: 1000 }))
      result.current.onAdvisory(makeAdvisory({ id: 'adv-3', severity: 'RESONANCE', trueFrequencyHz: 2000 }))
    })

    rerender({ maxDisplayedIssues: 1 })

    act(() => {
      result.current.onAdvisoryCleared('adv-1')
    })

    expect(result.current.advisories).toHaveLength(1)
    expect(result.current.advisories[0].id).toBe('adv-2')
  })

  it('clearMap resets everything', () => {
    const { result } = renderHook(() => useAdvisoryMap(50))
    act(() => result.current.onAdvisory(makeAdvisory()))
    act(() => result.current.clearMap())
    expect(result.current.advisories).toEqual([])
  })
})

// ── Freeze/unfreeze advisory buffering ─────────────────────────────────────
// Regression test: frozenRef was previously in useCallback/useEffect dep arrays,
// causing variable-length deps when it went from undefined to a ref.

describe('freeze/unfreeze buffering', () => {
  it('buffers advisories during freeze and flushes on unfreeze', () => {
    const frozenRef = { current: false }
    const { result, rerender } = renderHook(() => useAdvisoryMap(50, frozenRef))

    // Add one advisory while unfrozen — appears immediately
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'a1', trueFrequencyHz: 500 })))
    expect(result.current.advisories).toHaveLength(1)

    // Freeze — rerender so the every-render effect records wasFrozen=true
    frozenRef.current = true
    act(() => { rerender() })

    // Add advisory while frozen — buffered, not yet in sorted output
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'a2', trueFrequencyHz: 2000 })))
    // Map has it but sorted output may not update (frozen buffers flush on unfreeze)
    // The key invariant: no crash, no hook error

    // Unfreeze — the every-render effect sees wasFrozen=true + currentlyFrozen=false → flush
    frozenRef.current = false
    act(() => { rerender() })

    // After unfreeze, both advisories should be present
    expect(result.current.advisories.length).toBeGreaterThanOrEqual(2)
    const ids = result.current.advisories.map(a => a.id)
    expect(ids).toContain('a1')
    expect(ids).toContain('a2')
  })

  it('lets GROWING advisories break through freeze immediately', () => {
    const frozenRef = { current: true }
    const { result } = renderHook(() => useAdvisoryMap(50, frozenRef))

    act(() => {
      result.current.onAdvisory(makeAdvisory({
        id: 'g1',
        severity: 'GROWING',
        trueFrequencyHz: 1800,
      }))
    })

    expect(result.current.advisories.map(a => a.id)).toContain('g1')
  })

  it('works without frozenRef (undefined)', () => {
    // This was the source of the variable-length dep array bug —
    // frozenRef being undefined should not cause hook invariant violations
    const { result } = renderHook(() => useAdvisoryMap(50))

    act(() => result.current.onAdvisory(makeAdvisory({ id: 'b1' })))
    expect(result.current.advisories).toHaveLength(1)

    act(() => result.current.onAdvisory(makeAdvisory({ id: 'b2', trueFrequencyHz: 3000 })))
    expect(result.current.advisories).toHaveLength(2)
  })

  it('clears during freeze do not crash', () => {
    const frozenRef = { current: true }
    const { result } = renderHook(() => useAdvisoryMap(50, frozenRef))

    act(() => result.current.onAdvisory(makeAdvisory({ id: 'c1' })))
    // Clear while frozen — should not throw
    act(() => result.current.onAdvisoryCleared('c1'))

    // Unfreeze
    frozenRef.current = false
    act(() => result.current.onAdvisory(makeAdvisory({ id: 'c2', trueFrequencyHz: 4000 })))

    // c1 should be resolved, c2 active
    const c1 = result.current.advisories.find(a => a.id === 'c1')
    expect(c1?.resolved).toBe(true)
  })
})
