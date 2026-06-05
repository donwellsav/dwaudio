// DoneWell Audio Classifier - Distinguishes feedback vs whistle vs instrument
// Integrates deterministic MSD, phase, spectral, comb, IHR, and PTMR evidence.

import { CLASSIFIER_WEIGHTS, SEVERITY_THRESHOLDS, PHPR_SETTINGS, MAINS_HUM_GATE } from './constants'
import type {
  Track,
  ClassificationResult,
  SeverityLevel,
  IssueLabel,
  TrackedPeak,
  DetectorSettings,
  ReportGateDecision,
} from '@/types/advisory'
import {
  normalizeTrackInput,
  countFormantBands,
  isChromaticallyQuantized,
  detectMainsHum,
  getRecentFrequencyHistory,
  CHROMATIC_PHASE_THRESHOLD,
  CHROMATIC_PHASE_REDUCTION,
  FORMANT_BANDS,
} from './classifierHelpers'
import type { TrackInput } from './classifierHelpers'
import type { AlgorithmScores, FusedDetectionResult } from './advancedDetection'
import {
  getFrequencyBand,
  calculateModalOverlap,
  classifyModalOverlap,
  analyzeCumulativeGrowth,
  calculateCalibratedConfidence,
  analyzeVibrato,
} from './acousticUtils'

// ── Classifier Tuning Constants ─────────────────────────────────────────────
/**
 * Heuristic prior weights per class (Bayesian-style classification).
 * Feedback prior is elevated (0.45 vs uniform 0.33) because the user has
 * explicitly opened a feedback-detection tool — the base rate of feedback
 * in this context is higher than uniform.  Whistle and instrument share
 * the remainder equally.  Sum ≈ 0.99 (same as the original 3 × 0.33).
 */
const PRIOR_FEEDBACK = 0.45
const PRIOR_WHISTLE = 0.27
const PRIOR_INSTRUMENT = 0.27

const FORMANT_Q_MIN = 3
const FORMANT_Q_MAX = 20
const FORMANT_MIN_MATCHES = 2     // Need peaks in at least 2 distinct bands
const FORMANT_GATE_MULTIPLIER = 0.65
const VIBRATO_CONFIRMATION_MIN_MODULATION = CLASSIFIER_WEIGHTS.MODULATION_THRESHOLD * 0.5
const VIBRATO_CONFIRMATION_MAX_MODULATION = 0.75
const VIBRATO_CONFIRMATION_MAX_BOOST = 0.2
const VIBRATO_CONFIRMATION_FEEDBACK_PENALTY = 0.4
const WHISTLE_FEEDBACK_PROMOTION_REASON =
  'Whistle-shaped tone retained as feedback due to growth/fusion evidence'
const WHISTLE_NON_CORRECTIVE_REASON =
  'Whistle-like tone detected without enough feedback evidence for corrective action'
const WHISTLE_PROMOTION_MIN_FEEDBACK = 0.50
const WHISTLE_PROMOTION_MARGIN = 0.10
const LIVE_MUSIC_MATERIAL_INSTRUMENT_POSTERIOR_MIN = 0.30
const LIVE_MUSIC_MATERIAL_FEEDBACK_POSTERIOR_MIN = 0.55
const CONSERVATIVE_GROWING_MIN_PERSISTENCE_MS = 80
const STRONG_WHISTLE_MODULATION_MIN = 0.65
const STRONG_WHISTLE_SIDEBAND_MIN = 0.7
const CHROMATIC_STEADY_TONE_MAX_GROWTH_DB = 2
const CHROMATIC_STEADY_TONE_MIN_PERSISTENCE_MS = 120

function isUrgentFeedbackSeverity(severity: SeverityLevel): boolean {
  return severity === 'RUNAWAY' || severity === 'GROWING'
}

function pushReasonOnce(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason)
  }
}

function removeWhistlePolicyReasons(reasons: string[]): void {
  for (let i = reasons.length - 1; i >= 0; i--) {
    if (
      reasons[i] === WHISTLE_FEEDBACK_PROMOTION_REASON
      || reasons[i] === WHISTLE_NON_CORRECTIVE_REASON
    ) {
      reasons.splice(i, 1)
    }
  }
}

/**
 * Internal whistle-promotion policy.
 * Exported for unit coverage because one narrow-margin branch is easier to
 * validate directly than through full classifier integration scaffolding.
 */
export function shouldPromoteWhistleToFeedback(
  whistleCandidate: boolean,
  severity: SeverityLevel,
  fusionVerdict: ClassificationResult['fusionVerdict'],
  pFeedback: number,
  pWhistle: number,
): boolean {
  if (!whistleCandidate) return false
  if (isUrgentFeedbackSeverity(severity)) return true
  if (fusionVerdict === 'FEEDBACK') return true
  return (
    fusionVerdict === 'POSSIBLE_FEEDBACK'
    && pFeedback >= WHISTLE_PROMOTION_MIN_FEEDBACK
    && (pWhistle - pFeedback) <= WHISTLE_PROMOTION_MARGIN
  )
}

