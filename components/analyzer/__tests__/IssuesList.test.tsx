// @vitest-environment jsdom
/**
 * Smoke tests for IssuesList — advisory list rendering, empty states, sorting.
 *
 * Validates standby state, truthful detector state, low-signal guidance,
 * card rendering, and clear-all button.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { IssuesList } from '../IssuesList'
import type { Advisory, SeverityLevel } from '@/types/advisory'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

vi.mock('@/lib/dsp/feedbackHistory', () => ({
  getFeedbackHistory: () => ({
    getOccurrenceCount: () => 1,
    getHotspots: () => [],
  }),
}))

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: { mode: 'speech', fftSize: 8192, minFrequency: 200, maxFrequency: 8000 },
  }),
}))

afterEach(() => {
  vi.useRealTimers()
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdvisory(id: string, severity: SeverityLevel = 'POSSIBLE_RING', overrides: Partial<Advisory> = {}): Advisory {
  return {
    id,
    frequencyBin: 100,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    severity,
    confidence: 0.85,
    timestamp: Date.now() - 5000,
    resolved: false,
    advisory: {
      geq: null,
      peq: { type: 'notch', hz: 1000, q: 4.0, gainDb: -6, bandwidthHz: 250 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: +3 },
    },
    velocityDbPerSec: 0,
    isRunaway: false,
    ...overrides,
  } as Advisory
}

function makeTonalAdvisory(id: string, summary: string): Advisory {
  return makeAdvisory(id, 'GROWING', {
    advisory: {
      geq: { bandIndex: 15, bandHz: 1000, suggestedDb: -6 },
      peq: { type: 'notch', hz: 1000, q: 4.0, gainDb: -6, bandwidthHz: 250 },
      shelves: [
        { type: 'HPF', hz: 80, gainDb: 0, reason: 'Low-end rumble detected' },
        { type: 'lowShelf', hz: 300, gainDb: -3, reason: 'Mud buildup detected' },
      ],
      tonalIssueSummary: summary,
      pitch: { note: 'B', octave: 5, cents: 3, midi: 83 },
    },
  })
}

function DismissUndoHarness({ withSecondIssue = false }: { withSecondIssue?: boolean }) {
  const advisory = makeAdvisory('a1', 'GROWING')
  const advisories = withSecondIssue
    ? [advisory, makeAdvisory('a2', 'GROWING', { trueFrequencyHz: 2000 })]
    : [advisory]
  const [dismissedIds, setDismissedIds] = useState(new Set<string>())

  return (
    <IssuesList
      advisories={advisories}
      dismissedIds={dismissedIds}
      isRunning
      onDismiss={(id) => setDismissedIds((current) => new Set(current).add(id))}
      onRestoreDismissed={(id) => setDismissedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })}
    />
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('IssuesList', () => {
  it('keeps Undo available after dismissing and restores the final issue', () => {
    render(<DismissUndoHarness />)

    expect(screen.getByRole('button', { name: 'Dismiss 1.00kHz' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 1.00kHz' }))

    expect(screen.queryByRole('button', { name: 'Dismiss 1.00kHz' })).toBeNull()
    expect(screen.getByText('Issue dismissed.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByRole('button', { name: 'Dismiss 1.00kHz' })).toBeDefined()
    expect(screen.queryByText('Issue dismissed.')).toBeNull()
  })

  it('replaces the previous Undo target with the latest individual dismissal', () => {
    render(<DismissUndoHarness withSecondIssue />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 1.00kHz' }))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2.00kHz' }))

    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByRole('button', { name: 'Dismiss 2.00kHz' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Dismiss 1.00kHz' })).toBeNull()
    expect(screen.queryByText('Issue dismissed.')).toBeNull()
  })

  it('renders standby state with start button when not running', () => {
    const onStart = vi.fn()
    render(<IssuesList advisories={[]} isRunning={false} onStart={onStart} />)
    expect(screen.getByText(/start analysis/i)).toBeDefined()
  })

  it('shows Listening before detector status and floor are ready', () => {
    render(<IssuesList advisories={[]} isRunning />)
    expect(screen.getByText(/^listening$/i)).toBeDefined()
    expect(screen.queryByText(/all clear/i)).toBeNull()
  })

  it('shows No Actionable Feedback for a usable analyzed signal', () => {
    render(
      <IssuesList
        advisories={[]}
        isRunning
        noiseFloorDb={-90}
        spectrumStatus={{
          peak: -18,
          effectiveThresholdDb: -45,
          contentType: 'unknown',
          isSignalPresent: true,
          lastReportDecision: 'reported',
          lastReportGate: 'reported',
        }}
      />,
    )
    expect(screen.getByText(/no actionable feedback/i)).toBeDefined()
  })

  it('shows Detection Limited while a detector gate blocks reporting', () => {
    render(
      <IssuesList
        advisories={[]}
        isRunning
        noiseFloorDb={-90}
        spectrumStatus={{
          peak: -18,
          effectiveThresholdDb: -45,
          contentType: 'music',
          isSignalPresent: true,
          lastReportDecision: 'blocked',
          lastReportGate: 'music-material',
        }}
      />,
    )
    expect(screen.getByText(/detection limited/i)).toBeDefined()
    expect(screen.getByText(/music material/i)).toBeDefined()
  })

  it('renders compact analyzer status when running with no advisories', () => {
    render(
      <IssuesList
        advisories={[]}
        isRunning={true}
        noiseFloorDb={-90}
        spectrumStatus={{
          peak: -18,
          effectiveThresholdDb: -45,
          contentType: 'music',
          isSignalPresent: true,
          lastConfirmLatencyMs: 84,
          lastFusionVerdict: 'UNCERTAIN',
          lastFeedbackProbability: 0.34,
          lastFusionConfidence: 0.28,
          lastReportDecision: 'blocked',
          lastReportGate: 'fusion-uncertain',
        }}
      />,
    )

    expect(screen.getByText(/detection limited/i)).toBeDefined()
    expect(screen.getByText(/fusion wait/i)).toBeDefined()
    expect(screen.getByText(/pk -18db/i)).toBeDefined()
    expect(screen.getByText(/thr -45db/i)).toBeDefined()
    expect(screen.getByText(/last 84ms/i)).toBeDefined()
    expect(screen.getByText(/prob 34%/i)).toBeDefined()
    expect(screen.getByText(/conf 28%/i)).toBeDefined()
  })

  it('shows Detection Limited and gain guidance for low signal', () => {
    render(<IssuesList advisories={[]} isRunning isLowSignal />)
    expect(screen.getByText(/detection limited/i)).toBeDefined()
    expect(screen.getByText(/low signal/i)).toBeDefined()
    expect(screen.getByText(/increase gain/i)).toBeDefined()
  })

  it('renders advisory cards when advisories exist', () => {
    const advisories = [
      makeAdvisory('a1', 'GROWING'),
      makeAdvisory('a2', 'POSSIBLE_RING', { trueFrequencyHz: 2500 }),
    ]
    const { container } = render(<IssuesList advisories={advisories} isRunning={true} />)
    // Should render 2 glass-card elements
    const cards = container.querySelectorAll('.glass-card')
    expect(cards.length).toBe(2)
  })

  it('limits displayed cards to maxIssues', () => {
    const advisories = Array.from({ length: 8 }, (_, i) =>
      makeAdvisory(`a${i}`, 'POSSIBLE_RING', { trueFrequencyHz: 500 + i * 100 }),
    )
    const { container } = render(<IssuesList advisories={advisories} isRunning={true} maxIssues={5} />)
    const cards = container.querySelectorAll('.glass-card')
    expect(cards.length).toBeLessThanOrEqual(5)
  })

  it('renders screen reader live region', () => {
    render(<IssuesList advisories={[]} isRunning={true} />)
    const liveRegion = document.querySelector('[aria-live="polite"]')
    expect(liveRegion).not.toBeNull()
  })

  it('renders broad tonal issues separately from acute feedback cards', () => {
    const advisories = [
      makeTonalAdvisory('a1', 'HPF at 80Hz for rumble | Low shelf -3dB @ 300Hz'),
    ]

    render(<IssuesList advisories={advisories} isRunning />)

    expect(screen.getByText(/broad tonal note/i)).toBeDefined()
    expect(screen.getByText(/hpf at 80hz for rumble/i)).toBeDefined()
    expect(screen.queryByText(/separate from the acute feedback cut/i)).toBeNull()
  })

  it('dismisses the broad tonal note when requested', () => {
    render(
      <IssuesList
        advisories={[makeTonalAdvisory('a1', 'HPF at 80Hz for rumble')]}
        isRunning
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /dismiss broad tonal note/i }))

    expect(screen.queryByText(/broad tonal note/i)).toBeNull()
  })

  it('auto-hides the broad tonal note after 10 seconds', () => {
    vi.useFakeTimers()
    render(
      <IssuesList
        advisories={[makeTonalAdvisory('a1', 'HPF at 80Hz for rumble')]}
        isRunning
      />,
    )

    expect(screen.getByText(/broad tonal note/i)).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(screen.queryByText(/broad tonal note/i)).toBeNull()
  })

  it('shows the broad tonal note again when the summary changes', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <IssuesList
        advisories={[makeTonalAdvisory('a1', 'HPF at 80Hz for rumble')]}
        isRunning
      />,
    )

    act(() => {
      vi.advanceTimersByTime(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /dismiss broad tonal note/i }))
    expect(screen.queryByText(/broad tonal note/i)).toBeNull()

    rerender(
      <IssuesList
        advisories={[makeTonalAdvisory('a1', 'High shelf -2dB @ 4kHz')]}
        isRunning
      />,
    )

    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(screen.getByText(/broad tonal note/i)).toBeDefined()
    expect(screen.getByText(/high shelf -2db @ 4khz/i)).toBeDefined()
  })
})
