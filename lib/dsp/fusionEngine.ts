/**
 * Fusion Engine — Core Algorithm Fusion + MINDS + Calibration
 *
 * Combines scores from all detection algorithms into a unified feedback
 * probability with confidence and verdict. Also contains MINDS (adaptive
 * notch depth) and post-gate probability calibration.
 *
 * Extracted from algorithmFusion.ts for maintainability.
 */

import type { Algorithm, AlgorithmMode, ContentType, DetectorSettings, MSDResult } from '@/types/advisory'
import { MSD_CONSTANTS } from './constants'
import type { PhaseCoherenceResult } from './phaseCoherence'
import { PHASE_CONSTANTS } from './phaseCoherence'
import type { SpectralFlatnessResult, CompressionResult } from './compressionDetection'
import type { CombPatternResult } from './combPattern'
import { CombStabilityTracker, COMB_SWEEP_PENALTY } from './combPattern'
import type { InterHarmonicResult, PTMRResult } from './spectralAlgorithms'
import { getMsdMinFramesForMode } from './detectorUtils'

// Re-export from canonical source so existing imports from advancedDetection still work
export type { AlgorithmMode } from '@/types/advisory'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AlgorithmScores {
  msd: MSDResult | null
  phase: PhaseCoherenceResult | null
  spectral: SpectralFlatnessResult | null
  comb: CombPatternResult | null
  compression: CompressionResult | null
  /** Inter-harmonic ratio analysis — low IHR = feedback, high IHR = music */
  ihr: InterHarmonicResult | null
  /** Peak-to-median ratio — high PTMR = narrow spectral peak (feedback) */
  ptmr: PTMRResult | null
}

export interface FusedDetectionResult {
  feedbackProbability: number
  confidence: number
  contributingAlgorithms: string[]
  algorithmScores: AlgorithmScores
  verdict: 'FEEDBACK' | 'POSSIBLE_FEEDBACK' | 'NOT_FEEDBACK' | 'UNCERTAIN'
  reasons: string[]
}

export interface FusionConfig {
  mode: AlgorithmMode
  enabledAlgorithms?: Algorithm[]
  customWeights?: Partial<typeof FUSION_WEIGHTS.DEFAULT>
  msdMinFrames: number
  phaseThreshold: number
  enableCompressionDetection: boolean
  feedbackThreshold: number
}

export interface MINDSResult {
  suggestedDepthDb: number
  isGrowing: boolean
  recentGradient: number
  confidence: number
  recommendation: string
}

export type FusionRuntimeSettings = Pick<
  DetectorSettings,
  'mode' | 'algorithmMode' | 'enabledAlgorithms'
>

// ── Calibration ─────────────────────────────────────────────────────────────

// 14.3: Post-gate probability calibration types and function
export interface CalibrationBreakpoint { raw: number; calibrated: number }
export interface CalibrationTable { breakpoints: CalibrationBreakpoint[] }
export const IDENTITY_CALIBRATION: CalibrationTable = { breakpoints: [] }

export function calibrateProbability(raw: number, table?: CalibrationTable): number {
  if (!table || table.breakpoints.length === 0) return raw
  const bp = table.breakpoints
  if (raw <= bp[0].raw) return bp[0].calibrated
  if (raw >= bp[bp.length - 1].raw) return bp[bp.length - 1].calibrated
  for (let i = 0; i < bp.length - 1; i++) {
    if (raw >= bp[i].raw && raw <= bp[i + 1].raw) {
      const span = bp[i + 1].raw - bp[i].raw
      if (span === 0) return bp[i].calibrated
      const t = (raw - bp[i].raw) / span
      return bp[i].calibrated + t * (bp[i + 1].calibrated - bp[i].calibrated)
    }
  }
  return raw
}

// ── Agreement Persistence ───────────────────────────────────────────────────

// 14.8: Agreement persistence tracker (EWMA of single-frame agreement)
export class AgreementPersistenceTracker {
  private _ewma = 0
  private _alpha: number
  private _frames = 0
  constructor(alpha = 0.15) { this._alpha = alpha }
  update(agreement: number): void {
    this._frames++
    this._ewma = this._frames === 1 ? agreement : this._alpha * agreement + (1 - this._alpha) * this._ewma
  }
  get persistenceBonus(): number {
    return this._frames >= 4 && this._ewma > 0.6 ? Math.min((this._ewma - 0.6) * 0.15, 0.05) : 0
  }
  get ewma(): number { return this._ewma }
  get frames(): number { return this._frames }
  reset(): void { this._ewma = 0; this._frames = 0 }
}

// ── Module-Level State ──────────────────────────────────────────────────────

/** Module-level fallback — only used when no per-track tracker is provided. */
const combStabilityTracker = new CombStabilityTracker()

/** Pre-allocated buffer for effective scores in fuseAlgorithmResults().
 *  Avoids per-call heap allocation (~500 calls/sec). Max 6 deterministic algorithms. */
const _effScores = new Float64Array(7)

