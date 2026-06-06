/**
 * mathHelpers.test.ts
 *
 * Tests for freqToLogPositionFast — the precomputed-constant variant
 * of freqToLogPosition used in hot canvas loops (50fps * 4096 bins).
 * Verifies identical output to the reference implementation across
 * the full audible range and edge cases.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  autocorrelation,
  freqToLogPosition,
  freqToLogPositionFast,
  generateId,
} from '@/lib/utils/mathHelpers'

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pre-compute the constants that callers of freqToLogPositionFast
 * are responsible for computing once before the hot loop.
 */
function precompute(freqMin: number, freqMax: number) {
  const logMin = Math.log10(freqMin)
  const invLogRange = 1 / (Math.log10(freqMax) - logMin)
  return { logMin, invLogRange }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('freqToLogPositionFast', () => {
  const freqMin = 20
  const freqMax = 20000
  const { logMin, invLogRange } = precompute(freqMin, freqMax)

  it('matches freqToLogPosition for standard audio frequencies', () => {
    const testFreqs = [20, 50, 100, 200, 440, 500, 1000, 2000, 4000, 5000, 10000, 15000, 20000]

    for (const freq of testFreqs) {
      const reference = freqToLogPosition(freq, freqMin, freqMax)
      const fast = freqToLogPositionFast(freq, logMin, invLogRange)
      expect(fast).toBeCloseTo(reference, 12)
    }
  })

  it('returns 0 at freqMin', () => {
    const result = freqToLogPositionFast(freqMin, logMin, invLogRange)
    expect(result).toBeCloseTo(0, 12)
  })

  it('returns 1 at freqMax', () => {
    const result = freqToLogPositionFast(freqMax, logMin, invLogRange)
    expect(result).toBeCloseTo(1, 12)
  })

  it('returns ~0.5 at the geometric midpoint', () => {
    const geometricMid = Math.sqrt(freqMin * freqMax) // ~632 Hz
    const result = freqToLogPositionFast(geometricMid, logMin, invLogRange)
    expect(result).toBeCloseTo(0.5, 12)
  })

  it('returns negative value for frequency below freqMin', () => {
    const result = freqToLogPositionFast(10, logMin, invLogRange)
    expect(result).toBeLessThan(0)
  })

  it('returns value > 1 for frequency above freqMax', () => {
    const result = freqToLogPositionFast(30000, logMin, invLogRange)
    expect(result).toBeGreaterThan(1)
  })

  it('matches reference across a different range (speech band 200-8000 Hz)', () => {
    const speechMin = 200
    const speechMax = 8000
    const { logMin: sLogMin, invLogRange: sInv } = precompute(speechMin, speechMax)

    const testFreqs = [200, 300, 500, 1000, 2000, 4000, 8000]
    for (const freq of testFreqs) {
      const reference = freqToLogPosition(freq, speechMin, speechMax)
      const fast = freqToLogPositionFast(freq, sLogMin, sInv)
      expect(fast).toBeCloseTo(reference, 12)
    }
  })

  it('preserves monotonic ordering', () => {
    const freqs = [20, 100, 500, 1000, 5000, 20000]
    let prev = -Infinity
    for (const freq of freqs) {
      const val = freqToLogPositionFast(freq, logMin, invLogRange)
      expect(val).toBeGreaterThan(prev)
      prev = val
    }
  })
})

describe('generateId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
    })

    expect(generateId()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('falls back to crypto.getRandomValues before Math.random', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((array: Uint32Array) => {
        array[0] = 123
        array[1] = 456
        return array
      }),
    })

    expect(generateId()).toMatch(/^[a-z0-9]+-3fco$/)
  })
})

describe('autocorrelation', () => {
  it('returns 0 for invalid lags instead of NaN', () => {
    expect(autocorrelation([1, 2, 3], -1)).toBe(0)
    expect(autocorrelation([1, 2, 3], 1.5)).toBe(0)
    expect(autocorrelation([1, 2, 3], 3)).toBe(0)
  })
})
