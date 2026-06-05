/**
 * Calibration Table Computation — A-Weighting
 *
 * Pure functions that build the A-weighting lookup table and resulting
 * analysis dB bounds.
 *
 * Called once per config change, never in the hot path.
 *
 * @see IEC 61672-1:2013 — A-frequency-weighting
 */

import { A_WEIGHTING } from './constants'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationResult {
  table: Float32Array
  minDb: number
  maxDb: number
}

export interface AnalysisDbBounds {
  analysisMinDb: number
  analysisMaxDb: number
}

// ── A-Weighting ─────────────────────────────────────────────────────────────

/**
 * A-weighting dB offset for a single frequency.
 * IEC 61672-1 analog filter approximation.
 */
export function aWeightingDb(fHz: number): number {
  if (fHz <= 0) return A_WEIGHTING.MIN_DB

  const f2 = fHz * fHz
  const { C1, C2, C3, C4, OFFSET } = A_WEIGHTING
  const c1_2 = C1 * C1
  const c2_2 = C2 * C2
  const c3_2 = C3 * C3
  const c4_2 = C4 * C4

  const num = c4_2 * (f2 * f2)
  const den = (f2 + c1_2) * (f2 + c4_2) * Math.sqrt((f2 + c2_2) * (f2 + c3_2))

  const ra = num / den
  if (ra <= 0 || !Number.isFinite(ra)) return A_WEIGHTING.MIN_DB

  return OFFSET + 20 * Math.log10(ra)
}

/**
 * Build the full A-weighting lookup table for every FFT bin.
 * @returns table + min/max dB offsets for analysis bounds
 */
export function computeAWeightingTable(
  fftSize: number,
  sampleRate: number,
  enabled: boolean,
): CalibrationResult {
  const halfBins = fftSize / 2
  const table = new Float32Array(halfBins)

  if (!enabled) {
    return { table, minDb: 0, maxDb: 0 }
  }

  const hzPerBin = sampleRate / fftSize
  let min = Infinity
  let max = -Infinity

  for (let i = 0; i < halfBins; i++) {
    const f = i * hzPerBin
    let w = aWeightingDb(f)
    if (!Number.isFinite(w)) w = A_WEIGHTING.MIN_DB
    table[i] = w
    if (w < min) min = w
    if (w > max) max = w
  }

  return {
    table,
    minDb: Number.isFinite(min) ? min : 0,
    maxDb: Number.isFinite(max) ? max : 0,
  }
}

// ── Analysis Bounds ─────────────────────────────────────────────────────────

/**
 * Compute effective dB analysis range from A-weighting offsets.
 * Base range is [-100, 0] dB.
 */
export function computeAnalysisDbBounds(
  aWeightingEnabled: boolean,
  aWeightingMinDb: number,
  aWeightingMaxDb: number,
): AnalysisDbBounds {
  let minOffset = 0
  let maxOffset = 0
  if (aWeightingEnabled) {
    minOffset += aWeightingMinDb
    maxOffset += aWeightingMaxDb
  }
  return {
    analysisMinDb: -100 + minOffset,
    analysisMaxDb: 0 + maxOffset,
  }
}