/** Pre-allocated mutable weights object — avoids object spread per fusion call (~500/sec).
 *  Only read within the synchronous fuseAlgorithmResults(); no concurrent access in Worker. */
const _weights = { msd: 0, phase: 0, spectral: 0, comb: 0, ihr: 0, ptmr: 0 }
// Pre-allocated Set + algorithm list — reused per call to avoid GC pressure (~500 calls/sec)
const _ALL_ALGORITHMS = ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr'] as const
const _active = new Set<string>()
const MAX_EFFECTIVE_SCORE_STDDEV = 0.5
const STRONG_SIGNAL_THRESHOLD = 0.7
const CORE_CONSENSUS_MSD_THRESHOLD = 0.85
const CORE_CONSENSUS_PHASE_THRESHOLD = 0.85
const CORE_CONSENSUS_SPECTRAL_THRESHOLD = 0.75
const BASE_FEEDBACK_CONFIDENCE_THRESHOLD = 0.66
const STRONG_CORROBORATION_CONFIDENCE_THRESHOLD = 0.4
const STRONG_IHR_CORROBORATION_THRESHOLD = 0.75
const STRONG_SHAPE_OR_STABILITY_THRESHOLD = 0.7
const STRONG_CORROBORATION_PROBABILITY_MARGIN = 0.03
const STRONG_CORROBORATION_POSSIBLE_THRESHOLD = 0.3
const STRONG_CORROBORATION_POSSIBLE_CONFIDENCE_THRESHOLD = 0.18
const PHASE_DOMINANT_MUSIC_MSD_MAX = 0.15
const PHASE_DOMINANT_MUSIC_PHASE_MIN = 0.95
const PHASE_DOMINANT_MUSIC_GATE_PENALTY = 0.60
const RICH_HARMONIC_MUSIC_HARMONICS_MIN = 3
const RICH_HARMONIC_MUSIC_IHR_SCORE_MAX = 0.35
const RICH_HARMONIC_MUSIC_GATE_PENALTY = 0.45
const RICH_HARMONIC_MUSIC_PROBABILITY_CAP = 0.34
const MUSIC_COMB_EFFECT_PHASE_MIN = 0.75
const MUSIC_COMB_EFFECT_SPECTRAL_MIN = 0.65
const MUSIC_COMB_EFFECT_IHR_MAX = 0.55
const MUSIC_COMB_EFFECT_PTMR_MAX = 0.65
const MUSIC_COMB_EFFECT_GATE_PENALTY = 0.48
const MUSIC_TONAL_SOURCE_PHASE_MIN = 0.75
const MUSIC_TONAL_SOURCE_SPECTRAL_MIN = 0.65
const MUSIC_TONAL_SOURCE_IHR_MAX = 0.60
const MUSIC_TONAL_SOURCE_PTMR_MAX = 0.75
const MUSIC_TONAL_SOURCE_GATE_PENALTY = 0.50
const MUSIC_TONAL_SOURCE_PROBABILITY_CAP = 0.34
const UNKNOWN_TONAL_SOURCE_MSD_MIN = 0.45
const UNKNOWN_TONAL_SOURCE_PHASE_MIN = 0.75
const UNKNOWN_TONAL_SOURCE_SPECTRAL_MIN = 0.65
const UNKNOWN_TONAL_SOURCE_IHR_MAX = 0.60
const UNKNOWN_TONAL_SOURCE_PTMR_MAX = 0.75
const UNKNOWN_TONAL_SOURCE_GATE_PENALTY = 0.50
const UNKNOWN_TONAL_SOURCE_PROBABILITY_CAP = 0.34
const TONAL_SOURCE_MSD_MIN = 0.80
const TONAL_SOURCE_PHASE_MIN = 0.40
const TONAL_SOURCE_SPECTRAL_MIN = 0.40
const TONAL_SOURCE_IHR_MAX = 0.25
const TONAL_SOURCE_PTMR_MAX = 0.80
const TONAL_SOURCE_GATE_PENALTY = 0.55
const COMPRESSED_PHASE_TONE_PHASE_MIN = 0.90
const COMPRESSED_PHASE_TONE_MSD_MIN = 0.50
const COMPRESSED_PHASE_TONE_SPECTRAL_MIN = 0.60
const COMPRESSED_PHASE_TONE_IHR_MAX = 0.55
const COMPRESSED_PHASE_TONE_PTMR_MAX = 0.70
const COMPRESSED_PHASE_TONE_GATE_PENALTY = 0.50
const COMPRESSED_PHASE_DEGRADED_PHASE_MAX = 0.35
const COMPRESSED_PHASE_DEGRADED_MSD_MIN = 0.75
const COMPRESSED_PHASE_DEGRADED_SPECTRAL_MIN = 0.75
const COMPRESSED_PHASE_DEGRADED_IHR_MIN = 0.85
const COMPRESSED_PHASE_DEGRADED_PTMR_MIN = 0.75
const COMPRESSED_VOICED_SOURCE_PHASE_MIN = 0.90
const COMPRESSED_VOICED_SOURCE_MSD_MIN = 0.65
const COMPRESSED_VOICED_SOURCE_SPECTRAL_MIN = 0.80
const COMPRESSED_VOICED_SOURCE_IHR_MAX = 0.50
const COMPRESSED_VOICED_SOURCE_PTMR_MAX = 0.70
const COMPRESSED_VOICED_SOURCE_GATE_PENALTY = 0.75
const HARMONIC_SERIES_COMB_SPACING_TOLERANCE = 0.04

