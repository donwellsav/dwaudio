// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildIssueListEntries,
  MIN_ISSUE_DISPLAY_MS,
  useStableIssueEntries,
  type IssueListEntry,
} from '@/hooks/useIssuesListEntries'
import type { Advisory, SeverityLevel } from '@/types/advisory'

function makeAdvisory(
  id: string,
  trueFrequencyHz: number,
  resolved = false,
  severity: SeverityLevel = 'RESONANCE',
): Advisory {
  return {
    id,
    trackId: `track-${id}`,
    timestamp: 1,
    label: 'ACOUSTIC_FEEDBACK',
    severity,
    confidence: 0.9,
    why: ['test'],
    trueFrequencyHz,
    trueAmplitudeDb: -12,
    prominenceDb: 8,
    qEstimate: 8,
    bandwidthHz: 40,
    velocityDbPerSec: 2,
    stabilityCentsStd: 1,
    harmonicityScore: 0,
    modulationScore: 0,
    resolved,
    advisory: {
      geq: { bandHz: trueFrequencyHz, bandIndex: 10, suggestedDb: -3 },
      peq: { type: 'notch', hz: trueFrequencyHz, q: 8, gainDb: -6 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 0, midi: 83 },
    },
  }
}

function makeEntry(id: string, frequencyHz: number, occurrenceCount: number): IssueListEntry {
  return {
    advisory: makeAdvisory(id, frequencyHz),
    occurrenceCount,
  }
}

describe('useIssuesListEntries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sorts unresolved repeat offenders ahead of other entries', () => {
    const advisories = [
      makeAdvisory('resolved', 1600, true),
      makeAdvisory('repeat', 1000),
      makeAdvisory('normal', 800),
    ]

    const entries = buildIssueListEntries(
      advisories,
      undefined,
      10,
      {
        getOccurrenceCount: (frequencyHz) => frequencyHz === 1000 ? 3 : 1,
      },
    )

    expect(entries.map((entry) => entry.advisory.id)).toEqual(['repeat', 'normal', 'resolved'])
  })

  it('merges nearby frequencies keeping higher-urgency severity', () => {
    // 250 Hz (POSSIBLE_RING, urgency 2) and 260 Hz (RESONANCE, urgency 3)
    // are ~66 cents apart — well within DISPLAY_MERGE_CENTS (200)
    const advisories = [
      makeAdvisory('ring', 250, false, 'POSSIBLE_RING'),
      makeAdvisory('res', 260, false, 'RESONANCE'),
    ]

    const entries = buildIssueListEntries(
      advisories, undefined, 10,
      { getOccurrenceCount: () => 1 },
    )

    expect(entries).toHaveLength(1)
    // RESONANCE (urgency 3) wins over POSSIBLE_RING (urgency 2)
    expect(entries[0].advisory.severity).toBe('RESONANCE')
    expect(entries[0].occurrenceCount).toBe(2)
  })

  it('does not merge frequencies beyond 200 cents apart', () => {
    // 250 Hz and 300 Hz are ~316 cents apart — should NOT merge
    const advisories = [
      makeAdvisory('low', 250, false, 'RESONANCE'),
      makeAdvisory('high', 300, false, 'POSSIBLE_RING'),
    ]

    const entries = buildIssueListEntries(
      advisories, undefined, 10,
      { getOccurrenceCount: () => 1 },
    )

    expect(entries).toHaveLength(2)
  })

  it('does not merge resolved with unresolved advisories', () => {
    // Same frequency but one resolved — should remain separate
    const advisories = [
      makeAdvisory('active', 1000, false, 'RESONANCE'),
      makeAdvisory('done', 1005, true, 'RESONANCE'),
    ]

    const entries = buildIssueListEntries(
      advisories, undefined, 10,
      { getOccurrenceCount: () => 1 },
    )

    // Unresolved sorts first, resolved sorts last — not adjacent after sort
    // so they won't merge even if frequencies are close
    expect(entries).toHaveLength(2)
  })

  it('holds list order until the minimum display time passes', () => {
    const firstEntries = [
      makeEntry('a', 800, 1),
      makeEntry('b', 1000, 1),
    ]
    const reorderedEntries = [
      makeEntry('b', 1000, 3),
      makeEntry('a', 800, 1),
    ]

    const { result, rerender } = renderHook(
      ({ entries }) => useStableIssueEntries(entries),
      { initialProps: { entries: firstEntries } },
    )

    rerender({ entries: reorderedEntries })
    expect(result.current.map((entry) => entry.advisory.id)).toEqual(['a', 'b'])

    act(() => {
      vi.advanceTimersByTime(MIN_ISSUE_DISPLAY_MS)
    })

    expect(result.current.map((entry) => entry.advisory.id)).toEqual(['b', 'a'])
  })

  it('shows the first live advisory without waiting for the hold timer', () => {
    const firstEntries = [
      makeEntry('a', 1000, 1),
    ]

    const { result, rerender } = renderHook(
      ({ entries }) => useStableIssueEntries(entries),
      { initialProps: { entries: [] as IssueListEntry[] } },
    )

    rerender({ entries: firstEntries })
    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(result.current.map((entry) => entry.advisory.id)).toEqual(['a'])
  })

  it('marks retained entries as held while the live list is empty', () => {
    const firstEntries = [
      makeEntry('a', 800, 1),
    ]

    const { result, rerender } = renderHook(
      ({ entries }) => useStableIssueEntries(entries),
      { initialProps: { entries: firstEntries } },
    )

    rerender({ entries: [] })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].advisory.id).toBe('a')
    expect(result.current[0].isHeld).toBe(true)

    act(() => {
      vi.advanceTimersByTime(MIN_ISSUE_DISPLAY_MS)
    })

    expect(result.current).toEqual([])
  })
})
