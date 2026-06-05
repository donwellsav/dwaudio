/**
 * Spectral Analysis Algorithms — IHR, PTMR, Content Type Detection
 *
 * Three independent spectral analysis operators for feedback/music discrimination:
 * - Inter-Harmonic Ratio (IHR): feedback has clean tones, music has rich harmonics
 * - Peak-to-Median Ratio (PTMR): feedback peaks are narrow, music is broad
 * - Content Type Detection: speech/music/compressed classification
 *
 * Extracted from algorithmFusion.ts for maintainability.
 */

import type { ContentType } from '@/types/advisory'
import { TEMPORAL_ENVELOPE } from './constants'
import { COMPRESSION_CONSTANTS } from './compressionDetection'
import { medianInPlace } from '@/lib/utils/mathHelpers'
import { dbToLinearLut } from './expLut'

// Re-export for barrel compatibility
export type { ContentType } from '@/types/advisory'

// ── Pre-allocated Scratch Buffers ───────────────────────────────────────────
// PTMR: halfWidth=20, excluding ±2 bins around peak → max ~37 values. 64 for safety.
const _ptmrScratch = new Float32Array(64)
// Content type detection: power cache for merged spectrum passes (8192 FFT / 2 + 1)
const _powerCache = new Float64Array(4097)

// ── Types ────────────────────────────────────────────────────────────────────

export interface InterHarmonicResult {
  /** Ratio of energy between harmonics vs at harmonics (0 = clean, 1 = noisy) */
  interHarmonicRatio: number
  /** Whether the harmonic pattern suggests feedback (clean, evenly-spaced) */
  isFeedbackLike: boolean
  /** Whether the harmonic pattern suggests music (rich, decaying harmonics) */
  isMusicLike: boolean
  /** Number of harmonics detected */
  harmonicsFound: number
  /** Feedback score contribution (0-1) */
  feedbackScore: number
}

export interface PTMRResult {
  /** Peak-to-median ratio in dB */
  ptmrDb: number
  /** Whether PTMR exceeds the feedback threshold */
  isFeedbackLike: boolean
  /** Feedback score contribution (0-1) */
  feedbackScore: number
}

/**
 * Temporal envelope metrics for speech/music discrimination.
 * Computed from a ring buffer of per-frame energy values in FeedbackDetector.
 */
export interface TemporalMetrics {
  /** Variance of energy (dB²). Speech: >12 (silence gaps). Music: <10 (continuous). */
  energyVariance: number
  /** Fraction of frames below silence threshold. Speech: >0.10. Music: <0.08. */
  silenceGapRatio: number
}

// ── Inter-Harmonic Ratio (IHR) ──────────────────────────────────────────────

/**
 * Analyze inter-harmonic energy distribution to distinguish feedback from music.
 * Low IHR = feedback (clean tone), high IHR = music (rich harmonics).
 */
export function analyzeInterHarmonicRatio(
  spectrum: Float32Array,
  fundamentalBin: number,
  _sampleRate: number,
  _fftSize: number
): InterHarmonicResult {
  void _sampleRate
  void _fftSize
  const maxBin = spectrum.length - 1
  const nyquistBin = Math.floor(maxBin * 0.95)

  if (fundamentalBin <= 0 || fundamentalBin >= nyquistBin) {
    return { interHarmonicRatio: 0.5, isFeedbackLike: false, isMusicLike: false, harmonicsFound: 0, feedbackScore: 0 }
  }

  const maxHarmonic = 8
  let harmonicEnergy = 0
  let interHarmonicEnergy = 0
  let harmonicsFound = 0
  /** Maximum relative deviation for a peak to count as a validated harmonic.
   *  Matches the search window tolerance (2% of expected bin position). */
  const HARMONIC_VALIDATION_TOLERANCE = 0.02
  const halfBinWidth = Math.max(1, Math.round(fundamentalBin * HARMONIC_VALIDATION_TOLERANCE))

  for (let k = 1; k <= maxHarmonic; k++) {
    const expectedBin = Math.round(fundamentalBin * k)
    if (expectedBin >= nyquistBin) break

    let hPeak = -Infinity
    let hPeakBin = expectedBin
    for (let b = Math.max(0, expectedBin - halfBinWidth); b <= Math.min(maxBin, expectedBin + halfBinWidth); b++) {
      if (spectrum[b] > hPeak) {
        hPeak = spectrum[b]
        hPeakBin = b
      }
    }
    const hPower = dbToLinearLut(hPeak)
    harmonicEnergy += hPower

    // Validate: peak must be within tolerance of exact integer multiple of f0
    // to count toward the harmonic series. Coincidental near-harmonic peaks
    // that happen to fall in the search window but deviate from k*f0 are excluded.
    if (hPeak > -80) {
      const relDev = Math.abs(hPeakBin - fundamentalBin * k) / (fundamentalBin * k)
      if (relDev <= HARMONIC_VALIDATION_TOLERANCE) {
        harmonicsFound++
      }
    }

    if (k < maxHarmonic) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < nyquistBin) {
        let ihPeak = -Infinity
        for (let b = Math.max(0, midBin - halfBinWidth); b <= Math.min(maxBin, midBin + halfBinWidth); b++) {
          if (spectrum[b] > ihPeak) ihPeak = spectrum[b]
        }
        interHarmonicEnergy += dbToLinearLut(ihPeak)
      }
    }
  }

  const ihr = harmonicEnergy > 0 ? interHarmonicEnergy / harmonicEnergy : 0.5
  const hasRichValidatedHarmonics = harmonicsFound >= 4
  const isFeedbackLike = ihr < 0.15 && harmonicsFound <= 2
  const isMusicLike = harmonicsFound >= 3 && (ihr > 0.35 || hasRichValidatedHarmonics)

  let feedbackScore = 0
  if (hasRichValidatedHarmonics) {
    feedbackScore = 0
  } else if (harmonicsFound <= 1) {
    feedbackScore = Math.max(0, 1 - ihr * 5)
  } else if (harmonicsFound <= 2) {
    feedbackScore = Math.max(0, 0.7 - ihr * 3)
  } else {
    feedbackScore = Math.max(0, 0.3 - ihr)
  }

  return {
    interHarmonicRatio: ihr,
    isFeedbackLike,
    isMusicLike,
    harmonicsFound,
    feedbackScore: Math.min(feedbackScore, 1),
  }
}