// ── Fusion Weights ──────────────────────────────────────────────────────────

// Three-model consensus (Claude+Gemini+ChatGPT): 'existing' was a legacy
// prominence metric that overlapped with spectral/MSD (double-counting).
// Removed entirely and redistributed to IHR (harmonic discrimination) and
// PTMR (peak shape) — the two novel algorithms measuring unique properties.
export const FUSION_WEIGHTS = {
  DEFAULT: {
    msd: 0.30,
    phase: 0.26,
    spectral: 0.12,
    comb: 0.08,
    ihr: 0.13,
    ptmr: 0.11,
  },
  // SPEECH MSD reduced from 0.40 to 0.33 (effective 42.1% → ~34.7%)
  // Three-model consensus: 0.40 caused false positives on sustained vowels.
  // Gemini: 'Ummmm' scored 0.710. ChatGPT: 'Wooooo!' scored 0.720.
  // Redistributed to phase (+0.04) and ptmr (+0.03) for better discrimination.
  SPEECH: {
    msd: 0.33,
    phase: 0.24,
    spectral: 0.10,
    comb: 0.05,
    ihr: 0.10,
    ptmr: 0.18,
  },
  // MUSIC MSD reduced from 0.15 to 0.08. DAFx-16 paper reports 22% accuracy
  // on rock music. Giving MSD 15% of the vote means it's wrong 78% of the
  // time but still influencing 15% of the decision. At 0.08, it's a weak
  // corroborator, not a lead vote.
  MUSIC: {
    msd: 0.08,
    phase: 0.36,
    spectral: 0.10,
    comb: 0.08,
    ihr: 0.24,
    ptmr: 0.14,
  },
  // COMPRESSED phase reduced from 0.38 to 0.30 (effective 41.3% → ~33%)
  // Three-model consensus: single-feature conviction risk. Phase at 41.3%
  // effective could convict on Auto-Tuned vocals (ChatGPT) and
  // pitch-corrected worship content (Gemini).
  // Redistributed to spectral/ihr/ptmr for broader corroboration.
  COMPRESSED: {
    msd: 0.12,
    phase: 0.30,
    spectral: 0.18,
    comb: 0.08,
    ihr: 0.18,
    ptmr: 0.14,
  },
} as const

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  mode: 'auto',
  msdMinFrames: MSD_CONSTANTS.MIN_FRAMES_SPEECH,
  phaseThreshold: PHASE_CONSTANTS.HIGH_COHERENCE,
  enableCompressionDetection: true,
  feedbackThreshold: 0.60,
}

/**
 * Build the runtime fusion config from detector settings.
 * Keep offline replay and tests aligned with the worker's production path.
 */
export function buildFusionConfig(
  settings?: Partial<FusionRuntimeSettings>,
): FusionConfig {
  return {
    ...DEFAULT_FUSION_CONFIG,
    mode: settings?.algorithmMode ?? 'auto',
    enabledAlgorithms: settings?.enabledAlgorithms,
    msdMinFrames: settings?.mode
      ? getMsdMinFramesForMode(settings.mode)
      : DEFAULT_FUSION_CONFIG.msdMinFrames,
  }
}

// ── Algorithm Fusion ────────────────────────────────────────────────────────

/**
 * Fuse multiple algorithm results into a unified detection score.
 *
 * FLAW 6 FIX: When comb pattern detected, doubles both numerator AND
 * denominator weight so feedbackProbability stays in [0, 1].
 */