function normalizePromotedWhistleSeverity(
  severity: SeverityLevel,
  definitiveFeedback: boolean,
  fusionConfidence: number,
): SeverityLevel {
  if (severity !== 'WHISTLE' && severity !== 'INSTRUMENT') {
    return severity
  }
  return definitiveFeedback && fusionConfidence > 0.8 ? 'GROWING' : 'RESONANCE'
}

/**
 * Classify a track as feedback, whistle, or instrument
 * Uses weighted scoring model based on extracted features
 */
export function classifyTrack(track: TrackInput, settings?: DetectorSettings, activeFrequencies?: number[]): ClassificationResult {
  const features = normalizeTrackInput(track)
  const reasons: string[] = []
  let speechLikePattern = false

  // ==================== Acoustic Context ====================

  // Local-only fork: no hidden room/environment model. Frequency banding uses
  // fixed detector bands so stale room settings cannot change classification.
  const freqBand = getFrequencyBand(features.frequencyHz)
  
  // Calculate modal overlap indicator (M = 1/Q, based on textbook Section 1.2.6.7)
  const modalOverlap = calculateModalOverlap(features.minQ)
  const modalAnalysis = classifyModalOverlap(modalOverlap)
  
  // Analyze cumulative growth for slow-building feedback
  const cumulativeGrowth = analyzeCumulativeGrowth(
    features.onsetDb,
    features.amplitudeDb,
    features.persistenceMs
  )
  const qThreshold = SEVERITY_THRESHOLDS.HIGH_Q * freqBand.qThresholdMultiplier

  // Initialize confidence scores with context-aware priors
  let pFeedback = PRIOR_FEEDBACK
  let pWhistle = PRIOR_WHISTLE
  let pInstrument = PRIOR_INSTRUMENT

  // ==================== Feature Analysis ====================

  // 1. Stationarity (low pitch variation = feedback)
  // Apply frequency-dependent threshold
  const stabilityThreshold = CLASSIFIER_WEIGHTS.STABILITY_THRESHOLD_CENTS * freqBand.sustainMultiplier
  const stabilityScore = features.stabilityCentsStd < stabilityThreshold ? 1 : 0
  if (stabilityScore > 0) {
    pFeedback += CLASSIFIER_WEIGHTS.STABILITY_FEEDBACK * stabilityScore
    reasons.push(`Pitch stability: ${features.stabilityCentsStd.toFixed(1)} cents std dev`)
  } else {
    // High variation suggests whistle or instrument
    pWhistle += 0.1
    pInstrument += 0.1
  }

  // 2. Harmonicity (coherent harmonics = instrument)
  if (features.harmonicityScore > CLASSIFIER_WEIGHTS.HARMONICITY_THRESHOLD) {
    pInstrument += CLASSIFIER_WEIGHTS.HARMONICITY_INSTRUMENT * features.harmonicityScore
    reasons.push(`Harmonic structure detected: ${(features.harmonicityScore * 100).toFixed(0)}%`)
  }

  // 2b. PHPR (Peak-to-Harmonic Power Ratio) — Van Waterschoot & Moonen 2011
  // Feedback is sinusoidal (no harmonics), music has rich harmonics
  if (features.phpr !== undefined) {
    if (features.phpr >= PHPR_SETTINGS.FEEDBACK_THRESHOLD_DB) {
      pFeedback += PHPR_SETTINGS.CONFIDENCE_BOOST
      reasons.push(`Pure tone (PHPR ${features.phpr.toFixed(0)} dB) — likely feedback`)
    } else if (features.phpr <= PHPR_SETTINGS.MUSIC_THRESHOLD_DB) {
      pInstrument += PHPR_SETTINGS.CONFIDENCE_PENALTY
      reasons.push(`Harmonics present (PHPR ${features.phpr.toFixed(0)} dB) — likely music/speech`)
    }
  }

  // 3. Modulation (vibrato = whistle)
  if (features.modulationScore > CLASSIFIER_WEIGHTS.MODULATION_THRESHOLD) {
    pWhistle += CLASSIFIER_WEIGHTS.MODULATION_WHISTLE * features.modulationScore
    reasons.push(`Vibrato/modulation: ${(features.modulationScore * 100).toFixed(0)}%`)
  }

  const strongWhistleModulation =
    features.modulationScore >= 0.8 &&
    features.harmonicityScore < CLASSIFIER_WEIGHTS.HARMONICITY_THRESHOLD &&
    features.minQ < qThreshold
  if (strongWhistleModulation) {
    pWhistle += 0.12
    pFeedback = Math.max(0, pFeedback - 0.08)
    reasons.push(`Strong whistle modulation: ${(features.modulationScore * 100).toFixed(0)}%`)
  }

  // 4. Sideband noise (breath = whistle)
  if (features.noiseSidebandScore > CLASSIFIER_WEIGHTS.SIDEBAND_THRESHOLD) {
    pWhistle += CLASSIFIER_WEIGHTS.SIDEBAND_WHISTLE * features.noiseSidebandScore
    reasons.push(`Breath noise detected: ${(features.noiseSidebandScore * 100).toFixed(0)}%`)
  }

  // 4b. Vibrato confirmation: use history only for ambiguous whistle candidates.
  // This avoids re-running vibrato analysis on clearly stable feedback and
  // avoids double-counting obvious high-modulation whistles.
  const shouldConfirmVibrato =
    features.modulationScore >= VIBRATO_CONFIRMATION_MIN_MODULATION &&
    features.modulationScore < VIBRATO_CONFIRMATION_MAX_MODULATION
  if (shouldConfirmVibrato) {
    const frequencyHistory = getRecentFrequencyHistory(track)
    if (frequencyHistory) {
      const vibratoAnalysis = analyzeVibrato(frequencyHistory)
      if (vibratoAnalysis.hasVibrato) {
        const vibratoBoost = Math.min(
          vibratoAnalysis.whistleProbability * 0.5,
          VIBRATO_CONFIRMATION_MAX_BOOST
        )
        pWhistle += vibratoBoost
        pFeedback = Math.max(0, pFeedback - vibratoBoost * VIBRATO_CONFIRMATION_FEEDBACK_PENALTY)
        reasons.push(`Vibrato confirmation: ${vibratoAnalysis.vibratoRateHz?.toFixed(1)}Hz, ${vibratoAnalysis.vibratoDepthCents?.toFixed(0)} cents`)
      }
    }
  }

  // 5. Runaway growth (high velocity = feedback)
  // Use settings.growthRateThreshold if provided, otherwise fall back to constant
  const growthThreshold = settings?.growthRateThreshold ?? CLASSIFIER_WEIGHTS.GROWTH_THRESHOLD
  if (features.maxVelocityDbPerSec > growthThreshold) {
    const growthFactor = Math.min(features.maxVelocityDbPerSec / 20, 1)
    pFeedback += CLASSIFIER_WEIGHTS.GROWTH_FEEDBACK * growthFactor
    reasons.push(`Rapid growth: ${features.maxVelocityDbPerSec.toFixed(1)} dB/sec`)
  }

  // 6. Q factor with frequency-dependent threshold
  if (features.minQ > qThreshold) {
    pFeedback += 0.15
    reasons.push(`Narrow Q: ${features.minQ.toFixed(1)} (band: ${freqBand.band})`)
  }

  // 7. Persistence without modulation
  const persistenceThreshold = 1000 * freqBand.sustainMultiplier
  if (features.persistenceMs > persistenceThreshold && features.modulationScore < 0.2) {
    pFeedback += 0.1
    reasons.push(`Sustained without modulation: ${(features.persistenceMs / 1000).toFixed(1)}s`)
  }

  // 8. Q-overlap context
  // Isolated narrow peaks are more likely feedback; diffuse peaks are more
  // likely complex source material.
  pFeedback += modalAnalysis.feedbackProbabilityBoost
  if (modalAnalysis.classification === 'ISOLATED') {
    reasons.push(`Isolated mode (M=${modalOverlap.toFixed(2)}) - high feedback risk`)
  } else if (modalAnalysis.classification === 'DIFFUSE') {
    reasons.push(`Diffuse peak shape (M=${modalOverlap.toFixed(2)}) - likely complex source material`)
  }

  // 9. NEW: Cumulative growth analysis (slow-building feedback)
  if (cumulativeGrowth.shouldAlert) {
    if (cumulativeGrowth.severity === 'RUNAWAY') {
      pFeedback += 0.25
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (RUNAWAY)`)
    } else if (cumulativeGrowth.severity === 'GROWING') {
      pFeedback += 0.15
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (growing)`)
    } else if (cumulativeGrowth.severity === 'BUILDING') {
      pFeedback += 0.08
      reasons.push(`Cumulative growth: +${cumulativeGrowth.totalGrowthDb.toFixed(1)}dB (building)`)
    }
  }

  // 11. Formant gate — suppress sustained vowel false positives (Fant 1960)
  // When the current peak has moderate Q (vocal tract, not feedback) AND
  // 2+ active peaks fall in distinct formant bands (F1/F2/F3), this is
  // likely a voiced speech segment, not feedback.
  if (
    activeFrequencies && activeFrequencies.length >= FORMANT_MIN_MATCHES &&
    features.minQ >= FORMANT_Q_MIN && features.minQ <= FORMANT_Q_MAX &&
    FORMANT_BANDS.some(b => features.frequencyHz >= b.min && features.frequencyHz <= b.max)
  ) {
    const bandsHit = countFormantBands(activeFrequencies)
    if (bandsHit >= FORMANT_MIN_MATCHES) {
      speechLikePattern = true
      pFeedback *= (settings?.formantGateOverride ?? FORMANT_GATE_MULTIPLIER)
      reasons.push(`Formant gate: ${bandsHit} vocal formant bands active, Q=${features.minQ.toFixed(0)} (speech-like)`)
    }
  }

  // ==================== Normalization ====================

  // Clamp scores to valid range before normalization
  pFeedback = Math.max(0, Math.min(1, pFeedback))
  pWhistle = Math.max(0, Math.min(1, pWhistle))
  pInstrument = Math.max(0, Math.min(1, pInstrument))

  const total = pFeedback + pWhistle + pInstrument
  if (total > 0) {
    pFeedback /= total
    pWhistle /= total
    pInstrument /= total
  }

  // Calculate calibrated confidence using new utility
  const calibratedResult = calculateCalibratedConfidence(
    pFeedback,
    pWhistle,
    pInstrument,
    modalAnalysis.feedbackProbabilityBoost,
    cumulativeGrowth.severity
  )

  // F5 fix: apply adjustedPFeedback and renormalize so the scores
  // and confidence describe the same model state.
  pFeedback = calibratedResult.adjustedPFeedback
  const postCalibTotal = pFeedback + pWhistle + pInstrument
  if (postCalibTotal > 0) {
    pFeedback /= postCalibTotal
    pWhistle /= postCalibTotal
    pInstrument /= postCalibTotal
  }

  const confidence = calibratedResult.confidence
  // pUnknown is computed after severity overrides (below) to maintain score consistency

  // ==================== Classification ====================

  let label: IssueLabel
  let severity: SeverityLevel

  // Determine severity based on velocity, cumulative growth, prominence, and other factors
  // Use settings thresholds if provided, otherwise fall back to constants
  const runawayVelocity = SEVERITY_THRESHOLDS.RUNAWAY_VELOCITY
  const growingVelocity = settings?.growthRateThreshold ?? SEVERITY_THRESHOLDS.GROWING_VELOCITY
  const ringThreshold = settings?.ringThresholdDb ?? 5 // Default 5dB prominence for ring
  
  // Priority 1: Check for runaway (instantaneous OR cumulative)
  if (features.maxVelocityDbPerSec >= runawayVelocity || cumulativeGrowth.severity === 'RUNAWAY') {
    severity = 'RUNAWAY'
    pFeedback = Math.max(pFeedback, 0.85) // Runaway almost always feedback
  }
  // Priority 2: Check for growing (instantaneous OR cumulative)
  else if (features.maxVelocityDbPerSec >= growingVelocity || cumulativeGrowth.severity === 'GROWING') {
    severity = 'GROWING'
    pFeedback = Math.max(pFeedback, 0.7)
  }
  // Priority 3: Check cumulative building (slow but steady growth)
  else if (cumulativeGrowth.severity === 'BUILDING' && !speechLikePattern) {
    severity = 'GROWING' // Treat as growing for early warning
    reasons.push('Early warning: slow buildup detected')
  }
  // Priority 4: High Q resonance
  else if (features.minQ > qThreshold) {
    severity = 'RESONANCE'
  }
  // Priority 5: Prominent but short-lived = ring
  else if (features.prominenceDb >= ringThreshold && features.persistenceMs < SEVERITY_THRESHOLDS.PERSISTENCE_MS) {
    severity = 'POSSIBLE_RING'
  }
  // Priority 6: Prominent and persisting = resonance
  else if (features.prominenceDb >= ringThreshold) {
    severity = 'RESONANCE'
  }
  // Default: resonance
  else {
    severity = 'RESONANCE'
  }

  if (cumulativeGrowth.severity === 'BUILDING' && speechLikePattern) {
    reasons.push('Early warning held at resonance: speech-like formant pattern')
  }

  // F5: Renormalize after severity overrides so the scores sum to 1.
  // Severity overrides (e.g. RUNAWAY Math.max(pFeedback, 0.85)) can push
  // the class sum above 1.0 — renormalize to maintain a valid distribution.
  const postSeverityTotal = pFeedback + pWhistle + pInstrument
  if (postSeverityTotal > 1) {
    pFeedback /= postSeverityTotal
    pWhistle /= postSeverityTotal
    pInstrument /= postSeverityTotal
  }
  const pUnknown = Math.max(0, 1 - (pFeedback + pWhistle + pInstrument))

  // Determine label
  const whistleWins =
    (
      pWhistle >= CLASSIFIER_WEIGHTS.WHISTLE_THRESHOLD ||
      (
        features.modulationScore >= STRONG_WHISTLE_MODULATION_MIN &&
        features.noiseSidebandScore >= STRONG_WHISTLE_SIDEBAND_MIN &&
        features.minQ < qThreshold &&
        features.harmonicityScore < CLASSIFIER_WEIGHTS.HARMONICITY_THRESHOLD &&
        features.maxVelocityDbPerSec < growingVelocity
      )
    ) &&
    pWhistle > pFeedback
  const instrumentWins =
    pInstrument >= CLASSIFIER_WEIGHTS.INSTRUMENT_THRESHOLD && pInstrument > pFeedback
  const whistleFeedbackPromoted = shouldPromoteWhistleToFeedback(
    whistleWins,
    severity,
    'UNCERTAIN',
    pFeedback,
    pWhistle,
  )

  if (whistleFeedbackPromoted) {
    label = 'ACOUSTIC_FEEDBACK'
    pushReasonOnce(reasons, WHISTLE_FEEDBACK_PROMOTION_REASON)
  } else if (whistleWins) {
    label = 'WHISTLE'
    severity = 'WHISTLE'
    pushReasonOnce(reasons, WHISTLE_NON_CORRECTIVE_REASON)
  } else if (instrumentWins) {
    label = 'INSTRUMENT'
    severity = 'INSTRUMENT'
  } else if (severity === 'POSSIBLE_RING') {
    label = 'POSSIBLE_RING'
  } else {
    label = 'ACOUSTIC_FEEDBACK'
  }

  // Override: Runaway is always feedback
  if (severity === 'RUNAWAY') {
    label = 'ACOUSTIC_FEEDBACK'
  }

  return {
    pFeedback,
    pWhistle,
    pInstrument,
    pUnknown,
    label,
    severity,
    confidence,
    fusionVerdict: 'UNCERTAIN',
    recommendationEligible: true,
    reasons,
    // Enhanced fields from acoustic analysis
    frequencyHz: features.frequencyHz,
    modalOverlapFactor: modalOverlap,
    cumulativeGrowthDb: cumulativeGrowth.totalGrowthDb,
    frequencyBand: freqBand.band,
    confidenceLabel: calibratedResult.confidenceLabel,
    prominenceDb: features.prominenceDb,
    persistenceMs: features.persistenceMs,
    speechLikePattern,
  }
}

