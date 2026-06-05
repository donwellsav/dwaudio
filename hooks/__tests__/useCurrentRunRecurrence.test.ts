// @vitest-environment jsdom
/**
 * Tests for useCurrentRunRecurrence.ts — updates current-run in-memory
 * recurrence from high-confidence feedback advisories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock recordFeedbackFromAdvisory before importing the hook
vi.mock('@/lib/dsp/feedbackHistory', () => ({
  recordFeedbackFromAdvisory: vi.fn(),
}))

import { useCurrentRunRecurrence } from '../useCurrentRunRecurrence'
import { recordFeedbackFromAdvisory } from '@/lib/dsp/feedbackHistory'
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

const mockRecord = recordFeedbackFromAdvisory as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useCurrentRunRecurrence', () => {
  it('records ACOUSTIC_FEEDBACK with confidence >= 0.6', () => {
    const advisory = makeAdvisory({ label: 'ACOUSTIC_FEEDBACK', confidence: 0.75 })
    renderHook(() => useCurrentRunRecurrence([advisory]))
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  it('records POSSIBLE_RING with confidence >= 0.6', () => {
    const advisory = makeAdvisory({ label: 'POSSIBLE_RING', confidence: 0.65 })
    renderHook(() => useCurrentRunRecurrence([advisory]))
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  it('does NOT record INSTRUMENT label', () => {
    const advisory = makeAdvisory({ label: 'INSTRUMENT', confidence: 0.9 })
    renderHook(() => useCurrentRunRecurrence([advisory]))
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('does NOT record low confidence (< 0.6)', () => {
    const advisory = makeAdvisory({ label: 'ACOUSTIC_FEEDBACK', confidence: 0.5 })
    renderHook(() => useCurrentRunRecurrence([advisory]))
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('does not re-record same advisory ID on rerender', () => {
    const advisory = makeAdvisory({ id: 'dedup-test', label: 'ACOUSTIC_FEEDBACK', confidence: 0.8 })
    const { rerender } = renderHook(
      ({ advisories }) => useCurrentRunRecurrence(advisories),
      { initialProps: { advisories: [advisory] } },
    )
    // Re-render with same advisory
    rerender({ advisories: [advisory] })
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('records an existing advisory once it later becomes eligible', () => {
    const advisory = makeAdvisory({
      id: 'late-eligible',
      label: 'ACOUSTIC_FEEDBACK',
      confidence: 0.5,
    })
    const { rerender } = renderHook(
      ({ advisories }) => useCurrentRunRecurrence(advisories),
      { initialProps: { advisories: [advisory] } },
    )

    expect(mockRecord).not.toHaveBeenCalled()

    rerender({
      advisories: [
        {
          ...advisory,
          confidence: 0.8,
        },
      ],
    })

    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})