export function fuseAlgorithmResults(
  scores: AlgorithmScores,
  contentType: ContentType = 'unknown',
  config: FusionConfig = DEFAULT_FUSION_CONFIG,
  /** Peak frequency in Hz. When provided, enables frequency-aware scoring. */
  peakFrequencyHz?: number,
  /** Per-track comb stability tracker. Falls back to module-level singleton if not provided. */
  trackCombTracker?: CombStabilityTracker,
  /** Per-track agreement persistence tracker for confidence bonus. */
  agreementTracker?: AgreementPersistenceTracker,
  /** Optional calibration table for post-gate probability mapping. Default is identity. */
  calibrationTable?: CalibrationTable,
  /** Optional gate overrides from DiagnosticsProfile (expert-only). */
  gateOverrides?: { combSweepOverride?: number; ihrGateOverride?: number; ptmrGateOverride?: number },
): FusedDetectionResult {
  const reasons: string[] = []
  const contributingAlgorithms: string[] = []
  const richHarmonicMusicLike =
    scores.ihr?.isMusicLike === true &&
    (scores.ihr?.harmonicsFound ?? 0) >= RICH_HARMONIC_MUSIC_HARMONICS_MIN
  const harmonicSeriesCombPattern =
    richHarmonicMusicLike &&
    scores.comb?.hasPattern === true &&
    typeof peakFrequencyHz === 'number' &&
    Number.isFinite(peakFrequencyHz) &&
    peakFrequencyHz > 0 &&
    typeof scores.comb.fundamentalSpacing === 'number' &&
    Number.isFinite(scores.comb.fundamentalSpacing) &&
    Math.abs(scores.comb.fundamentalSpacing - peakFrequencyHz) / peakFrequencyHz <=
      HARMONIC_SERIES_COMB_SPACING_TOLERANCE

  // Zero-allocation: copy preset fields into module-level _weights object
  // instead of object spread (~500 calls/sec). Synchronous — no concurrent access risk.
  const preset = scores.compression?.isCompressed
    ? (reasons.push(`Compression detected (ratio ~${scores.compression.estimatedRatio.toFixed(1)}:1)`), FUSION_WEIGHTS.COMPRESSED)
    : contentType === 'speech' ? FUSION_WEIGHTS.SPEECH
    : contentType === 'music' ? FUSION_WEIGHTS.MUSIC
    : FUSION_WEIGHTS.DEFAULT
  _weights.msd = preset.msd
  _weights.phase = preset.phase
  _weights.spectral = preset.spectral
  _weights.comb = preset.comb
  _weights.ihr = preset.ihr
  _weights.ptmr = preset.ptmr

  if (config.customWeights) {
    const cw = config.customWeights
    if (cw.msd !== undefined) _weights.msd = cw.msd
    if (cw.phase !== undefined) _weights.phase = cw.phase
    if (cw.spectral !== undefined) _weights.spectral = cw.spectral
    if (cw.comb !== undefined) _weights.comb = cw.comb
    if (cw.ihr !== undefined) _weights.ihr = cw.ihr
    if (cw.ptmr !== undefined) _weights.ptmr = cw.ptmr
  }

  const weights = _weights

  // Perf: reuse module-level Set — avoids new Set() + new string[] per call (~500/sec).
  // Safe because fuseAlgorithmResults runs synchronously in a single worker thread.
  _active.clear()
  switch (config.mode) {
    case 'auto':
      if (scores.msd && scores.msd.framesAnalyzed >= config.msdMinFrames) {
        _active.add('msd')
      }
      _active.add('phase').add('spectral').add('comb').add('ihr').add('ptmr')
      break
    case 'custom':
      for (const a of (config.enabledAlgorithms ?? _ALL_ALGORITHMS)) _active.add(a)
      break
  }
  const active = _active

  let weightedSum  = 0
  let totalWeight  = 0
  // F2 fix: collect effective (transformed) scores for agreement/confidence
  // Pre-allocated typed array avoids per-call heap allocation + GC pressure (~500 calls/sec)
  let effCount = 0

  if (active.has('msd') && scores.msd) {
    weightedSum += scores.msd.feedbackScore * weights.msd
    totalWeight += weights.msd
    _effScores[effCount++] = scores.msd.feedbackScore
    contributingAlgorithms.push('MSD')
    if (scores.msd.isFeedbackLikely) {
      reasons.push(`MSD indicates feedback (${scores.msd.msd.toFixed(3)} dB/frame\u00b2)`)
    }
  }

  if (active.has('phase') && scores.phase) {
    // Low-frequency phase suppression: below 200 Hz, FFT phase resolution
    // is too coarse for reliable coherence measurement (8 bins at 50 Hz).
    // Reduce phase influence by 50% to prevent phase noise from tanking
    // detection of low-frequency feedback. Source: Gemini deep-think.
    const phaseScore = (peakFrequencyHz !== undefined && peakFrequencyHz < 200)
      ? scores.phase.feedbackScore * 0.5
      : scores.phase.feedbackScore
    weightedSum += phaseScore * weights.phase
    totalWeight += weights.phase
    _effScores[effCount++] = phaseScore
    contributingAlgorithms.push('Phase')
    if (scores.phase.isFeedbackLikely) {
      reasons.push(`High phase coherence (${(scores.phase.coherence * 100).toFixed(0)}%)`)
    }
  }

  if (active.has('spectral') && scores.spectral) {
    weightedSum += scores.spectral.feedbackScore * weights.spectral
    totalWeight += weights.spectral
    _effScores[effCount++] = scores.spectral.feedbackScore
    contributingAlgorithms.push('Spectral')
    if (scores.spectral.isFeedbackLikely) {
      reasons.push(`Pure tone detected (flatness ${scores.spectral.flatness.toFixed(3)})`)
    }
  }

  // Comb doubling: when acoustic comb pattern detected, comb weight doubles
  // in the numerator only (e.g., 0.08 → 0.16 contribution to weightedSum).
  // Only the base weight is added to totalWeight so other algorithms are NOT
  // diluted. This gives comb a bonus boost without penalizing MSD/phase/etc.
  const cst = trackCombTracker ?? combStabilityTracker
  if (active.has('comb') && scores.comb && scores.comb.hasPattern && !harmonicSeriesCombPattern) {
    // Feed spacing into temporal tracker
    if (scores.comb.fundamentalSpacing != null) {
      cst.push(scores.comb.fundamentalSpacing)
    }

    // Apply sweep penalty: if spacing is drifting, this is likely an effect
    const sweeping = cst.isSweeping
    const combConfidence = sweeping
      ? scores.comb.confidence * (gateOverrides?.combSweepOverride ?? COMB_SWEEP_PENALTY)
      : scores.comb.confidence

    const combWeight = weights.comb * 2
    weightedSum += combConfidence * combWeight
    totalWeight += weights.comb
    _effScores[effCount++] = combConfidence
    contributingAlgorithms.push('Comb')

    const cvStr = cst.length >= 4
      ? `, CV=${cst.cv.toFixed(3)}`
      : ''
    const sweepStr = sweeping ? ' [SWEEPING — effect suppressed]' : ''
    reasons.push(
      `Comb pattern: ${scores.comb.matchingPeaks} peaks, ` +
      `${scores.comb.fundamentalSpacing?.toFixed(0)} Hz spacing` +
      (scores.comb.estimatedPathLength != null
        ? ` (path ~${scores.comb.estimatedPathLength.toFixed(1)} m)`
        : '') +
      cvStr + sweepStr
    )
  } else {
    // No comb pattern this frame — reset tracker to avoid stale history
    cst.reset()
    if (harmonicSeriesCombPattern) {
      reasons.push('Comb-like harmonic series ignored as musical overtones')
    }
  }

  if (active.has('ihr') && scores.ihr) {
    weightedSum += scores.ihr.feedbackScore * weights.ihr
    totalWeight += weights.ihr
    _effScores[effCount++] = scores.ihr.feedbackScore
    contributingAlgorithms.push('IHR')
    if (scores.ihr.isFeedbackLike) {
      reasons.push(`Clean tone (IHR ${scores.ihr.interHarmonicRatio.toFixed(2)}, ${scores.ihr.harmonicsFound} harmonics)`)
    } else if (scores.ihr.isMusicLike) {
      reasons.push(`Rich harmonics suggest music (IHR ${scores.ihr.interHarmonicRatio.toFixed(2)})`)
    }
  }

  if (active.has('ptmr') && scores.ptmr) {
    weightedSum += scores.ptmr.feedbackScore * weights.ptmr
    totalWeight += weights.ptmr
    _effScores[effCount++] = scores.ptmr.feedbackScore
    contributingAlgorithms.push('PTMR')
    if (scores.ptmr.isFeedbackLike) {
      reasons.push(`Sharp spectral peak (PTMR ${scores.ptmr.ptmrDb.toFixed(1)} dB)`)
    }
  }

  let feedbackProbability = totalWeight > 0
    ? Math.min(weightedSum / totalWeight, 1)
    : 0

  // IHR penalty gate: rich harmonic content (>= 3 harmonics) reduces probability
  // by 35%. This converts IHR from a weak linear contributor to a discriminative
  // veto. Musical instruments have rich harmonic series; feedback is a singular tone.
  if (richHarmonicMusicLike) {
    feedbackProbability *= (gateOverrides?.ihrGateOverride ?? 0.65)
  }

  // PTMR breadth gate: very broad spectral peak (PTMR < 0.2) is unlikely to be
  // feedback. Reduces probability by 20% to penalize wide-spectrum energy.
  if ((scores.ptmr?.feedbackScore ?? 1) < 0.2) {
    feedbackProbability *= (gateOverrides?.ptmrGateOverride ?? 0.80)
  }

  const noCombPattern = scores.comb?.hasPattern !== true || harmonicSeriesCombPattern
  const msdScore = scores.msd?.feedbackScore ?? 0
  const phaseScore = scores.phase?.feedbackScore ?? 0
  const spectralScore = scores.spectral?.feedbackScore ?? 0
  const ihrScore = scores.ihr?.feedbackScore ?? 1
  const ptmrScore = scores.ptmr?.feedbackScore ?? 1
  const coreConsensus =
    msdScore >= CORE_CONSENSUS_MSD_THRESHOLD &&
    phaseScore >= CORE_CONSENSUS_PHASE_THRESHOLD &&
    spectralScore >= CORE_CONSENSUS_SPECTRAL_THRESHOLD

  // Narrow phase-only music gate: a zero-MSD, high-phase tonal source is
  // often a stable musical pitch rather than acoustic feedback.
  if (
    noCombPattern &&
    contentType === 'music' &&
    msdScore <= PHASE_DOMINANT_MUSIC_MSD_MAX &&
    phaseScore >= PHASE_DOMINANT_MUSIC_PHASE_MIN
  ) {
    feedbackProbability *= PHASE_DOMINANT_MUSIC_GATE_PENALTY
    reasons.push('Phase-dominant music gate: missing MSD support')
  }

  if (
    noCombPattern &&
    richHarmonicMusicLike &&
    !coreConsensus &&
    ihrScore <= RICH_HARMONIC_MUSIC_IHR_SCORE_MAX
  ) {
    feedbackProbability = Math.min(
      feedbackProbability * RICH_HARMONIC_MUSIC_GATE_PENALTY,
      RICH_HARMONIC_MUSIC_PROBABILITY_CAP,
    )
    reasons.push('Rich harmonic music gate: harmonic series retained as music')
  }

  if (
    contentType === 'music' &&
    scores.comb?.hasPattern === true &&
    phaseScore >= MUSIC_COMB_EFFECT_PHASE_MIN &&
    spectralScore >= MUSIC_COMB_EFFECT_SPECTRAL_MIN &&
    ihrScore <= MUSIC_COMB_EFFECT_IHR_MAX &&
    ptmrScore <= MUSIC_COMB_EFFECT_PTMR_MAX
  ) {
    feedbackProbability *= MUSIC_COMB_EFFECT_GATE_PENALTY
    reasons.push('Music comb-effect gate: modulation pattern suspicion')
  }

  if (
    contentType === 'music' &&
    noCombPattern &&
    !coreConsensus &&
    phaseScore >= MUSIC_TONAL_SOURCE_PHASE_MIN &&
    spectralScore >= MUSIC_TONAL_SOURCE_SPECTRAL_MIN &&
    ihrScore <= MUSIC_TONAL_SOURCE_IHR_MAX &&
    ptmrScore <= MUSIC_TONAL_SOURCE_PTMR_MAX
  ) {
    feedbackProbability = Math.min(
      feedbackProbability * MUSIC_TONAL_SOURCE_GATE_PENALTY,
      MUSIC_TONAL_SOURCE_PROBABILITY_CAP,
    )
    reasons.push('Music tonal-source gate: harmonic/shape evidence not clean enough')
  }

  if (
    contentType === 'unknown' &&
    noCombPattern &&
    !coreConsensus &&
    msdScore >= UNKNOWN_TONAL_SOURCE_MSD_MIN &&
    phaseScore >= UNKNOWN_TONAL_SOURCE_PHASE_MIN &&
    spectralScore >= UNKNOWN_TONAL_SOURCE_SPECTRAL_MIN &&
    ihrScore <= UNKNOWN_TONAL_SOURCE_IHR_MAX &&
    ptmrScore <= UNKNOWN_TONAL_SOURCE_PTMR_MAX
  ) {
    feedbackProbability = Math.min(
      feedbackProbability * UNKNOWN_TONAL_SOURCE_GATE_PENALTY,
      UNKNOWN_TONAL_SOURCE_PROBABILITY_CAP,
    )
    reasons.push('Startup tonal-source gate: waiting for clean feedback shape')
  }

  // Sustained speech/synth sources can look extremely stable without being
  // feedback. Suppress only the narrow low-IHR / no-comb / moderate-PTMR case.
  if (
    noCombPattern &&
    contentType !== 'music' &&
    msdScore >= TONAL_SOURCE_MSD_MIN &&
    phaseScore >= TONAL_SOURCE_PHASE_MIN &&
    spectralScore >= TONAL_SOURCE_SPECTRAL_MIN &&
    ihrScore <= TONAL_SOURCE_IHR_MAX &&
    ptmrScore <= TONAL_SOURCE_PTMR_MAX &&
    !(
      msdScore >= CORE_CONSENSUS_MSD_THRESHOLD &&
      phaseScore >= CORE_CONSENSUS_PHASE_THRESHOLD &&
      spectralScore >= CORE_CONSENSUS_SPECTRAL_THRESHOLD
    )
  ) {
    feedbackProbability *= TONAL_SOURCE_GATE_PENALTY
    reasons.push('Sustained tonal-source gate: low harmonic cleanliness')
  }

  // Compressed tonal sources can retain extremely high phase coherence even
  // when they are not feedback. Penalize that pattern unless cleaner evidence
  // shows up elsewhere.
  if (
    noCombPattern &&
    scores.compression?.isCompressed === true &&
    phaseScore >= COMPRESSED_PHASE_TONE_PHASE_MIN &&
    (
      msdScore >= COMPRESSED_PHASE_TONE_MSD_MIN ||
      spectralScore >= COMPRESSED_PHASE_TONE_SPECTRAL_MIN
    ) &&
    ihrScore <= COMPRESSED_PHASE_TONE_IHR_MAX &&
    ptmrScore <= COMPRESSED_PHASE_TONE_PTMR_MAX
  ) {
    feedbackProbability *= COMPRESSED_PHASE_TONE_GATE_PENALTY
    reasons.push('Compressed tonal-source gate: phase-dominant sustained source')
  }

  if (
    noCombPattern &&
    scores.compression?.isCompressed === true &&
    phaseScore >= COMPRESSED_VOICED_SOURCE_PHASE_MIN &&
    msdScore >= COMPRESSED_VOICED_SOURCE_MSD_MIN &&
    spectralScore >= COMPRESSED_VOICED_SOURCE_SPECTRAL_MIN &&
    ihrScore <= COMPRESSED_VOICED_SOURCE_IHR_MAX &&
    ptmrScore <= COMPRESSED_VOICED_SOURCE_PTMR_MAX
  ) {
    feedbackProbability *= COMPRESSED_VOICED_SOURCE_GATE_PENALTY
    reasons.push('Compressed voiced-source gate: phase-stable voiced source')
  }

  // 14.3: Apply post-gate calibration (identity by default — zero behavior change)
  feedbackProbability = calibrateProbability(feedbackProbability, calibrationTable)
  // Final clamp — gates can only reduce, but calibration tables can extrapolate beyond [0, 1]
  if (feedbackProbability > 1) feedbackProbability = 1
  else if (feedbackProbability < 0) feedbackProbability = 0

  // Agreement and confidence use effective scores (collected above)
  let _effSum = 0
  for (let i = 0; i < effCount; i++) _effSum += _effScores[i]
  const mean = effCount > 0 ? _effSum / effCount : 0
  let strongSignalCount = 0
  for (let i = 0; i < effCount; i++) {
    if (_effScores[i] >= STRONG_SIGNAL_THRESHOLD) strongSignalCount++
  }
  let _effVarSum = 0
  for (let i = 0; i < effCount; i++) {
    const d = _effScores[i] - mean
    _effVarSum += d * d
  }
  const variance = effCount > 0 ? _effVarSum / effCount : 0
  // Normalize disagreement against the maximum possible stddev for bounded
  // [0,1] scores. This gives agreement the full [0,1] range instead of
  // bottoming out around 0.5, so contradictory algorithms meaningfully
  // suppress confidence and verdict certainty.
  const disagreement = Math.min(Math.sqrt(variance) / MAX_EFFECTIVE_SCORE_STDDEV, 1)
  const agreement = 1 - disagreement
  // 14.8: Use the accumulated persistence bonus from prior frames for the
  // current decision, then fold this frame's agreement into the tracker for
  // subsequent frames. Otherwise one contradictory frame erases the very
  // persistence signal we want to use to stabilize that frame's verdict.
  const persistenceBonus = agreementTracker?.persistenceBonus ?? 0
  const confidence = Math.min(
    feedbackProbability * (0.5 + 0.5 * agreement) + persistenceBonus,
    1,
  )
  agreementTracker?.update(agreement)

  let verdict: FusedDetectionResult['verdict']
  const possibleFeedbackThreshold = Math.max(config.feedbackThreshold * 0.6, 0.35)
  const shapeOrStabilityCorroboration =
    (scores.msd?.feedbackScore ?? 0) >= STRONG_SHAPE_OR_STABILITY_THRESHOLD ||
    (scores.ptmr?.feedbackScore ?? 0) >= STRONG_SHAPE_OR_STABILITY_THRESHOLD ||
    scores.comb?.hasPattern === true
  const harmonicStrongCorroboration =
    (scores.ihr?.feedbackScore ?? 0) >= STRONG_IHR_CORROBORATION_THRESHOLD &&
    strongSignalCount >= 3
  const compressedFeedbackPromotionAllowed =
    (scores.compression?.thresholdMultiplier ?? 1) <= 1
  const strongCorroboratedFeedback =
    compressedFeedbackPromotionAllowed &&
    feedbackProbability >= (config.feedbackThreshold - STRONG_CORROBORATION_PROBABILITY_MARGIN) &&
    confidence >= STRONG_CORROBORATION_CONFIDENCE_THRESHOLD &&
    (
      coreConsensus ||
      (harmonicStrongCorroboration && shapeOrStabilityCorroboration)
    )
  const compressedPhaseDegradedFeedback =
    !compressedFeedbackPromotionAllowed &&
    feedbackProbability >= config.feedbackThreshold &&
    confidence >= STRONG_CORROBORATION_CONFIDENCE_THRESHOLD &&
    phaseScore <= COMPRESSED_PHASE_DEGRADED_PHASE_MAX &&
    msdScore >= COMPRESSED_PHASE_DEGRADED_MSD_MIN &&
    spectralScore >= COMPRESSED_PHASE_DEGRADED_SPECTRAL_MIN &&
    ihrScore >= COMPRESSED_PHASE_DEGRADED_IHR_MIN &&
    ptmrScore >= COMPRESSED_PHASE_DEGRADED_PTMR_MIN
  const strongCorroboratedPossible =
    feedbackProbability >= STRONG_CORROBORATION_POSSIBLE_THRESHOLD &&
    confidence >= STRONG_CORROBORATION_POSSIBLE_CONFIDENCE_THRESHOLD &&
    harmonicStrongCorroboration
  const persistenceLiftEligible =
    persistenceBonus >= 0.04 &&
    feedbackProbability >= possibleFeedbackThreshold &&
    confidence >= 0.22
  if (effCount === 0) {
    verdict = 'NOT_FEEDBACK'
  } else if (
    (feedbackProbability >= config.feedbackThreshold && confidence >= BASE_FEEDBACK_CONFIDENCE_THRESHOLD) ||
    strongCorroboratedFeedback ||
    compressedPhaseDegradedFeedback
  ) {
    if (strongCorroboratedFeedback && confidence < BASE_FEEDBACK_CONFIDENCE_THRESHOLD) {
      reasons.push('Strong multi-algorithm corroboration')
    }
    if (compressedPhaseDegradedFeedback) {
      reasons.push('Compression-resistant corroboration despite phase damage')
    }
    verdict = 'FEEDBACK'
  } else if (
    feedbackProbability >= possibleFeedbackThreshold &&
    (confidence >= 0.3 || persistenceLiftEligible)
  ) {
    verdict = 'POSSIBLE_FEEDBACK'
  } else if (strongCorroboratedPossible) {
    reasons.push('Strong corroboration despite limited algorithm availability')
    verdict = 'POSSIBLE_FEEDBACK'
  } else if (feedbackProbability < 0.2 && agreement >= 0.8 && effCount >= 3) {
    verdict = 'NOT_FEEDBACK'
  } else {
    verdict = 'UNCERTAIN'
  }

  return {
    feedbackProbability,
    confidence,
    contributingAlgorithms,
    algorithmScores: scores,
    verdict,
    reasons,
  }
}

