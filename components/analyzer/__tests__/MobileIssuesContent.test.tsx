// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MobileIssuesContent } from '@/components/analyzer/MobileLayoutSections'
import type { Advisory } from '@/types/advisory'

vi.mock('@/components/analyzer/IssuesList', () => ({
  IssuesList: ({ advisories }: { advisories: Advisory[] }) => (
    <div data-testid="issues-list">{advisories.length}</div>
  ),
}))

vi.mock('@/components/analyzer/EarlyWarningPanel', () => ({
  EarlyWarningPanel: () => <div data-testid="early-warning-panel" />,
}))

vi.mock('@/components/analyzer/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

function makeAdvisory(id: string): Advisory {
  return {
    id,
    trackId: `track-${id}`,
    timestamp: Date.now(),
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'GROWING',
    confidence: 0.9,
    why: ['test'],
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    prominenceDb: 10,
    qEstimate: 4,
    bandwidthHz: 250,
    velocityDbPerSec: 1,
    stabilityCentsStd: 0,
    harmonicityScore: 0,
    modulationScore: 0,
    advisory: {
      geq: { bandIndex: 15, bandHz: 1000, suggestedDb: -6 },
      peq: { type: 'bell', hz: 1000, q: 4, gainDb: -6 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 0, midi: 83 },
    },
  }
}

const baseIssuesListProps = {
  dismissedIds: new Set<string>(),
  isRunning: true,
  onStart: vi.fn(),
  isLowSignal: false,
  showAlgorithmScores: false,
  showPeqDetails: false,
  onDismiss: vi.fn(),
}

describe('MobileIssuesContent', () => {
  it('shows the issues list and early warning panel', () => {
    render(
      <MobileIssuesContent
        mobileAdvisories={[makeAdvisory('adv-1')]}
        earlyWarning={null}
        issuesListBaseProps={baseIssuesListProps}
        onClearAll={vi.fn()}
        onClearResolved={vi.fn()}
      />,
    )

    expect(screen.getByTestId('issues-list').textContent).toBe('1')
    expect(screen.queryByTestId('early-warning-panel')).not.toBeNull()
  })
})