/**
 * Determine if an issue should be reported based on mode, classification, and confidence
 * Enhanced with confidence threshold filtering to reduce false positives
 */
export function shouldReportIssue(
  classification: ClassificationResult,
  settings: DetectorSettings
): boolean {
  return getReportGateDecision(classification, settings).shouldReport
}

export function getReportGateDecision(
  classification: ClassificationResult,
  settings: DetectorSettings,
): ReportGateDecision {
  const mode = settings.mode
  const ignoreWhistle = settings.ignoreWhistle ?? false
  const { label, severity, confidence } = classification
  const speechLikePattern = classification.speechLikePattern ?? false

  if (!classification.recommendationEligible) {
    return {
      shouldReport: false,
      gate: 'not-eligible',
      reason: 'Classification is not eligible for corrective action',
    }
  }
  
  // Get confidence threshold from settings (default 0.40 = 40%)
  const confidenceThreshold = settings.confidenceThreshold ?? 0.40

  const isSteadyChromaticTone =
    mode !== 'monitors' &&
    classification.frequencyHz != null &&
    isChromaticallyQuantized(classification.frequencyHz) &&
    classification.cumulativeGrowthDb != null &&
    classification.cumulativeGrowthDb <= CHROMATIC_STEADY_TONE_MAX_GROWTH_DB &&
    (classification.persistenceMs ?? 0) >= CHROMATIC_STEADY_TONE_MIN_PERSISTENCE_MS
  if (isSteadyChromaticTone) {
    return {
      shouldReport: false,
      gate: 'steady-chromatic-tone',
      reason: 'Steady chromatic tone looks more like source material than feedback',
    }
  }

  // Always report runaway regardless of mode or confidence
  if (severity === 'RUNAWAY') {
    return {
      shouldReport: true,
      gate: 'reported',
      reason: 'Runaway feedback severity bypasses normal report gates',
    }
  }
  
  // Always report GROWING severity regardless of confidence (early warning)
  if (severity === 'GROWING') {
    if (
      classification.fusionVerdict !== 'FEEDBACK' &&
      (classification.persistenceMs ?? 0) < CONSERVATIVE_GROWING_MIN_PERSISTENCE_MS
    ) {
      return {
        shouldReport: false,
        gate: 'growing-waiting-persistence',
        reason: 'Growing candidate is waiting for enough persistence',
      }
    }
    if ((mode === 'speech' || mode === 'worship') && speechLikePattern && classification.fusionVerdict !== 'FEEDBACK') {
      return {
        shouldReport: false,
        gate: 'speech-formant',
        reason: 'Speech-like formant pattern is holding the advisory',
      }
    }
    return {
      shouldReport: true,
      gate: 'reported',
      reason: 'Growing feedback severity is reportable',
    }
  }

  // Fusion never became decisive enough to justify a corrective advisory.
  // Keep the UI quiet for uncertain cases instead of surfacing low-trust cuts.
  if (classification.fusionVerdict === 'UNCERTAIN') {
    return {
      shouldReport: false,
      gate: 'fusion-uncertain',
      reason: 'Fusion is still uncertain',
    }
  }

  if (classification.fusionVerdict === 'NOT_FEEDBACK') {
    return {
      shouldReport: false,
      gate: 'fusion-not-feedback',
      reason: 'Fusion classified this as not feedback',
    }
  }

  // Speech and worship are the highest false-positive-risk paths for sustained
  // voiced tones. When fusion only reaches POSSIBLE_FEEDBACK and instrument-like
  // posterior mass is still materially present, suppress the corrective advisory.
  if (
    (mode === 'speech' || mode === 'worship')
    && speechLikePattern
    && classification.fusionVerdict !== 'FEEDBACK'
  ) {
    return {
      shouldReport: false,
      gate: 'speech-formant',
      reason: 'Speech-like formant pattern is holding the advisory',
    }
  }

  if (
    (mode === 'speech' || mode === 'worship')
    && classification.fusionVerdict === 'POSSIBLE_FEEDBACK'
    && label === 'ACOUSTIC_FEEDBACK'
    && classification.pFeedback < 0.40
    && classification.pInstrument >= 0.35
  ) {
    return {
      shouldReport: false,
      gate: 'speech-material',
      reason: 'Speech/worship material posterior is still too high',
    }
  }

  if (
    mode === 'liveMusic'
    && classification.fusionVerdict === 'POSSIBLE_FEEDBACK'
    && classification.pFeedback < LIVE_MUSIC_MATERIAL_FEEDBACK_POSTERIOR_MIN
    && classification.pInstrument >= LIVE_MUSIC_MATERIAL_INSTRUMENT_POSTERIOR_MIN
  ) {
    return {
      shouldReport: false,
      gate: 'music-material',
      reason: 'Live-music material posterior is still too high',
    }
  }

  // Filter by confidence threshold (reduces low-confidence alerts)
  if (confidence < confidenceThreshold) {
    return {
      shouldReport: false,
      gate: 'low-confidence',
      reason: 'Confidence is below the display threshold',
    }
  }

  // Handle whistle filtering
  if (label === 'WHISTLE' && ignoreWhistle) {
    return {
      shouldReport: false,
      gate: 'whistle-ignored',
      reason: 'Whistle filtering is enabled',
    }
  }

  // Mode-specific filtering — professional live sound scenarios
  let modePass: boolean
  switch (mode) {
    case 'speech':
      // Corporate/conference — report feedback and rings, suppress instruments
      modePass = label !== 'INSTRUMENT'
      break

    case 'worship':
      // House of worship — music-aware, skip instruments during music portions
      modePass = label !== 'INSTRUMENT'
      break

    case 'liveMusic':
      // Live music still needs early rings. Confidence filtering already ran
      // above, so don't add a second POSSIBLE_RING gate here.
      modePass = label !== 'INSTRUMENT'
      break

    case 'theater':
      // Theater/drama — report feedback and rings, skip instruments
      modePass = label !== 'INSTRUMENT'
      break

    case 'monitors':
      // Stage monitors — report everything including instruments (could be feedback)
      modePass = true
      break

    case 'broadcast':
      // Studio/broadcast — very sensitive, report feedback and rings
      modePass = label !== 'INSTRUMENT'
      break

    case 'outdoor':
      // Outdoor — report feedback and strong rings, skip instruments
      modePass = label !== 'INSTRUMENT'
      break

    default:
      modePass = label === 'ACOUSTIC_FEEDBACK' || label === 'POSSIBLE_RING'
      break
  }

  if (!modePass) {
    return {
      shouldReport: false,
      gate: 'mode-filter',
      reason: `${mode} mode filtered this label`,
    }
  }

  return {
    shouldReport: true,
    gate: 'reported',
    reason: 'Passed report gates',
  }
}

