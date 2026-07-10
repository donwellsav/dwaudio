// @vitest-environment jsdom
/**
 * Smoke tests for IssueCard - advisory card rendering, severity states, badges.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IssueCard, formatIssueAge } from '@/components/analyzer/IssueCard'
import type { Advisory, SeverityLevel } from '@/types/advisory'

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

function makeAdvisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: 'test-1',
    frequencyBin: 100,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    severity: 'POSSIBLE_RING' as SeverityLevel,
    confidence: 0.85,
    timestamp: Date.now() - 5000,
    resolved: false,
    advisory: {
      geq: null,
      peq: { type: 'notch', hz: 1000, q: 4.0, gainDb: -6, bandwidthHz: 250 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 3 },
    },
    velocityDbPerSec: 0,
    isRunaway: false,
    ...overrides,
  } as Advisory
}

describe('IssueCard', () => {
  it('does not treat monotonic analyzer timestamps as wall-clock ages', () => {
    expect(formatIssueAge(1_800_000_000_000, 10_000)).toBe('just now')
  })

  it('formats wall-clock advisory ages normally', () => {
    const now = 1_800_000_000_000

    expect(formatIssueAge(now, now - 10_000)).toBe('10s')
    expect(formatIssueAge(now, now - 65_000)).toBe('1m')
  })

  it('renders frequency text', () => {
    render(<IssueCard advisory={makeAdvisory()} occurrenceCount={1} />)
    const matches = screen.getAllByText(/1.*kHz|1.*000.*Hz/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders severity icon pill', () => {
    render(
      <IssueCard
        advisory={makeAdvisory({ severity: 'GROWING' as SeverityLevel })}
        occurrenceCount={1}
      />,
    )

    expect(screen.getByTitle(/growing/i)).toBeDefined()
  })

  it('renders confidence badge', () => {
    render(<IssueCard advisory={makeAdvisory({ confidence: 0.92 })} occurrenceCount={1} />)
    expect(screen.getByText('92%')).toBeDefined()
  })

  it('renders confirmation latency when available', () => {
    render(<IssueCard advisory={makeAdvisory({ confirmLatencyMs: 140 })} occurrenceCount={1} />)
    expect(screen.getByText(/140ms/i)).toBeDefined()
  })

  it('renders provisional cards as quiet watch states without EQ cuts', () => {
    render(
      <IssueCard
        advisory={makeAdvisory({
          lifecycle: 'provisional',
          confidence: 0.34,
        })}
        occurrenceCount={1}
      />,
    )

    expect(screen.getByText(/watch/i)).toBeDefined()
    expect(screen.queryByText(/-6dB/i)).toBeNull()
    expect(screen.queryByText(/Q:4/i)).toBeNull()
  })

  it('labels held cards as cleared instead of active detections', () => {
    render(<IssueCard advisory={makeAdvisory()} occurrenceCount={1} isHeld />)
    expect(screen.getByText(/cleared/i)).toBeDefined()
  })

  it('labels resolved cards as cleared instead of leaving stale-looking issues', () => {
    render(<IssueCard advisory={makeAdvisory({ resolved: true })} occurrenceCount={1} />)
    expect(screen.getByText(/cleared/i)).toBeDefined()
  })

  it('does not render the internal advisory id', () => {
    const { container } = render(
      <IssueCard advisory={makeAdvisory({ id: 'adv-visible-id-123' })} occurrenceCount={1} />,
    )

    expect(container.textContent).not.toContain('adv-visible-id-123')
  })

  it('does not show the default narrow-cut strategy label', () => {
    render(<IssueCard advisory={makeAdvisory()} occurrenceCount={1} />)
    expect(screen.queryByText(/narrow cut/i)).toBeNull()
  })

  it('keeps mobile action icons compact without padded touch boxes', () => {
    const { container } = render(
      <IssueCard
        advisory={makeAdvisory()}
        occurrenceCount={1}
        touchFriendly
        onDismiss={vi.fn()}
      />,
    )

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThanOrEqual(2)

    for (const button of buttons) {
      expect(button.className).toContain('p-0')
      expect(button.className).not.toContain('[44px]')
      expect(button.className).not.toMatch(/\bh-8\b|\bw-8\b/)
    }
  })

  it('labels and announces a successful issue-guidance copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const advisory = makeAdvisory()

    render(
      <IssueCard
        advisory={{
          ...advisory,
          advisory: {
            ...advisory.advisory,
            geq: { bandHz: 1000, bandIndex: 12, suggestedDb: -3 },
          },
        }}
        occurrenceCount={1}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue guidance for 1.00kHz' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Issue guidance copied')
    })
    expect(writeText).toHaveBeenCalledWith(
      'GEQ: Pull 1000Hz fader to -3dB | PEQ: Notch at 1000.0Hz, Q=4.0, -6dB | Pitch: B5 +3c',
    )
  })

  it('renders repeat offender badge and guidance when occurrenceCount >= 3', () => {
    render(<IssueCard advisory={makeAdvisory()} occurrenceCount={5} />)
    const badge = screen.getByLabelText(/repeat offender: detected 5 times/i)
    expect(badge).toBeDefined()
    // Guidance text lives in the badge's title tooltip + aria-label (not visible DOM)
    expect(badge.getAttribute('title')).toMatch(/check mic\/speaker geometry/i)
    expect(badge.getAttribute('aria-label')).toMatch(/check mic\/speaker geometry/i)
  })

  it('does not render repeat badge when occurrenceCount < 3', () => {
    const { container } = render(<IssueCard advisory={makeAdvisory()} occurrenceCount={2} />)
    expect(container.textContent?.toLowerCase()).not.toContain('repeat band')
  })

  it('renders RUNAWAY velocity indicator', () => {
    render(
      <IssueCard
        advisory={makeAdvisory({
          severity: 'RUNAWAY' as SeverityLevel,
          isRunaway: true,
          velocityDbPerSec: 20,
        })}
        occurrenceCount={1}
      />,
    )

    expect(screen.getByText(/20.*dB\/s/i)).toBeDefined()
  })

  it('applies emergency-glow class for RUNAWAY', () => {
    const { container } = render(
      <IssueCard
        advisory={makeAdvisory({
          severity: 'RUNAWAY' as SeverityLevel,
          isRunaway: true,
          velocityDbPerSec: 20,
        })}
        occurrenceCount={1}
      />,
    )

    const card = container.firstElementChild as HTMLElement
    expect(card.className).toContain('animate-emergency-glow')
  })

  it('applies wider accent strip for RUNAWAY', () => {
    const { container } = render(
      <IssueCard
        advisory={makeAdvisory({
          severity: 'RUNAWAY' as SeverityLevel,
          isRunaway: true,
          velocityDbPerSec: 20,
        })}
        occurrenceCount={1}
      />,
    )

    const strip = container.querySelector('.severity-accent-strip-runaway')
    expect(strip).not.toBeNull()
  })

  it('renders PEQ details when showPeqDetails is true', () => {
    render(
      <IssueCard
        advisory={makeAdvisory()}
        occurrenceCount={1}
        showPeqDetails
      />,
    )

    const matches = screen.getAllByText(/Q:4\.0/)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders notch SVG when PEQ details shown', () => {
    const { container } = render(
      <IssueCard
        advisory={makeAdvisory()}
        occurrenceCount={1}
        showPeqDetails
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('renders resolved card without progress bar', () => {
    const { container } = render(
      <IssueCard
        advisory={makeAdvisory({ resolved: true })}
        occurrenceCount={1}
      />,
    )

    const bars = container.querySelectorAll('[aria-hidden="true"]')
    const progressBar = Array.from(bars).find((element) =>
      element.className?.includes?.('h-[3px]'),
    )
    expect(progressBar).toBeUndefined()
  })

  it('renders broader-region guidance when nearby peaks were merged', () => {
    render(
      <IssueCard
        advisory={makeAdvisory({
          clusterCount: 3,
          clusterMinHz: 980,
          clusterMaxHz: 1060,
          advisory: {
            geq: { bandIndex: 15, bandHz: 1000, suggestedDb: -6 },
            peq: {
              type: 'bell',
              hz: 1000,
              q: 4,
              gainDb: -6,
              bandwidthHz: 250,
              qSource: 'cluster',
              strategy: 'broad-region',
              reason: 'Q widened to cover the broader unstable region from 980 Hz - 1.1 kHz.',
            },
            shelves: [],
            pitch: { note: 'B', octave: 5, cents: 3, midi: 83 },
          },
        })}
        occurrenceCount={1}
      />,
    )

    expect(screen.queryByText(/merged 3 nearby peaks into one broad region/i)).toBeNull()
    expect(screen.queryByText(/q widened to cover the broader unstable region/i)).toBeNull()

    const clusterBadge = screen.getByLabelText(/merged 3 nearby peaks into one broad region/i)
    expect(clusterBadge.getAttribute('title')).toMatch(/adding more notches/i)

    const broadRegion = screen.getByText('Broad Region')
    expect(broadRegion.getAttribute('title')).toMatch(/q widened to cover the broader unstable region/i)
  })

  it('renders pure whistle advisories as warning-only without corrective PEQ copy', () => {
    const baseEqAdvisory = makeAdvisory().advisory

    render(
      <IssueCard
        advisory={makeAdvisory({
          label: 'WHISTLE',
          severity: 'WHISTLE' as SeverityLevel,
          advisory: {
            ...baseEqAdvisory,
            peq: { type: 'bell', hz: 1000, q: 6, gainDb: 0, bandwidthHz: 180 },
            shelves: [],
            pitch: { note: 'B', octave: 5, cents: 3, midi: 83 },
          },
        })}
        occurrenceCount={1}
      />,
    )

    expect(screen.getByText(/warning only · no eq cut/i)).toBeDefined()
    const warningOnly = screen.getByText(/warning only.*no eq cut/i)
    expect(warningOnly).toBeDefined()
    expect(warningOnly.getAttribute('title')).toMatch(/whistle alert only/i)
    expect(screen.queryByText(/whistle alert only/i)).toBeNull()
    expect(screen.queryByText(/Q:/i)).toBeNull()
  })
})
