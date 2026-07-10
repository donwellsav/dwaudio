// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildIssueCardDerivedState,
  copyTextToClipboard,
  formatIssueCardCopyText,
  resolveIssueCardActionsLayout,
} from '@/hooks/useIssueCardState'
import type { Advisory } from '@/types/advisory'

function makeAdvisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: 'adv-1',
    trackId: 'track-1',
    timestamp: 1,
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'POSSIBLE_RING',
    confidence: 0.85,
    why: ['test'],
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    prominenceDb: 8,
    qEstimate: 4,
    bandwidthHz: 250,
    velocityDbPerSec: 0,
    stabilityCentsStd: 0,
    harmonicityScore: 0,
    modulationScore: 0,
    advisory: {
      geq: { bandHz: 1000, bandIndex: 12, suggestedDb: -3 },
      peq: { type: 'notch', hz: 1000, q: 4, gainDb: -6, bandwidthHz: 250 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 3, midi: 83 },
    },
    ...overrides,
  }
}

describe('useIssueCardState helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'clipboard')
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('derives clustered frequency text and runaway state from an advisory', () => {
    const derived = buildIssueCardDerivedState(makeAdvisory({
      velocityDbPerSec: 18,
      clusterCount: 3,
      clusterMinHz: 980,
      clusterMaxHz: 1030,
    }))

    expect(derived.isClustered).toBe(true)
    expect(derived.isRunaway).toBe(true)
    expect(derived.exactFreqStr).toMatch(/980/)
  })

  it('builds a notch svg path when PEQ data exists', () => {
    const derived = buildIssueCardDerivedState(makeAdvisory())
    expect(derived.peqNotchSvgPath).toMatch(/^M 0 5 L /)
  })

  it('resolves action layout from touch settings', () => {
    expect(resolveIssueCardActionsLayout(false)).toBe('desktop')
    expect(resolveIssueCardActionsLayout(true)).toBe('mobile')
  })

  it('formats complete confirmed issue guidance', () => {
    expect(formatIssueCardCopyText(makeAdvisory())).toBe(
      'GEQ: Pull 1000Hz fader to -3dB | PEQ: Notch at 1000.0Hz, Q=4.0, -6dB | Pitch: B5 +3c',
    )
  })

  it('keeps provisional copy free of unconfirmed EQ cuts', () => {
    expect(formatIssueCardCopyText(makeAdvisory({ lifecycle: 'provisional' }))).toBe(
      '1.00kHz (B5 +3c) | Possible feedback - watching only; no EQ cut until confirmed.',
    )
  })

  it('keeps warning-only whistle copy free of hidden EQ cuts', () => {
    expect(formatIssueCardCopyText(makeAdvisory({
      label: 'WHISTLE',
      severity: 'WHISTLE',
    }))).toBe(
      '1.00kHz (B5 +3c) | Whistle alert only - verify mic and speaker placement first. No EQ cut recommended.',
    )
  })

  it('includes strategy and broad tonal guidance in confirmed copy', () => {
    const baseAdvisory = makeAdvisory()
    const copyText = formatIssueCardCopyText(makeAdvisory({
      advisory: {
        ...baseAdvisory.advisory,
        peq: {
          ...baseAdvisory.advisory.peq,
          reason: 'Q widened to cover a broader unstable region.',
        },
        tonalIssueSummary: 'Low shelf -3dB @ 300Hz',
      },
    }))

    expect(copyText).toContain('Strategy: Q widened to cover a broader unstable region.')
    expect(copyText).toContain('Broad tonal note: Low shelf -3dB @ 300Hz')
  })

  it('copies issue text through navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await expect(copyTextToClipboard('1 kHz')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('1 kHz')
  })

  it('falls back to local DOM copy when navigator.clipboard is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    await expect(copyTextToClipboard('1 kHz')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('returns false instead of throwing when no copy mechanism is available', async () => {
    await expect(copyTextToClipboard('1 kHz')).resolves.toBe(false)
  })
})
