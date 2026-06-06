// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatIssueAnnouncement,
  useIssueAnnouncement,
} from '@/hooks/useIssueAnnouncement'
import type { IssueListEntry } from '@/hooks/useIssuesListEntries'
import type { Advisory } from '@/types/advisory'

function makeAdvisory(id: string, frequencyHz = 1000): Advisory {
  return {
    id,
    trackId: `track-${id}`,
    timestamp: 1,
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'GROWING',
    confidence: 0.91,
    why: ['test'],
    trueFrequencyHz: frequencyHz,
    trueAmplitudeDb: -18,
    prominenceDb: 12,
    qEstimate: 4,
    bandwidthHz: 250,
    velocityDbPerSec: 1,
    stabilityCentsStd: 0,
    harmonicityScore: 0,
    modulationScore: 0,
    advisory: {
      geq: { bandIndex: 15, bandHz: frequencyHz, suggestedDb: -6 },
      peq: { type: 'bell', hz: frequencyHz, q: 4, gainDb: -6 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 0, midi: 83 },
    },
  }
}

function makeEntry(advisory: Advisory): IssueListEntry {
  return { advisory, occurrenceCount: 1 }
}

describe('useIssueAnnouncement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats an advisory announcement in plain language', () => {
    expect(formatIssueAnnouncement(makeAdvisory('adv-1'))).toMatch(/Feedback detected at/i)
  })

  it('announces a new advisory and throttles immediate follow-up announcements', () => {
    const firstEntry = makeEntry(makeAdvisory('adv-1'))
    const secondEntry = makeEntry(makeAdvisory('adv-2', 1250))

    const { result, rerender } = renderHook(
      ({ entries }) => useIssueAnnouncement(entries),
      { initialProps: { entries: [] as IssueListEntry[] } },
    )

    act(() => {
      rerender({ entries: [firstEntry] })
    })

    act(() => {
      vi.runOnlyPendingTimers()
    })

    const firstAnnouncement = result.current
    expect(firstAnnouncement).toMatch(/Feedback detected at/i)

    act(() => {
      vi.advanceTimersByTime(1000)
      rerender({ entries: [secondEntry] })
    })

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(result.current).toBe(firstAnnouncement)
  })

  it('does not announce held entries as new active feedback', () => {
    const heldEntry: IssueListEntry = {
      ...makeEntry(makeAdvisory('adv-held')),
      isHeld: true,
    }

    const { result, rerender } = renderHook(
      ({ entries }) => useIssueAnnouncement(entries),
      { initialProps: { entries: [] as IssueListEntry[] } },
    )

    act(() => {
      rerender({ entries: [heldEntry] })
    })

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(result.current).toBe('')
  })
})