/**
 * Get display text for severity level
 */
export function getSeverityText(severity: SeverityLevel): string {
  switch (severity) {
    case 'RUNAWAY': return 'RUNAWAY'
    case 'GROWING': return 'Growing'
    case 'RESONANCE': return 'Resonance'
    case 'POSSIBLE_RING': return 'Ring'
    case 'WHISTLE': return 'Whistle'
    case 'INSTRUMENT': return 'Instrument'
    default: return 'Unknown'
  }
}

// getSeverityUrgency extracted to ./severityUtils — re-exported below for backward compat
export { getSeverityUrgency } from './severityUtils'

// ============================================================================
// ENHANCED CLASSIFICATION WITH ADVANCED ALGORITHMS
// ============================================================================

/**
 * Enhanced classification that incorporates advanced algorithm scores
 * Combines traditional classification with MSD, Phase, and Spectral analysis
 */
export function classifyTrackWithAlgorithms(
  track: Track | TrackedPeak,
  algorithmScores: AlgorithmScores | null,
  fusionResult: FusedDetectionResult | null,
  settings?: DetectorSettings,
  activeFrequencies?: number[]
): ClassificationResult {
  // Get base classification (with active frequencies for mode clustering)
  const baseResult = classifyTrack(track, settings, activeFrequencies)
  
  // If no algorithm scores, return base result
  if (!algorithmScores || !fusionResult) {
    return baseResult
  }
  
  const reasons = [...baseResult.reasons]
  let pFeedback = baseResult.pFeedback
  let pWhistle = baseResult.pWhistle
  let pInstrument = baseResult.pInstrument

  // Extract frequency for chromatic quantization detection
  const trackFreqHz = 'trueFrequencyHz' in track ? track.trueFrequencyHz : track.frequency

  // ==================== Fusion Result (algorithm evidence counted once) ====================
  //
  // Fusion owns the algorithm-level scoring (MSD, phase, spectral, comb,
  // IHR, PTMR). Classifier adds only track/acoustic context.
  // Per-algorithm scores are NOT re-added here to avoid double-counting.

  // Blend track-level base score toward fusion's algorithm-level score.
  const FUSION_BLEND = 0.6
  pFeedback = pFeedback * (1 - FUSION_BLEND) + fusionResult.feedbackProbability * FUSION_BLEND
  reasons.push(`Fusion: ${(fusionResult.feedbackProbability * 100).toFixed(0)}% (${fusionResult.contributingAlgorithms.join('+')})`)

  // Chromatic quantization gate (classifier-only context, not in fusion)
  if (algorithmScores.phase && algorithmScores.phase.isFeedbackLikely) {
    const chromaticGated =
      algorithmScores.phase.coherence > CHROMATIC_PHASE_THRESHOLD &&
      isChromaticallyQuantized(trackFreqHz)
    if (chromaticGated) {
      pFeedback *= (settings?.chromaticGateOverride ?? CHROMATIC_PHASE_REDUCTION)
      reasons.push(`Chromatic quantization gate: phase reduced`)
    }
  }

  // Compression context (classifier-only)
  if (algorithmScores.compression && algorithmScores.compression.isCompressed) {
    reasons.push(`Compressed audio (crest: ${algorithmScores.compression.crestFactor.toFixed(1)}dB)`)
  }

  // ==================== Mains Hum Gate ====================
  // AC mains hum creates exact harmonic series at 50n or 60n Hz with high
  // phase coherence (AC-locked). When the current peak sits on a mains
  // harmonic AND 2+ other active peaks corroborate the same series,
  // reduce feedback probability. Auto-detects 50 vs 60 Hz.
  // Mains hum gate — respects settings.mainsHumEnabled (default true) and
  // settings.mainsHumFundamental ('auto' | 50 | 60)
  const humEnabled = settings?.mainsHumEnabled ?? true
  if (humEnabled && activeFrequencies && algorithmScores.phase) {
    const hum = detectMainsHum(
      trackFreqHz,
      activeFrequencies,
      algorithmScores.phase.coherence,
      settings?.mainsHumFundamental ?? 'auto'
    )
    if (hum.isHum) {
      pFeedback *= (settings?.mainsHumGateOverride ?? MAINS_HUM_GATE.GATE_MULTIPLIER)
      reasons.push(`Mains hum gate: ${hum.matchCount} peaks match ${hum.fundamental}Hz series`)
    }
  }

  // ==================== Renormalize ====================

  pFeedback = Math.max(0, Math.min(1, pFeedback))
  pWhistle = Math.max(0, Math.min(1, pWhistle))
  pInstrument = Math.max(0, Math.min(1, pInstrument))

  const total = pFeedback + pWhistle + pInstrument
  if (total > 0) {
    pFeedback /= total
    pWhistle /= total
    pInstrument /= total
  }

  const definitiveFeedback = fusionResult.verdict === 'FEEDBACK'
  const probableFeedback = fusionResult.verdict === 'POSSIBLE_FEEDBACK'
  const rejectedFeedback = fusionResult.verdict === 'NOT_FEEDBACK'
  const uncertainFeedback = fusionResult.verdict === 'UNCERTAIN'
  const preserveUrgentFeedback = definitiveFeedback
  const feedbackWinsPosterior = pFeedback >= pWhistle && pFeedback >= pInstrument
  const compressedSourceGateActive =
    algorithmScores.compression?.isCompressed === true &&
    fusionResult.verdict !== 'FEEDBACK' &&
    fusionResult.reasons.some((reason) =>
      reason === 'Compressed tonal-source gate: phase-dominant sustained source' ||
      reason === 'Compressed voiced-source gate: phase-stable voiced source'
    )
  const urgentFeedbackDominance =
    baseResult.severity === 'GROWING' &&
    !compressedSourceGateActive &&
    !(baseResult.speechLikePattern ?? false) &&
    feedbackWinsPosterior &&
    pFeedback >= 0.55 &&
    pFeedback >= pWhistle + 0.12 &&
    pFeedback >= pInstrument + 0.12
  const hardRejectedFeedback = rejectedFeedback

  // Re-apply severity overrides AFTER normalization only when fusion still
  // considers feedback plausible. A negative verdict must be able to demote
  // urgent base heuristics instead of getting overwritten here.
  if (baseResult.severity === 'RUNAWAY' && preserveUrgentFeedback) {
    pFeedback = Math.max(pFeedback, 0.85)
  } else if (baseResult.severity === 'GROWING' && preserveUrgentFeedback) {
    pFeedback = Math.max(pFeedback, 0.7)
  }

  // Renormalize after severity overrides to maintain valid distribution.
  // Matches the base classifyTrack() contract at lines 559-568.
  // Without this, the wrapper path returns class scores that don't sum
  // consistently with pUnknown, creating a score contract divergence.
  const postOverrideTotal = pFeedback + pWhistle + pInstrument
  if (postOverrideTotal > 1) {
    pFeedback /= postOverrideTotal
    pWhistle /= postOverrideTotal
    pInstrument /= postOverrideTotal
  }

  // pUnknown as residual mass — matches base path contract
  const pUnknown = Math.max(0, 1 - (pFeedback + pWhistle + pInstrument))
  
  // Determine updated label and severity
  let { label, severity } = baseResult

  const whistleWins =
    pWhistle >= CLASSIFIER_WEIGHTS.WHISTLE_THRESHOLD && pWhistle > pFeedback
  const instrumentWins =
    pInstrument >= CLASSIFIER_WEIGHTS.INSTRUMENT_THRESHOLD && pInstrument > pFeedback
  const preserveUrgencyOnConservativeFusion =
    !hardRejectedFeedback &&
    urgentFeedbackDominance &&
    (probableFeedback || uncertainFeedback)

  removeWhistlePolicyReasons(reasons)
  const whistleCandidate = baseResult.label === 'WHISTLE' || whistleWins
  const whistleFeedbackPromoted = shouldPromoteWhistleToFeedback(
    whistleCandidate,
    severity,
    fusionResult.verdict,
    pFeedback,
    pWhistle,
  )

  if (whistleFeedbackPromoted) {
    label = 'ACOUSTIC_FEEDBACK'
    severity = normalizePromotedWhistleSeverity(
      severity,
      definitiveFeedback,
      fusionResult.confidence,
    )
    pushReasonOnce(reasons, WHISTLE_FEEDBACK_PROMOTION_REASON)
  } else if (hardRejectedFeedback) {
    if (baseResult.label === 'WHISTLE' || whistleWins) {
      label = 'WHISTLE'
      severity = 'WHISTLE'
    } else if (baseResult.label === 'INSTRUMENT' || instrumentWins) {
      label = 'INSTRUMENT'
      severity = 'INSTRUMENT'
    } else {
      label = 'POSSIBLE_RING'
      severity = 'POSSIBLE_RING'
    }
  } else if (whistleWins) {
    label = 'WHISTLE'
    severity = 'WHISTLE'
    pushReasonOnce(reasons, WHISTLE_NON_CORRECTIVE_REASON)
  } else if (instrumentWins) {
    label = 'INSTRUMENT'
    severity = 'INSTRUMENT'
  } else if (pFeedback >= 0.6 && definitiveFeedback) {
    label = 'ACOUSTIC_FEEDBACK'
    if (severity !== 'RUNAWAY' && severity !== 'GROWING') {
      severity = fusionResult.confidence > 0.8 ? 'GROWING' : 'RESONANCE'
    }
  } else if (
    (probableFeedback || uncertainFeedback) &&
    (severity === 'RUNAWAY' || severity === 'GROWING') &&
    !preserveUrgencyOnConservativeFusion
  ) {
    // Borderline fusion verdicts can still keep the feedback label, but they
    // must fall back through the normal confidence gate instead of taking the
    // urgent RUNAWAY/GROWING bypass.
    severity = 'RESONANCE'
  }

  if (preserveUrgencyOnConservativeFusion) {
    reasons.push('Urgent growth retained despite conservative fusion verdict')
  }

  const labelProbability =
    label === 'WHISTLE'
      ? pWhistle
      : label === 'INSTRUMENT'
        ? pInstrument
        : label === 'ACOUSTIC_FEEDBACK'
          ? pFeedback
          : Math.max(pFeedback, pWhistle, pInstrument)
  const blendedConfidence = Math.max(
    labelProbability,
    (baseResult.confidence + fusionResult.confidence) / 2,
  )
  const confidence =
    hardRejectedFeedback && label === 'POSSIBLE_RING'
      ? Math.min(blendedConfidence, fusionResult.confidence)
      : blendedConfidence
  
  return {
    ...baseResult,
    pFeedback,
    pWhistle,
    pInstrument,
    pUnknown,
    label,
    severity,
    confidence,
    fusionVerdict: fusionResult.verdict,
    recommendationEligible: whistleFeedbackPromoted || !rejectedFeedback,
    reasons,
  }
}