// ── Peak-to-Median Ratio (PTMR) ────────────────────────────────────────────

/**
 * Calculate peak-to-median ratio for a spectral peak.
 * Feedback peaks have PTMR > 15 dB; music < 10 dB.
 */
export function calculatePTMR(
  spectrum: Float32Array,
  peakBin: number,
  halfWidth: number = 20
): PTMRResult {
  const n = spectrum.length
  const start = Math.max(0, peakBin - halfWidth)
  const end = Math.min(n - 1, peakBin + halfWidth)

  // Zero-allocation: copy into pre-allocated scratch buffer, use quickselect median
  let count = 0
  for (let i = start; i <= end; i++) {
    if (Math.abs(i - peakBin) > 2) {
      _ptmrScratch[count++] = spectrum[i]
    }
  }

  if (count < 4) {
    return { ptmrDb: 0, isFeedbackLike: false, feedbackScore: 0 }
  }

  const median = medianInPlace(_ptmrScratch.subarray(0, count))

  const ptmrDb = spectrum[peakBin] - median
  const isFeedbackLike = ptmrDb > 15
  const feedbackScore = Math.min(Math.max((ptmrDb - 8) / 15, 0), 1)

  return { ptmrDb, isFeedbackLike, feedbackScore }
}

// ── Content Type Detection ──────────────────────────────────────────────────

/**
 * Classify audio content as speech, music, or compressed using 4 global
 * spectral features: centroid, rolloff, crest factor, and spectral flatness.
 *
 * Previous versions used aggressive single-feature early gates (crestFactor > 8
 * → speech, flatness > 0.2 → music) that failed in practice because:
 * - Music with a loud fundamental easily has crest factor > 8 dB
 * - Speech in rooms with ambient noise often has flatness > 0.2
 * - The `spectralFlatness` parameter was peak-local (±5 bins), not global
 *
 * Now uses multi-feature scoring + temporal envelope analysis. Global flatness
 * is computed internally from the full spectrum (geometric/arithmetic mean ratio).
 * When temporal metrics are provided, they receive 40% weight — temporal envelope
 * (silence gaps, energy variance) is the most reliable speech/music discriminator.
 *
 * @param spectrum - Full-resolution spectrum in dBFS
 * @param crestFactor - specMax − rmsDb in dB (global)
 * @param temporalMetrics - Optional energy variance + silence gap ratio from FeedbackDetector
 */
