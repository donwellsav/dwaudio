// @vitest-environment jsdom
/**
 * Tests for useSignalTint — maps detection severity to CSS tint vars on <html>.
 *
 * Validates color progression (idle → blue → amber → orange → red),
 * hysteresis (instant upgrade, delayed downgrade), and RUNAWAY class toggle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Mock contexts before importing hook ──────────────────────────────────────

let mockAdvisories: { id: string; severity: string; lifecycle?: 'provisional' | 'confirmed' }[] = []
let mockDismissedIds = new Set<string>()
let mockIsRunning = false
let mockInputLevel = -30 // default: adequate signal

vi.mock('@/contexts/AdvisoryContext', () => ({
  useAdvisories: () => ({ advisories: mockAdvisories, dismissedIds: mockDismissedIds }),
  useAdvisoryData: () => ({ advisories: mockAdvisories, dismissedIds: mockDismissedIds }),
}))

vi.mock('@/contexts/EngineContext', () => ({
  useEngine: () => ({ isRunning: mockIsRunning }),
}))

vi.mock('@/contexts/MeteringContext', () => ({
  useMetering: () => ({ inputLevel: mockInputLevel }),
}))

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ settings: { signalTintEnabled: true } }),
}))

// Import after mocks are set up
import { useSignalTint } from '../useSignalTint'

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTint(): [string, string, string] {
  const root = document.documentElement
  return [
    root.style.getPropertyValue('--tint-r'),
    root.style.getPropertyValue('--tint-g'),
    root.style.getPropertyValue('--tint-b'),
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  mockAdvisories = []
  mockDismissedIds = new Set()
  mockIsRunning = false
  mockInputLevel = -30
  // Reset root CSS
  document.documentElement.style.removeProperty('--tint-r')
  document.documentElement.style.removeProperty('--tint-g')
  document.documentElement.style.removeProperty('--tint-b')
  document.documentElement.classList.remove('tint-runaway')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useSignalTint', () => {
  it('sets idle (slate) tint when not running', () => {
    mockIsRunning = false
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Idle = slate gray [100, 116, 139]
    expect(r).toBe('100')
    expect(g).toBe('116')
    expect(b).toBe('139')
  })

  it('sets green tint when running with adequate signal and no advisories', () => {
    mockIsRunning = true
    mockInputLevel = -30 // above -45 threshold
    mockAdvisories = []
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Green = [34, 197, 94]
    expect(r).toBe('34')
    expect(g).toBe('197')
    expect(b).toBe('94')
  })

  it('sets blue tint when running with low signal', () => {
    mockIsRunning = true
    mockInputLevel = -50 // below -45 threshold
    mockAdvisories = []
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Blue = [59, 130, 246]
    expect(r).toBe('59')
    expect(g).toBe('130')
    expect(b).toBe('246')
  })

  it('sets amber tint for low severity (POSSIBLE_RING)', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'POSSIBLE_RING' }]
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Amber = [245, 158, 11]
    expect(r).toBe('245')
    expect(g).toBe('158')
    expect(b).toBe('11')
  })

  it('sets orange tint for GROWING severity', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'GROWING' }]
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Orange = [249, 115, 22]
    expect(r).toBe('249')
    expect(g).toBe('115')
    expect(b).toBe('22')
  })

  it('sets red tint and adds tint-runaway class for RUNAWAY', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY' }]
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // Red = [239, 68, 68]
    expect(r).toBe('239')
    expect(g).toBe('68')
    expect(b).toBe('68')
    expect(document.documentElement.classList.contains('tint-runaway')).toBe(true)
  })

  it('ignores dismissed advisories', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY' }]
    mockDismissedIds = new Set(['1'])
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // All dismissed → green (adequate signal, no active feedback)
    expect(r).toBe('34')
    expect(g).toBe('197')
    expect(b).toBe('94')
  })

  it('ignores provisional advisories for console tint', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY', lifecycle: 'provisional' }]
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    expect(r).toBe('34')
    expect(g).toBe('197')
    expect(b).toBe('94')
  })

  it('uses worst severity when multiple advisories exist', () => {
    mockIsRunning = true
    mockAdvisories = [
      { id: '1', severity: 'POSSIBLE_RING' },
      { id: '2', severity: 'GROWING' },
    ]
    renderHook(() => useSignalTint())

    const [r, g, b] = getTint()
    // GROWING is worse → orange
    expect(r).toBe('249')
    expect(g).toBe('115')
    expect(b).toBe('22')
  })

  it('upgrades tint instantly', () => {
    mockIsRunning = true
    mockAdvisories = []

    const { rerender } = renderHook(() => useSignalTint())
    expect(getTint()[0]).toBe('34') // green (adequate signal, no feedback)

    // Add a RUNAWAY advisory
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY' }]
    rerender()

    // Should upgrade to red immediately (no delay)
    expect(getTint()[0]).toBe('239')
  })

  it('delays downgrade by 1s (hysteresis)', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY' }]

    const { rerender } = renderHook(() => useSignalTint())
    expect(getTint()[0]).toBe('239') // red

    // Remove advisory → should NOT downgrade immediately
    mockAdvisories = []
    rerender()
    expect(getTint()[0]).toBe('239') // still red

    // After 1s, downgrade to green (adequate signal, no feedback)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(getTint()[0]).toBe('34') // green
  })

  it('resets tint vars on cleanup', () => {
    mockIsRunning = true
    mockAdvisories = [{ id: '1', severity: 'RUNAWAY' }]

    const { unmount } = renderHook(() => useSignalTint())
    expect(getTint()[0]).toBe('239')

    unmount()

    // Should reset to neutral slate (TINT_IDLE)
    expect(getTint()[0]).toBe('100')
    expect(getTint()[1]).toBe('116')
    expect(getTint()[2]).toBe('139')
    expect(document.documentElement.classList.contains('tint-runaway')).toBe(false)
  })
})
