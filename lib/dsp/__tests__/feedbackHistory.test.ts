/**
 * Tests for current-run FeedbackHistory recurrence and per-mode cooldown.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { FeedbackHistory } from '@/lib/dsp/feedbackHistory'
import type { FeedbackEvent } from '@/lib/dsp/feedbackHistory'
import {
  HOTSPOT_COOLDOWN_MS,
  HOTSPOT_COOLDOWN_BY_MODE,
} from '@/lib/dsp/constants'

function makeEvent(
  frequencyHz: number,
  timestamp: number,
  overrides: Partial<FeedbackEvent> = {},
): FeedbackEvent {
  return {
    timestamp,
    frequencyHz,
    amplitudeDb: -30,
    prominenceDb: 8,
    severity: 'moderate',
    confidence: 0.8,
    label: 'Test',
    ...overrides,
  }
}

describe('FeedbackHistory — mode and cooldown', () => {
  let history: FeedbackHistory

  beforeEach(() => {
    history = new FeedbackHistory()
  })

  it('defaults to speech mode', () => {
    expect(history.getMode()).toBe('speech')
  })

  it('setMode updates the mode', () => {
    history.setMode('liveMusic')
    expect(history.getMode()).toBe('liveMusic')
  })

  it('returns per-mode cooldown for known modes', () => {
    for (const [mode, expected] of Object.entries(HOTSPOT_COOLDOWN_BY_MODE)) {
      history.setMode(mode)
      expect(history.getEffectiveCooldown()).toBe(expected)
    }
  })

  it('falls back to HOTSPOT_COOLDOWN_MS for unknown mode', () => {
    history.setMode('unknownMode')
    expect(history.getEffectiveCooldown()).toBe(HOTSPOT_COOLDOWN_MS)
  })

  it('respects per-mode cooldown in monitors mode (1000 ms)', () => {
    history.setMode('monitors')
    const base = 100_000

    history.recordEvent(makeEvent(1000, base))
    expect(history.getOccurrenceCount(1000)).toBe(1)

    // 500 ms later — within 1000 ms cooldown, skipped
    history.recordEvent(makeEvent(1000, base + 500))
    expect(history.getOccurrenceCount(1000)).toBe(1)

    // 1001 ms later — past cooldown, recorded
    history.recordEvent(makeEvent(1000, base + 1001))
    expect(history.getOccurrenceCount(1000)).toBe(2)
  })

  it('respects per-mode cooldown in liveMusic mode (5000 ms)', () => {
    history.setMode('liveMusic')
    const base = 100_000

    history.recordEvent(makeEvent(2000, base))
    expect(history.getOccurrenceCount(2000)).toBe(1)

    history.recordEvent(makeEvent(2000, base + 3000))
    expect(history.getOccurrenceCount(2000)).toBe(1)

    history.recordEvent(makeEvent(2000, base + 5001))
    expect(history.getOccurrenceCount(2000)).toBe(2)
  })

  it('clear() removes current-run recurrence counts', () => {
    history.setMode('speech')
    const base = 100_000

    history.recordEvent(makeEvent(1000, base))
    expect(history.getOccurrenceCount(1000)).toBe(1)

    history.clear()

    history.recordEvent(makeEvent(1000, base + 1000))
    expect(history.getOccurrenceCount(1000)).toBe(1)
  })

})
