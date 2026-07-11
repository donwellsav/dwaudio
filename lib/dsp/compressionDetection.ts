/**
 * Compression Detection & Spectral Flatness
 *
 * AmplitudeHistoryBuffer tracks spectral peak/mean history for crest analysis.
 * calculateSpectralFlatness measures how "tonal" a spectral peak is.
 */

import {
  SPECTRAL_FLATNESS_SETTINGS,
  COMPRESSION_SETTINGS,
} from './constants'
import { medianInPlace64 } from '@/lib/utils/mathHelpers'
import { dbToLinearLut } from './expLut'

// ── Pre-allocated Scratch Buffers ───────────────────────────────────────────
// Spectral flatness: max bandwidth=10 → max 21 bins. Sized at 21.
const _regionScratch = new Float64Array(21)
const _regionDbScratch = new Float64Array(21)

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpectralFlatnessResult {
  flatness: number
  kurtosis: number
  feedbackScore: number
  isFeedbackLikely: boolean
}

export interface CompressionResult {
  isCompressed: boolean
  estimatedRatio: number
  crestFactor: number
  dynamicRange: number
  thresholdMultiplier: number
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SPECTRAL_CONSTANTS = {
  PURE_TONE_FLATNESS: SPECTRAL_FLATNESS_SETTINGS.PURE_TONE,
  MUSIC_FLATNESS: SPECTRAL_FLATNESS_SETTINGS.MUSIC,
  HIGH_KURTOSIS: SPECTRAL_FLATNESS_SETTINGS.HIGH_KURTOSIS,
  ANALYSIS_BANDWIDTH_BINS: SPECTRAL_FLATNESS_SETTINGS.ANALYSIS_BANDWIDTH,
} as const

export const COMPRESSION_CONSTANTS = {
  NORMAL_CREST_FACTOR: COMPRESSION_SETTINGS.NORMAL_CREST_FACTOR,
  COMPRESSED_CREST_FACTOR: COMPRESSION_SETTINGS.COMPRESSED_CREST_FACTOR,
  MIN_DYNAMIC_RANGE: COMPRESSION_SETTINGS.MIN_DYNAMIC_RANGE,
  COMPRESSED_DYNAMIC_RANGE: COMPRESSION_SETTINGS.COMPRESSED_DYNAMIC_RANGE,
  ANALYSIS_WINDOW_MS: 500,
} as const

// ── Spectral Flatness + Kurtosis ─────────────────────────────────────────────

/**
 * Calculate spectral flatness (Wiener entropy) around a peak bin.
 *
 * F7 fix: Combines geometric/arithmetic flatness with an explicit peak-width
 * statistic. A broad resonance (many bins within 10 dB of peak) gets its
 * flatness boosted toward the music-like range, preventing misclassification
 * of broad humps as pure tones.
 *
 * @param spectrum  dB-scale Float32Array (AnalyserNode format)
 * @param peakBin   Center bin index
 * @param bandwidth Half-width in bins (default 5)
 * @returns SpectralFlatnessResult with width-adjusted flatness
 *
 * @see Glasberg & Moore, "A Model of Loudness Applicable to Time-Varying Sounds"
 */
export function calculateSpectralFlatness(
  spectrum: Float32Array,
  peakBin: number,
  bandwidth?: number
): SpectralFlatnessResult {
  const bw = bandwidth ?? 5
  const startBin = Math.max(0, peakBin - bw)
  const endBin   = Math.min(spectrum.length - 1, peakBin + bw)

  // Zero-allocation: use pre-allocated scratch buffers instead of number[] arrays.
  // Single pass computes logSum + linearSum + peakDb + copies values.
  let count = 0
  let logSum = 0
  let linearSum = 0
  let peakDb = -Infinity

  for (let i = startBin; i <= endBin; i++) {
    const db = spectrum[i]
    if (!isFinite(db)) continue // Skip -Infinity/NaN — LUT can't represent true zero
    const linear = dbToLinearLut(db)
    if (linear > 0) {
      _regionScratch[count] = linear
      _regionDbScratch[count] = spectrum[i]
      logSum += Math.log(linear)
      linearSum += linear
      if (spectrum[i] > peakDb) peakDb = spectrum[i]
      count++
    }
  }

  if (count === 0) {
    return { flatness: 1, kurtosis: 0, feedbackScore: 0, isFeedbackLikely: false }
  }

  // Raw geometric/arithmetic flatness
  const geometricMean = Math.exp(logSum / count)
  const arithmeticMean = linearSum / count
  let flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 1

  // F7: Width-adjusted flatness — count bins within 10 dB of the peak.
  // Only applies when raw flatness is low (< MUSIC_FLATNESS), meaning the
  // geometric/arithmetic ratio alone thinks this is tone-like. For already-high
  // flatness (uniform noise, etc.), no adjustment needed.
  // Narrow line spectra: 1-3 elevated bins → no adjustment.
  // Broad resonances: many elevated bins → flatness boosted toward music range.
  if (flatness < SPECTRAL_CONSTANTS.MUSIC_FLATNESS) {
    const ELEVATION_THRESHOLD_DB = 10
    let elevatedCount = 0
    for (let i = 0; i < count; i++) {
      if (peakDb - _regionDbScratch[i] <= ELEVATION_THRESHOLD_DB) {
        elevatedCount++
      }
    }
    // elevatedRatio: 0 when only peak bin elevated, ~1 when all bins elevated
    const elevatedRatio = count > 1 ? (elevatedCount - 1) / (count - 1) : 0
    // Blend raw flatness toward music-like value when many bins are elevated.
    // For narrow peaks (elevatedRatio ~0): no change.
    // For broad peaks (elevatedRatio ~1): flatness pulled toward MUSIC_FLATNESS.
    flatness = flatness + elevatedRatio * (SPECTRAL_CONSTANTS.MUSIC_FLATNESS - flatness)
  }

  // Single-pass m2/m4 computation using multiply instead of Math.pow()
  const mean = arithmeticMean
  let m2Sum = 0
  let m4Sum = 0
  for (let i = 0; i < count; i++) {
    const d = _regionScratch[i] - mean
    const d2 = d * d
    m2Sum += d2
    m4Sum += d2 * d2
  }
  const m2 = m2Sum / count
  const m4 = m4Sum / count
  const kurtosis = m2 > 0 ? m4 / (m2 * m2) - 3 : 0

  const flatnessScore  = 1 - Math.min(flatness / SPECTRAL_CONSTANTS.MUSIC_FLATNESS, 1)
  const kurtosisScore  = Math.min(Math.max(kurtosis, 0) / SPECTRAL_CONSTANTS.HIGH_KURTOSIS, 1)
  const feedbackScore  = flatnessScore * 0.6 + kurtosisScore * 0.4
  const isFeedbackLikely = flatness < SPECTRAL_CONSTANTS.PURE_TONE_FLATNESS &&
                           kurtosis > SPECTRAL_CONSTANTS.HIGH_KURTOSIS / 2

  return { flatness, kurtosis, feedbackScore, isFeedbackLikely }
}

// ── Amplitude History Buffer (v3) ────────────────────────────────────────────

/**
 * AmplitudeHistoryBuffer v3.
 *
 * Uses Float64Array circular buffers (writePos + count) to avoid the
 * push/shift allocation pattern that caused the stale Turbopack parse error
 * in v1. Peak and RMS are stored separately for true dynamic range measurement.
 */
export class AmplitudeHistoryBuffer {
  private readonly peakHistory: Float64Array
  private readonly rmsHistory: Float64Array
  private writePos: number = 0
  private count: number = 0
  private readonly maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize     = maxSize
    this.peakHistory = new Float64Array(maxSize)
    this.rmsHistory  = new Float64Array(maxSize)
  }

