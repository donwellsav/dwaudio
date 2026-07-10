// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'
import type { Advisory } from '@/types/advisory'

const mocks = vi.hoisted(() => ({
  useAdvisoryData: vi.fn(),
}))

vi.mock('@/contexts/AdvisoryContext', () => ({
  useAdvisoryData: mocks.useAdvisoryData,
}))

import {
  getPriorityAdvisory,
  PriorityAlertBanner,
} from '../PriorityAlertBanner'

function makeAdvisory(
  id: string,
  severity: Advisory['severity'],
  overrides: Partial<Advisory> = {},
): Advisory {
  return {
    id,
    trackId: `track-${id}`,
    timestamp: Date.now(),
    label: 'ACOUSTIC_FEEDBACK',
    severity,
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
    ...overrides,
  }
}

function makeEarlyWarning(overrides: Partial<EarlyWarning> = {}): EarlyWarning {
  return {
    timestamp: Date.now() - 5000,
    predictedFrequencies: [1000, 2000],
    fundamentalSpacing: 1000,
    estimatedPathLength: 3.4,
    confidence: 0.82,
    ...overrides,
  }
}

function setAdvisoryData({
  advisories = [],
  dismissedIds = new Set<string>(),
  earlyWarning = null,
}: {
  advisories?: Advisory[]
  dismissedIds?: Set<string>
  earlyWarning?: EarlyWarning | null
} = {}) {
  mocks.useAdvisoryData.mockReturnValue({
    advisories,
    dismissedIds,
    earlyWarning,
  })
}

describe('getPriorityAdvisory', () => {
  it('always selects RUNAWAY before GROWING regardless of array order', () => {
    const growing = makeAdvisory('growing', 'GROWING')
    const runaway = makeAdvisory('runaway', 'RUNAWAY')

    expect(getPriorityAdvisory([growing, runaway], new Set())?.id).toBe('runaway')
    expect(getPriorityAdvisory([runaway, growing], new Set())?.id).toBe('runaway')
  })

  it('excludes resolved, provisional, and dismissed advisories while retaining legacy advisories', () => {
    const runaway = makeAdvisory('runaway', 'RUNAWAY')
    const growing = makeAdvisory('growing', 'GROWING')

    expect(getPriorityAdvisory([
      { ...runaway, resolved: true },
      { ...growing, lifecycle: 'provisional' },
    ], new Set())).toBeNull()
    expect(getPriorityAdvisory([runaway], new Set(['runaway']))).toBeNull()
    expect(getPriorityAdvisory([
      { ...growing, lifecycle: undefined },
    ], new Set())?.id).toBe('growing')
  })
})

describe('PriorityAlertBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T12:00:00Z'))
    setAdvisoryData()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows persistent early warning only at five seconds or later', () => {
    const timestamp = Date.now()
    const earlyWarning = makeEarlyWarning({ timestamp })
    setAdvisoryData({ earlyWarning })
    vi.setSystemTime(timestamp + 4999)
    const { unmount } = render(<PriorityAlertBanner onViewIssues={vi.fn()} />)

    expect(screen.queryByRole('status')).toBeNull()

    unmount()
    vi.setSystemTime(timestamp + 5000)
    render(<PriorityAlertBanner onViewIssues={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toContain('Early Warning')
  })

  it('prefers a confirmed urgent advisory and uses severity-appropriate roles', () => {
    setAdvisoryData({
      advisories: [makeAdvisory('runaway', 'RUNAWAY')],
      earlyWarning: makeEarlyWarning(),
    })
    const { rerender } = render(<PriorityAlertBanner onViewIssues={vi.fn()} />)

    expect(screen.getByRole('alert').textContent).toContain('RUNAWAY')
    expect(screen.queryByText('Early Warning')).toBeNull()

    setAdvisoryData({ advisories: [makeAdvisory('growing', 'GROWING')] })
    rerender(<PriorityAlertBanner onViewIssues={vi.fn()} />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Growing')
  })

  it('provides an accessible View issue action', () => {
    const onViewIssues = vi.fn()
    setAdvisoryData({ advisories: [makeAdvisory('runaway', 'RUNAWAY')] })
    render(<PriorityAlertBanner onViewIssues={onViewIssues} />)

    const button = screen.getByRole('button', { name: 'View issue' })
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('min-w-11')
    expect(button.className).toContain('focus-visible:ring')

    fireEvent.click(button)
    expect(onViewIssues).toHaveBeenCalledOnce()
  })
})
