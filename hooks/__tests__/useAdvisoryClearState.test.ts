// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Advisory } from '@/types/advisory'
import { useAdvisoryClearState } from '../useAdvisoryClearState'

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
    resolved: false,
    advisory: {
      geq: { bandHz: 1000, suggestedDb: -3 },
      peq: { frequencyHz: 1000, q: 15, gainDb: -6, type: 'bell' },
      pitch: { note: 'B', octave: 5, cents: -14 },
    },
    ...overrides,
  } as Advisory
}

describe('useAdvisoryClearState', () => {
  it('tracks one individual dismissal target and clears it on restore or bulk clear', () => {
    const advisories = [
      makeAdvisory({ id: 'a1' }),
      makeAdvisory({ id: 'a2', resolved: true }),
    ]
    const { result } = renderHook(() => useAdvisoryClearState(advisories))

    expect(result.current.lastDismissedId).toBeNull()

    act(() => result.current.onDismiss('a1'))
    expect(result.current.lastDismissedId).toBe('a1')

    act(() => result.current.onDismiss('a2'))
    expect(result.current.lastDismissedId).toBe('a2')

    act(() => result.current.restoreDismissed('a2'))
    expect(result.current.lastDismissedId).toBeNull()

    act(() => result.current.onDismiss('a1'))
    act(() => result.current.onClearResolved())
    expect(result.current.lastDismissedId).toBeNull()

    act(() => result.current.onDismiss('a1'))
    act(() => result.current.onClearAll())
    expect(result.current.lastDismissedId).toBeNull()
  })

  it('prunes cleared ids when advisories disappear', () => {
    const firstAdvisory = makeAdvisory({ id: 'a1' })
    const secondAdvisory = makeAdvisory({ id: 'a2' })
    const { result, rerender } = renderHook(
      ({ advisories }) => useAdvisoryClearState(advisories),
      {
        initialProps: { advisories: [firstAdvisory, secondAdvisory] as Advisory[] },
      },
    )

    act(() => {
      result.current.onDismiss('a1')
      result.current.onClearGEQ()
      result.current.onClearRTA()
    })

    rerender({ advisories: [secondAdvisory] })

    expect(result.current.clearState.dismissed.has('a1')).toBe(false)
    expect(result.current.lastDismissedId).toBeNull()
    expect(result.current.clearState.geqCleared.has('a1')).toBe(false)
    expect(result.current.clearState.rtaCleared.has('a1')).toBe(false)
    expect(result.current.clearState.geqCleared.has('a2')).toBe(true)
    expect(result.current.clearState.rtaCleared.has('a2')).toBe(true)
  })

  it('keeps separate hook instances isolated', () => {
    const advisories = [makeAdvisory({ id: 'a1' })]
    const firstHook = renderHook(() => useAdvisoryClearState(advisories))
    const secondHook = renderHook(() => useAdvisoryClearState(advisories))

    act(() => {
      firstHook.result.current.onDismiss('a1')
    })

    expect(firstHook.result.current.clearState.dismissed.has('a1')).toBe(true)
    expect(secondHook.result.current.clearState.dismissed.has('a1')).toBe(false)
  })
})
