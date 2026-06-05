/**
 * Mock Algorithm Score Builders
 *
 * Builder functions that construct full AlgorithmScores objects from simplified
 * feedbackScore values (0-1). Each builder reverse-engineers realistic internal
 * values so the object would produce the requested feedbackScore if run through
 * the real scoring formula.
 *
 * Usage:
 *   const scores = buildScores({ msd: 0.8, phase: 0.9, spectral: 0.4 })
 *   const result = fuseAlgorithmResults(scores, 'speech')
 */

import type { MSDResult } from '@/types/advisory'
import type { PhaseCoherenceResult } from '@/lib/dsp/phaseCoherence'
import type {
  SpectralFlatnessResult,
  CompressionResult,
} from '@/lib/dsp/compressionDetection'
import type { AlgorithmScores } from '@/lib/dsp/fusionEngine'
import type { CombPatternResult } from '@/lib/dsp/combPattern'
import type { InterHarmonicResult, PTMRResult } from '@/lib/dsp/spectralAlgorithms'

// ── ScoreInput ──────────────────────────────────────────────────────────────

export interface ScoreInput {
  /** MSD feedbackScore (0-1). null/undefined → omit from AlgorithmScores. */
  msd?: number | null
  /** Phase coherence (0-1). null/undefined → omit. */
  phase?: number | null
  /** Spectral flatness feedbackScore (0-1). null/undefined → omit. */
  spectral?: number | null
  /** Comb pattern confidence (0-1). null/undefined → omit. */
  comb?: number | null
  /** IHR feedbackScore (0-1). null/undefined → omit. */
  ihr?: number | null
  /** PTMR feedbackScore (0-1). null/undefined → omit. */
  ptmr?: number | null
  /** Compression state. null/undefined → omit. */
  compressed?: boolean | null
  /** Number of MSD frames analyzed (default: 10). */
  msdFrames?: number
}

// ── Constants (mirrored from DSP modules to invert formulas) ────────────────

/** MSD_SETTINGS.THRESHOLD from constants.ts — used in exp(-msd/threshold) */
const MSD_THRESHOLD = 0.1
/** SPECTRAL_FLATNESS_SETTINGS.MUSIC from constants.ts */
const MUSIC_FLATNESS = 0.3
/** SPECTRAL_FLATNESS_SETTINGS.HIGH_KURTOSIS from constants.ts */
const HIGH_KURTOSIS = 10
/** PHASE_SETTINGS.HIGH_COHERENCE from constants.ts */
const PHASE_HIGH_COHERENCE = 0.85

// ── Individual Builders ─────────────────────────────────────────────────────

/**
 * Build an MSDResult from a target feedbackScore.
 *
 * Real formula (msdAnalysis.ts:145): feedbackScore = exp(-msd / MSD_THRESHOLD)
 * Inverse: msd = -MSD_THRESHOLD * ln(feedbackScore)
 */
export function buildMSDResult(
  feedbackScore: number,
  frames: number = 10
): MSDResult {
  // Edge case: ln(0) = -Infinity, so clamp to a tiny positive value
  const clampedScore = Math.max(feedbackScore, 1e-10)
  const msd = -MSD_THRESHOLD * Math.log(clampedScore)

  return {
    msd,
    feedbackScore,
    secondDerivative: 0,
    isFeedbackLikely: msd < MSD_THRESHOLD,
    framesAnalyzed: frames,
    meanMagnitudeDb: -30,
  }
}

/**
 * Build a PhaseCoherenceResult from a target coherence value.
 *
 * Real formula (phaseCoherence.ts:111): feedbackScore = coherence
 */
export function buildPhaseResult(coherence: number): PhaseCoherenceResult {
  return {
    coherence,
    feedbackScore: coherence,
    meanPhaseDelta: 0.1,
    phaseDeltaStd: coherence > 0.8 ? 0.05 : 0.8,
    isFeedbackLikely: coherence >= PHASE_HIGH_COHERENCE,
  }
}

/**
 * Build a SpectralFlatnessResult from a target feedbackScore.
 *
 * Real formula (compressionDetection.ts:49-85):
 *   flatnessScore = 1 - min(flatness / MUSIC_FLATNESS, 1)
 *   kurtosisScore = min(max(kurtosis, 0) / HIGH_KURTOSIS, 1)
 *   feedbackScore = flatnessScore * 0.6 + kurtosisScore * 0.4
 *
 * Inverse: set both sub-scores equal to feedbackScore →
 *   flatness  = (1 - feedbackScore) * MUSIC_FLATNESS
 *   kurtosis  = feedbackScore * HIGH_KURTOSIS
 */