/**
 * Get algorithm contribution summary for display
 */
export function getAlgorithmSummary(scores: AlgorithmScores): string[] {
  const summary: string[] = []
  
  if (scores.msd) {
    const status = scores.msd.isFeedbackLikely ? 'FEEDBACK' : 'OK'
    summary.push(`MSD: ${status} (${(scores.msd.feedbackScore * 100).toFixed(0)}%)`)
  }
  
  if (scores.phase) {
    const status = scores.phase.isFeedbackLikely ? 'LOCKED' : 'RANDOM'
    summary.push(`Phase: ${status} (${(scores.phase.coherence * 100).toFixed(0)}%)`)
  }
  
  if (scores.spectral) {
    const status = scores.spectral.isFeedbackLikely ? 'PURE' : 'BROAD'
    summary.push(`Spectral: ${status} (${scores.spectral.flatness.toFixed(2)})`)
  }
  
  if (scores.comb && scores.comb.hasPattern) {
    summary.push(`Comb: ${scores.comb.matchingPeaks} peaks @ ${scores.comb.fundamentalSpacing?.toFixed(0)}Hz`)
  }
  
  if (scores.ihr) {
    const status = scores.ihr.isFeedbackLike ? 'CLEAN' : scores.ihr.isMusicLike ? 'MUSIC' : 'OK'
    summary.push(`IHR: ${status} (${scores.ihr.interHarmonicRatio.toFixed(2)}, ${scores.ihr.harmonicsFound}h)`)
  }

  if (scores.ptmr) {
    const status = scores.ptmr.isFeedbackLike ? 'SHARP' : 'BROAD'
    summary.push(`PTMR: ${status} (${scores.ptmr.ptmrDb.toFixed(1)}dB)`)
  }

  if (scores.compression && scores.compression.isCompressed) {
    summary.push(`Compressed: ${scores.compression.estimatedRatio.toFixed(1)}:1`)
  }

  return summary
}