  addSample(peakDb: number, rmsDb: number): void {
    this.peakHistory[this.writePos] = peakDb
    this.rmsHistory[this.writePos]  = rmsDb
    this.writePos = (this.writePos + 1) % this.maxSize
    if (this.count < this.maxSize) this.count++
  }

  /**
   * Describe spectral crest. This is diagnostic evidence, not a measurement of
   * waveform crest factor or dynamic compression. The legacy `dynamicRange`
   * field contains median per-frame spectral crest for compatibility.
   */
  detectCompression(): CompressionResult {
    if (this.count < 10) {
      return {
        isCompressed: false,
        estimatedRatio: 1,
        crestFactor: COMPRESSION_CONSTANTS.NORMAL_CREST_FACTOR,
        dynamicRange: COMPRESSION_CONSTANTS.MIN_DYNAMIC_RANGE,
        thresholdMultiplier: 1,
      }
    }

    // Collect per-frame crest values (peak - RMS for each frame)
    const crestValues = new Float64Array(this.count)
    let crestSum = 0

    for (let i = 0; i < this.count; i++) {
      const p = this.peakHistory[i]
      const r = this.rmsHistory[i]
      const crest = p - r
      crestValues[i] = crest
      crestSum += crest
    }

    const crestFactor = crestSum / this.count

    // F8: Same-frame dynamic range via median per-frame crest.
    // The old metric (maxPeak - minRms) mixed values from different frames,
    // overstating range for signals with alternating loud/quiet frames.
    // Median per-frame crest reflects the typical frame's peak-to-RMS gap.
    // Zero-allocation: in-place quickselect on the local Float64Array (safe — not reused after).
    const dynamicRange = medianInPlace64(crestValues.subarray(0, this.count))

    const normalCrest    = COMPRESSION_CONSTANTS.NORMAL_CREST_FACTOR
    const estimatedRatio = normalCrest / Math.max(crestFactor, 1)

    const isCompressed =
      crestFactor  < COMPRESSION_CONSTANTS.COMPRESSED_CREST_FACTOR ||
      dynamicRange < COMPRESSION_CONSTANTS.COMPRESSED_DYNAMIC_RANGE

    const thresholdMultiplier = isCompressed
      ? Math.min(1 + (estimatedRatio - 1) * 0.25, 1.5)
      : 1

    return { isCompressed, estimatedRatio, crestFactor, dynamicRange, thresholdMultiplier }
  }

  reset(): void {
    this.writePos = 0
    this.count    = 0
    this.peakHistory.fill(0)
    this.rmsHistory.fill(0)
  }
}