export function buildSpectralResult(
  feedbackScore: number
): SpectralFlatnessResult {
  const flatness = (1 - feedbackScore) * MUSIC_FLATNESS
  const kurtosis = feedbackScore * HIGH_KURTOSIS

  return {
    flatness,
    kurtosis,
    feedbackScore,
    isFeedbackLikely: feedbackScore > 0.5,
  }
}

/**
 * Build a CombPatternResult from a target confidence.
 *
 * confidence is stored directly. hasPattern = confidence > 0.
 * Provides plausible fixed values for the acoustic path estimation fields.
 */
export function buildCombResult(confidence: number): CombPatternResult {
  if (confidence <= 0) {
    return {
      hasPattern: false,
      fundamentalSpacing: null,
      estimatedPathLength: null,
      matchingPeaks: 0,
      predictedFrequencies: [],
      confidence: 0,
    }
  }
  return {
    hasPattern: true,
    fundamentalSpacing: 100,
    estimatedPathLength: 3.43,
    matchingPeaks: 4,
    predictedFrequencies: [100, 200, 300, 400],
    confidence,
  }
}

/**
 * Build an InterHarmonicResult from a target feedbackScore.
 *
 * Real formula (algorithmFusion.ts:319-326, harmonicsFound ≤ 1 branch):
 *   feedbackScore = max(0, 1 - ihr * 5)
 * Inverse: ihr = (1 - feedbackScore) / 5
 */
export function buildIHRResult(feedbackScore: number): InterHarmonicResult {
  const ihr = (1 - feedbackScore) / 5

  return {
    interHarmonicRatio: ihr,
    isFeedbackLike: feedbackScore > 0.5,
    isMusicLike: feedbackScore < 0.2,
    harmonicsFound: 1,
    feedbackScore,
  }
}

/**
 * Build a PTMRResult from a target feedbackScore.
 *
 * Real formula (algorithmFusion.ts:343-374):
 *   feedbackScore = min(max((ptmrDb - 8) / 15, 0), 1)
 * Inverse: ptmrDb = feedbackScore * 15 + 8
 */
export function buildPTMRResult(feedbackScore: number): PTMRResult {
  const ptmrDb = feedbackScore * 15 + 8

  return {
    ptmrDb,
    isFeedbackLike: ptmrDb > 15,
    feedbackScore,
  }
}

/**
 * Build a CompressionResult from a boolean compressed state.
 *
 * CompressionResult has no feedbackScore — it modifies fusion thresholds
 * via thresholdMultiplier. Produces realistic crest factor and dynamic range
 * values that satisfy the compression detection logic.
 */
export function buildCompressionResult(
  isCompressed: boolean
): CompressionResult {
  if (isCompressed) {
    return {
      isCompressed: true,
      estimatedRatio: 3,
      crestFactor: 4,
      dynamicRange: 6,
      thresholdMultiplier: 1.5,
    }
  }
  return {
    isCompressed: false,
    estimatedRatio: 1,
    crestFactor: 14,
    dynamicRange: 25,
    thresholdMultiplier: 1,
  }
}

// ── Master Builder ──────────────────────────────────────────────────────────

/**
 * Build a complete AlgorithmScores object from simplified score inputs.
 *
 * Any field omitted (undefined) or set to null produces null in the output,
 * matching how the fusion engine handles missing algorithm data.
 */
export function buildScores(input: ScoreInput = {}): AlgorithmScores {
  return {
    msd:
      input.msd != null
        ? buildMSDResult(input.msd, input.msdFrames ?? 10)
        : null,
    phase: input.phase != null ? buildPhaseResult(input.phase) : null,
    spectral:
      input.spectral != null ? buildSpectralResult(input.spectral) : null,
    comb: input.comb != null ? buildCombResult(input.comb) : null,
    compression:
      input.compressed != null
        ? buildCompressionResult(input.compressed)
        : null,
    ihr: input.ihr != null ? buildIHRResult(input.ihr) : null,
    ptmr: input.ptmr != null ? buildPTMRResult(input.ptmr) : null,
  }
}