export function detectContentType(
  spectrum: Float32Array,
  crestFactor: number,
  temporalMetrics?: TemporalMetrics,
): ContentType {
  // Only reliable early gate: low crest factor = heavily compressed
  if (crestFactor < COMPRESSION_CONSTANTS.COMPRESSED_CREST_FACTOR) {
    return 'compressed'
  }

  // ── Compute global spectral features from full spectrum ─────────────
  // Single pass: cache power values via LUT, compute centroid + flatness + rolloff together.
  // Eliminates redundant Math.pow(10, db/10) second pass and uses dbToLinearLut (~3× faster).
  let totalPower = 0
  let weightedSum = 0
  let logSum = 0  // for geometric mean (global flatness)
  let validBins = 0
  const len = spectrum.length
  for (let i = 0; i < len; i++) {
    // Guard: LUT clamps -Infinity to EXP_LUT[0] (~1e-10). Treat sub-range dB as zero power.
    const db = spectrum[i]
    const power = db <= -100 ? 0 : dbToLinearLut(db)
    _powerCache[i] = power
    if (power > 0) {
      totalPower += power
      weightedSum += i * power
      logSum += Math.log(power)
      validBins++
    }
  }
  if (totalPower <= 0 || validBins === 0) return 'unknown'

  const centroidNormalized = weightedSum / totalPower / len

  // Global spectral flatness: geometric mean / arithmetic mean
  const arithmeticMean = totalPower / validBins
  const geometricMean = Math.exp(logSum / validBins)
  const globalFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0

  // Spectral rolloff: bin where 85% of energy is reached — read from cached power values
  const rolloffThreshold = totalPower * 0.85
  let cumulative = 0
  let rolloffBin = len - 1
  for (let i = 0; i < len; i++) {
    cumulative += _powerCache[i]
    if (cumulative >= rolloffThreshold) {
      rolloffBin = i
      break
    }
  }
  const rolloffNormalized = rolloffBin / len

  // ── Multi-feature scoring ──────────────────────────────────────────
  const hasTemporal = temporalMetrics !== undefined
  const spectralScale = hasTemporal ? 0.60 : 1.0

  let speechScore = 0
  let musicScore = 0

  // Spectral centroid: speech concentrates in 100–4kHz, music spreads wider
  if (centroidNormalized < 0.10) speechScore += 0.35 * spectralScale
  else if (centroidNormalized < 0.15) speechScore += 0.20 * spectralScale
  else if (centroidNormalized < 0.20) speechScore += 0.05 * spectralScale
  if (centroidNormalized > 0.20) musicScore += 0.30 * spectralScale
  else if (centroidNormalized > 0.15) musicScore += 0.15 * spectralScale

  // Spectral rolloff: speech energy dies above ~4kHz
  if (rolloffNormalized < 0.15) speechScore += 0.30 * spectralScale
  else if (rolloffNormalized < 0.22) speechScore += 0.15 * spectralScale
  if (rolloffNormalized > 0.25) musicScore += 0.30 * spectralScale
  else if (rolloffNormalized > 0.18) musicScore += 0.10 * spectralScale

  // Global spectral flatness
  if (globalFlatness < 0.03) speechScore += 0.25 * spectralScale
  else if (globalFlatness < 0.06) speechScore += 0.15 * spectralScale
  else if (globalFlatness < 0.10) speechScore += 0.05 * spectralScale
  if (globalFlatness > 0.15) musicScore += 0.25 * spectralScale
  else if (globalFlatness > 0.08) musicScore += 0.10 * spectralScale

  // Crest factor: weak signal, small contribution
  if (crestFactor > 14) speechScore += 0.10 * spectralScale
  else if (crestFactor > 12) speechScore += 0.05 * spectralScale
  if (crestFactor < 7) musicScore += 0.10 * spectralScale

  // ── Temporal envelope scoring (40% weight when available) ──────────
  if (hasTemporal) {
    const { energyVariance, silenceGapRatio } = temporalMetrics

    // Silence gap ratio — strongest temporal discriminator
    if (silenceGapRatio > TEMPORAL_ENVELOPE.SPEECH_GAP_HIGH) speechScore += 0.25
    else if (silenceGapRatio > TEMPORAL_ENVELOPE.SPEECH_GAP_MED) speechScore += 0.15
    if (silenceGapRatio < TEMPORAL_ENVELOPE.MUSIC_GAP_LOW) musicScore += 0.25
    else if (silenceGapRatio < TEMPORAL_ENVELOPE.MUSIC_GAP_MED) musicScore += 0.15

    // Energy variance
    if (energyVariance > TEMPORAL_ENVELOPE.SPEECH_VARIANCE_HIGH) speechScore += 0.15
    else if (energyVariance > TEMPORAL_ENVELOPE.SPEECH_VARIANCE_MED) speechScore += 0.08
    if (energyVariance < TEMPORAL_ENVELOPE.MUSIC_VARIANCE_LOW) musicScore += 0.15
    else if (energyVariance < TEMPORAL_ENVELOPE.MUSIC_VARIANCE_MED) musicScore += 0.08
  }

  if (speechScore > musicScore && speechScore > 0.3) return 'speech'
  if (musicScore > speechScore && musicScore > 0.3) return 'music'

  return 'unknown'
}