// ── MINDS Algorithm — DAFx-16 ───────────────────────────────────────────────

/**
 * MINDS: MSD-Inspired Notch Depth Setting.
 * Strategy: start shallow (-3 dB), deepen 1 dB at a time until growth stops.
 */
export function calculateMINDS(
  magnitudeHistory: number[],
  currentDepthDb: number = 0,
  framesPerSecond: number = 50
): MINDSResult {
  const minFrames = 3

  if (magnitudeHistory.length < minFrames) {
    return {
      suggestedDepthDb: -3,
      isGrowing: false,
      recentGradient: 0,
      confidence: 0.3,
      recommendation: 'Not enough data yet - try -3 dB notch',
    }
  }

  const n = magnitudeHistory.length
  const gradients: number[] = []
  for (let i = 1; i < n; i++) {
    gradients.push(magnitudeHistory[i] - magnitudeHistory[i - 1])
  }

  const lastGradient  = gradients[gradients.length - 1] || 0
  const prevGradient  = gradients[gradients.length - 2] || 0
  const recentGrads   = gradients.slice(-3)
  const recentGradient = recentGrads.reduce((a, b) => a + b, 0) / recentGrads.length

  const isGrowing = lastGradient > 0.1 && prevGradient > 0.1

  const totalGrowth    = magnitudeHistory[n - 1] - magnitudeHistory[0]
  const durationSec    = n / framesPerSecond
  const growthRateDbPerSec = durationSec > 0 ? totalGrowth / durationSec : 0

  let suggestedDepthDb: number
  let confidence: number
  let recommendation: string

  if (isGrowing) {
    const baseDepth = Math.abs(currentDepthDb) || 3

    if (growthRateDbPerSec > 6) {
      suggestedDepthDb = -Math.min(baseDepth + 6, 18)
      confidence = 0.9
      recommendation = `URGENT: Runaway feedback (${growthRateDbPerSec.toFixed(1)} dB/s) - apply ${suggestedDepthDb} dB notch immediately`
    } else if (growthRateDbPerSec > 3) {
      suggestedDepthDb = -Math.min(baseDepth + 3, 15)
      confidence = 0.85
      recommendation = `Growing feedback (${growthRateDbPerSec.toFixed(1)} dB/s) - suggest ${suggestedDepthDb} dB notch`
    } else if (growthRateDbPerSec > 1) {
      suggestedDepthDb = -Math.min(baseDepth + 2, 12)
      confidence = 0.75
      recommendation = `Slow growth detected - suggest ${suggestedDepthDb} dB notch`
    } else {
      suggestedDepthDb = -Math.min(baseDepth + 1, 9)
      confidence = 0.6
      recommendation = `Minor growth - try ${suggestedDepthDb} dB notch`
    }
  } else {
    if (totalGrowth > 6) {
      suggestedDepthDb = currentDepthDb || -6
      confidence = 0.7
      recommendation = `Level stable at high gain - maintain ${suggestedDepthDb} dB notch`
    } else if (totalGrowth > 3) {
      suggestedDepthDb = currentDepthDb || -4
      confidence = 0.6
      recommendation = `Moderate resonance - suggest ${suggestedDepthDb} dB notch`
    } else {
      suggestedDepthDb = -3
      confidence = 0.5
      recommendation = `Light resonance - try ${suggestedDepthDb} dB notch`
    }
  }

  return { suggestedDepthDb, isGrowing, recentGradient, confidence, recommendation }
}
