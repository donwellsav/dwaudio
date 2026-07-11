/**
 * Classifier unit tests
 *
 * Tests classification logic that drives the advisory UX:
 * - shouldReportIssue: mode-specific filtering + confidence gates
 * - getSeverityText: display string mapping
 * - getSeverityUrgency: priority ordering for dedup
 * - classifyTrack: feature-weighted classification of Track objects
 */

import { describe, it, expect } from 'vitest'
import {
  classifyTrack,
  classifyTrackWithAlgorithms,
  getReportGateDecision,
  shouldPromoteWhistleToFeedback,
  shouldReportIssue,
  getSeverityText,
} from '../classifier'
import { getSeverityUrgency } from '../severityUtils'
import { calculateCalibratedConfidence } from '../acoustic/confidenceCalibration'
import { TrackManager } from '../trackManager'
import { DEFAULT_SETTINGS } from '../constants'
import type { ClassificationResult, SeverityLevel, Track, DetectorSettings, FusedDetectionResult } from '@/types/advisory'
import { buildScores } from '@/tests/helpers/mockAlgorithmScores'

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal Track fixture for classifyTrack. All numeric features at neutral values. */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track-1',
    binIndex: 170,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    prominenceDb: 15,
    onsetTime: Date.now() - 2000,
    onsetDb: -25,
    lastUpdateTime: Date.now(),
    history: [],
    features: {
      stabilityCentsStd: 5,       // Low = very stable (feedback-like)
      meanQ: 30,
      minQ: 20,
      meanVelocityDbPerSec: 1,
      maxVelocityDbPerSec: 3,
      persistenceMs: 1000,
      harmonicityScore: 0.2,      // Low = no harmonics (feedback-like)
      modulationScore: 0.1,       // Low = no vibrato (feedback-like)
      noiseSidebandScore: 0.05,   // Low = clean sidebands (feedback-like)
    },
    qEstimate: 30,
    bandwidthHz: 33,
    velocityDbPerSec: 1,
    harmonicOfHz: null,
    isSubHarmonicRoot: false,
    isActive: true,
    ...overrides,
  } as Track
}

function makeVibratoHistory(
  baseFrequencyHz: number = 1000,
  rateHz: number = 6,
  depthCents: number = 45,
  samples: number = 20,
  stepMs: number = 50
): Track['history'] {
  return Array.from({ length: samples }, (_, index) => {
    const time = index * stepMs
    const centsOffset = Math.sin(2 * Math.PI * rateHz * (time / 1000)) * depthCents
    const freqHz = baseFrequencyHz * Math.pow(2, centsOffset / 1200)

    return {
      time,
      freqHz,
      ampDb: -20,
      prominenceDb: 10,
      qEstimate: 8,
    }
  })
}

function makeWhistleTrack(overrides: Partial<Track> = {}): Track {
  const featureOverrides = overrides.features ?? {}

  return makeTrack({
    binIndex: 20,
    trueFrequencyHz: 180,
    trueAmplitudeDb: -20,
    prominenceDb: 12,
    onsetDb: -20,
    history: makeVibratoHistory(180, 6, 70),
    qEstimate: 2,
    bandwidthHz: 160,
    velocityDbPerSec: 0,
    features: {
      stabilityCentsStd: 120,
      meanQ: 2,
      minQ: 1,
      meanVelocityDbPerSec: 0,
      maxVelocityDbPerSec: 0,
      persistenceMs: 900,
      harmonicityScore: 0.05,
      modulationScore: 0.74,
      noiseSidebandScore: 1,
      ...featureOverrides,
    },
    ...overrides,
  })
}

/** Minimal ClassificationResult fixture for shouldReportIssue */
function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    pFeedback: 0.7,
    pWhistle: 0.1,
    pInstrument: 0.1,
    pUnknown: 0.1,
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'RESONANCE',
    confidence: 0.8,
    fusionVerdict: 'FEEDBACK',
    recommendationEligible: true,
    reasons: ['test'],
    ...overrides,
  } as ClassificationResult
}

function makeSettings(overrides: Partial<DetectorSettings> = {}): DetectorSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

// ── getSeverityText ─────────────────────────────────────────────────────────

describe('getSeverityText', () => {
  it.each<[SeverityLevel, string]>([
    ['RUNAWAY', 'RUNAWAY'],
    ['GROWING', 'Growing'],
    ['RESONANCE', 'Resonance'],
    ['POSSIBLE_RING', 'Ring'],
    ['WHISTLE', 'Whistle'],
    ['INSTRUMENT', 'Instrument'],
  ])('maps %s → "%s"', (severity, expected) => {
    expect(getSeverityText(severity)).toBe(expected)
  })
})

// ── getSeverityUrgency ──────────────────────────────────────────────────────

describe('getSeverityUrgency', () => {
  it('RUNAWAY is the most urgent (5)', () => {
    expect(getSeverityUrgency('RUNAWAY')).toBe(5)
  })

  it('maintains strict ordering: RUNAWAY > GROWING > RESONANCE > POSSIBLE_RING', () => {
    expect(getSeverityUrgency('RUNAWAY')).toBeGreaterThan(getSeverityUrgency('GROWING'))
    expect(getSeverityUrgency('GROWING')).toBeGreaterThan(getSeverityUrgency('RESONANCE'))
    expect(getSeverityUrgency('RESONANCE')).toBeGreaterThan(getSeverityUrgency('POSSIBLE_RING'))
  })

  it('WHISTLE and INSTRUMENT are equal priority (1)', () => {
    expect(getSeverityUrgency('WHISTLE')).toBe(getSeverityUrgency('INSTRUMENT'))
    expect(getSeverityUrgency('WHISTLE')).toBe(1)
  })
})

// ── shouldReportIssue ───────────────────────────────────────────────────────

describe('shouldReportIssue', () => {
  it('explains the report gate that is blocking a visible issue', () => {
    const classification = makeClassification({
      fusionVerdict: 'UNCERTAIN',
      confidence: 0.95,
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
    })

    expect(getReportGateDecision(classification, makeSettings())).toMatchObject({
      shouldReport: false,
      gate: 'fusion-uncertain',
    })
  })

  it('always reports RUNAWAY regardless of confidence or mode', () => {
    const classification = makeClassification({
      severity: 'RUNAWAY',
      confidence: 0.01, // Very low confidence
      label: 'ACOUSTIC_FEEDBACK',
    })
    // Should report in every mode
    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(true)
    expect(shouldReportIssue(classification, makeSettings({ mode: 'liveMusic' }))).toBe(true)
  })

  it('suppresses steady chromatic pure tones even when severity is over-promoted', () => {
    const classification = makeClassification({
      severity: 'RUNAWAY',
      fusionVerdict: 'FEEDBACK',
      confidence: 0.95,
      label: 'ACOUSTIC_FEEDBACK',
      frequencyHz: 440,
      cumulativeGrowthDb: 0,
      persistenceMs: 240,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(false)
  })

  it('keeps early possible rings reportable in liveMusic once they clear the main confidence gate', () => {
    const classification = makeClassification({
      label: 'POSSIBLE_RING',
      severity: 'POSSIBLE_RING',
      confidence: 0.58,
    })

    expect(shouldReportIssue(classification, makeSettings({
      mode: 'liveMusic',
      confidenceThreshold: 0.55,
    }))).toBe(true)
  })

  it('suppresses liveMusic possible feedback when instrument posterior is still material', () => {
    const classification = makeClassification({
      fusionVerdict: 'POSSIBLE_FEEDBACK',
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
      pFeedback: 0.46,
      pInstrument: 0.34,
      confidence: 0.82,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'liveMusic' }))).toBe(false)
  })

  it('keeps established GROWING feedback reportable regardless of confidence', () => {
    const classification = makeClassification({
      severity: 'GROWING',
      confidence: 0.1,
      label: 'ACOUSTIC_FEEDBACK',
      persistenceMs: 120,
    })
    expect(shouldReportIssue(classification, makeSettings())).toBe(true)
  })

  it('suppresses first-frame GROWING recommendations until conservative fusion has persistence', () => {
    for (const fusionVerdict of ['UNCERTAIN', 'POSSIBLE_FEEDBACK'] as const) {
      const classification = makeClassification({
        severity: 'GROWING',
        fusionVerdict,
        confidence: 0.95,
        label: 'ACOUSTIC_FEEDBACK',
        persistenceMs: 20,
      })

      expect(shouldReportIssue(classification, makeSettings())).toBe(false)
    }
  })

  it('suppresses speech-like growing advisories in speech mode unless fusion is definitive', () => {
    const classification = makeClassification({
      severity: 'GROWING',
      fusionVerdict: 'POSSIBLE_FEEDBACK',
      speechLikePattern: true,
      confidence: 0.95,
      persistenceMs: 120,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(false)
    expect(shouldReportIssue(classification, makeSettings({ mode: 'liveMusic' }))).toBe(true)
    expect(shouldReportIssue(
      { ...classification, fusionVerdict: 'FEEDBACK' },
      makeSettings({ mode: 'speech' }),
    )).toBe(true)
  })

  it('rejects low-confidence results below threshold', () => {
    const classification = makeClassification({
      severity: 'RESONANCE',
      confidence: 0.2, // Below default threshold of 0.35
    })
    expect(shouldReportIssue(classification, makeSettings())).toBe(false)
  })

  it('rejects recommendation-ineligible results before urgency or confidence gates', () => {
    const classification = makeClassification({
      severity: 'RUNAWAY',
      confidence: 0.99,
      recommendationEligible: false,
      fusionVerdict: 'NOT_FEEDBACK',
    })

    expect(shouldReportIssue(classification, makeSettings())).toBe(false)
  })

  it('suppresses UNCERTAIN fusion verdicts before confidence gating', () => {
    const classification = makeClassification({
      fusionVerdict: 'UNCERTAIN',
      confidence: 0.95,
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
    })

    expect(shouldReportIssue(classification, makeSettings())).toBe(false)
  })

  it('suppresses NOT_FEEDBACK fusion verdicts even when older posterior math is confident', () => {
    const classification = makeClassification({
      fusionVerdict: 'NOT_FEEDBACK',
      recommendationEligible: true,
      confidence: 0.95,
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
      pFeedback: 0.72,
      pInstrument: 0.14,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(false)
    expect(shouldReportIssue(classification, makeSettings({ mode: 'liveMusic' }))).toBe(false)
  })

  it('suppresses speech-mode borderline possible feedback when instrument posterior stays materially high', () => {
    const classification = makeClassification({
      fusionVerdict: 'POSSIBLE_FEEDBACK',
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
      pFeedback: 0.36,
      pInstrument: 0.36,
      confidence: 0.8,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(false)
  })

  it('keeps speech-mode borderline possible feedback reportable when feedback still edges out instrument mass', () => {
    const classification = makeClassification({
      fusionVerdict: 'POSSIBLE_FEEDBACK',
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
      pFeedback: 0.38,
      pInstrument: 0.33,
      confidence: 0.8,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(true)
  })

  it('keeps speech-mode possible feedback reportable when feedback still clearly dominates', () => {
    const classification = makeClassification({
      fusionVerdict: 'POSSIBLE_FEEDBACK',
      label: 'ACOUSTIC_FEEDBACK',
      severity: 'RESONANCE',
      pFeedback: 0.6,
      pInstrument: 0.18,
      confidence: 0.8,
    })

    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(true)
  })

  it('filters WHISTLE when ignoreWhistle is true', () => {
    const classification = makeClassification({
      label: 'WHISTLE',
      severity: 'WHISTLE',
      confidence: 0.9,
    })
    expect(shouldReportIssue(classification, makeSettings({ ignoreWhistle: true }))).toBe(false)
  })

  it('reports WHISTLE when ignoreWhistle is false', () => {
    const classification = makeClassification({
      label: 'WHISTLE',
      severity: 'WHISTLE',
      confidence: 0.9,
    })
    expect(shouldReportIssue(classification, makeSettings({ ignoreWhistle: false }))).toBe(true)
  })

  it('speech mode suppresses INSTRUMENT labels', () => {
    const classification = makeClassification({
      label: 'INSTRUMENT',
      severity: 'INSTRUMENT',
      confidence: 0.9,
    })
    expect(shouldReportIssue(classification, makeSettings({ mode: 'speech' }))).toBe(false)
  })

  it('monitors mode reports everything including INSTRUMENT', () => {
    const classification = makeClassification({
      label: 'INSTRUMENT',
      severity: 'INSTRUMENT',
      confidence: 0.9,
    })
    expect(shouldReportIssue(classification, makeSettings({ mode: 'monitors' }))).toBe(true)
  })

  it('liveMusic mode lets POSSIBLE_RING through once it clears the main confidence gate', () => {
    // Below the main confidence gate → rejected
    expect(shouldReportIssue(
      makeClassification({ label: 'POSSIBLE_RING', severity: 'POSSIBLE_RING', confidence: 0.5 }),
      makeSettings({ mode: 'liveMusic', confidenceThreshold: 0.55 }),
    )).toBe(false)

    // Above the main confidence gate → accepted
    expect(shouldReportIssue(
      makeClassification({ label: 'POSSIBLE_RING', severity: 'POSSIBLE_RING', confidence: 0.58 }),
      makeSettings({ mode: 'liveMusic', confidenceThreshold: 0.55 }),
    )).toBe(true)
  })
})

// ── classifyTrack ───────────────────────────────────────────────────────────

describe('classifyTrack', () => {
  it('does not classify a rapidly decaying track as growth', () => {
    const manager = new TrackManager()
    const peak = {
      binIndex: 170,
      trueFrequencyHz: 1000,
      trueAmplitudeDb: -20,
      prominenceDb: 15,
      sustainedMs: 200,
      harmonicOfHz: null,
      noiseFloorDb: -80,
      effectiveThresholdDb: -40,
      qEstimate: 30,
      bandwidthHz: 33,
      timestamp: 1000,
    }

    manager.processPeak(peak)
    manager.processPeak({ ...peak, trueAmplitudeDb: -23, timestamp: 1100 })
    manager.processPeak({ ...peak, trueAmplitudeDb: -26, timestamp: 1200 })
    const track = manager.processPeak({ ...peak, trueAmplitudeDb: -29, timestamp: 1300 })
    const result = classifyTrack(track)

    expect(result.severity).not.toBe('GROWING')
    expect(result.severity).not.toBe('RUNAWAY')
    expect(result.reasons.some((reason) => reason.startsWith('Rapid growth:'))).toBe(false)
  })

  it('classifies a stable, non-harmonic, non-modulated track as feedback', () => {
    const track = makeTrack({
      features: {
        stabilityCentsStd: 3,       // Very stable
        harmonicityScore: 0.1,      // No harmonics
        modulationScore: 0.05,      // No vibrato
        noiseSidebandScore: 0.02,   // Clean
        meanQ: 40,
        minQ: 30,
        meanVelocityDbPerSec: 2,
        maxVelocityDbPerSec: 5,
        persistenceMs: 2000,
      },
      velocityDbPerSec: 2,
      prominenceDb: 20,
      qEstimate: 40,
    })

    const result = classifyTrack(track)
    expect(result.label).toBe('ACOUSTIC_FEEDBACK')
    expect(result.pFeedback).toBeGreaterThan(result.pInstrument)
    expect(result.pFeedback).toBeGreaterThan(result.pWhistle)
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('classifies a modulated, noise-sideband track as whistle', () => {
    const track = makeTrack({
      features: {
        stabilityCentsStd: 80,
        harmonicityScore: 0.02,
        modulationScore: 0.99,
        noiseSidebandScore: 0.98,
        meanQ: 5,
        minQ: 3,
        meanVelocityDbPerSec: 0,
        maxVelocityDbPerSec: 0.5,
        persistenceMs: 3000,
      },
      velocityDbPerSec: 0,
      prominenceDb: 4,
      qEstimate: 4,
    })

    const result = classifyTrack(track)
    expect(result.pWhistle).toBeGreaterThan(result.pFeedback)
  })

  it('uses history-based vibrato confirmation for ambiguous modulation tracks', () => {
    const track = makeTrack({
      trueFrequencyHz: 1000,
      history: makeVibratoHistory(),
      features: {
        stabilityCentsStd: 45,
        harmonicityScore: 0.02,
        modulationScore: 0.32,
        noiseSidebandScore: 0.1,
        meanQ: 6,
        minQ: 4,
        meanVelocityDbPerSec: 0.2,
        maxVelocityDbPerSec: 0.4,
        persistenceMs: 1800,
      },
      velocityDbPerSec: 0.2,
      prominenceDb: 5,
      qEstimate: 4,
    })

    const result = classifyTrack(track)

    expect(result.reasons.some((reason) => reason.includes('Vibrato confirmation'))).toBe(true)
    expect(result.pWhistle).toBeGreaterThan(result.pFeedback)
  })

  it('skips history-based vibrato confirmation when modulation is already decisive', () => {
    const track = makeTrack({
      trueFrequencyHz: 1000,
      history: makeVibratoHistory(),
      features: {
        stabilityCentsStd: 70,
        harmonicityScore: 0.02,
        modulationScore: 0.92,
        noiseSidebandScore: 0.5,
        meanQ: 6,
        minQ: 4,
        meanVelocityDbPerSec: 0.1,
        maxVelocityDbPerSec: 0.2,
        persistenceMs: 2000,
      },
      velocityDbPerSec: 0.1,
      prominenceDb: 4,
      qEstimate: 4,
    })

    const result = classifyTrack(track)

    expect(result.reasons.some((reason) => reason.includes('Vibrato confirmation'))).toBe(false)
    expect(result.pWhistle).toBeGreaterThan(result.pFeedback)
  })

  it('classifies a harmonic-rich track as instrument', () => {
    const track = makeTrack({
      features: {
        stabilityCentsStd: 60,      // Very unstable pitch (not feedback-like)
        harmonicityScore: 0.95,     // Very rich harmonics (instrument-like)
        modulationScore: 0.3,       // Moderate modulation
        noiseSidebandScore: 0.15,   // Some noise
        meanQ: 5,                   // Very broad peak (not feedback-like)
        minQ: 3,                    // Very broad min Q
        meanVelocityDbPerSec: 0,    // No growth
        maxVelocityDbPerSec: 0.5,   // No growth
        persistenceMs: 200,         // Short-lived (not sustained feedback)
      },
      velocityDbPerSec: 0,
      prominenceDb: 6,    // Low prominence
      qEstimate: 5,       // Broad peak
    })

    const result = classifyTrack(track)
    expect(result.pInstrument).toBeGreaterThan(result.pFeedback)
  })

  it('classifies fast-growing track as RUNAWAY severity', () => {
    const track = makeTrack({
      velocityDbPerSec: 15, // Very fast growth
      features: {
        stabilityCentsStd: 3,
        harmonicityScore: 0.1,
        modulationScore: 0.05,
        noiseSidebandScore: 0.02,
        meanQ: 40,
        minQ: 30,
        meanVelocityDbPerSec: 12,
        maxVelocityDbPerSec: 15,
        persistenceMs: 500,
      },
    })

    const result = classifyTrack(track)
    expect(result.severity).toBe('RUNAWAY')
  })

  it('holds speech-like building peaks at resonance instead of escalating to growing', () => {
    const track = makeTrack({
      trueFrequencyHz: 850,
      trueAmplitudeDb: -20,
      onsetDb: -25,
      prominenceDb: 15,
      features: {
        stabilityCentsStd: 5,
        harmonicityScore: 0.18,
        modulationScore: 0.08,
        noiseSidebandScore: 0.04,
        meanQ: 8,
        minQ: 8,
        meanVelocityDbPerSec: 0.3,
        maxVelocityDbPerSec: 0.5,
        persistenceMs: 1200,
      },
      velocityDbPerSec: 0.3,
      qEstimate: 8,
      bandwidthHz: 80,
    })

    const result = classifyTrack(
      track,
      makeSettings({ mode: 'speech' }),
      [550, 850, 2400],
    )

    expect(result.speechLikePattern).toBe(true)
    expect(result.severity).toBe('RESONANCE')
    expect(result.reasons).toContain('Early warning held at resonance: speech-like formant pattern')
    expect(result.reasons.some((reason) => reason.includes('Formant gate'))).toBe(true)
  })

  it('keeps building feedback active without room suppression', () => {
    const track = makeTrack({
      trueFrequencyHz: 90,
      trueAmplitudeDb: -18,
      onsetDb: -22,
      prominenceDb: 12,
      features: {
        stabilityCentsStd: 4,
        harmonicityScore: 0.22,
        modulationScore: 0.05,
        noiseSidebandScore: 0.03,
        meanQ: 9,
        minQ: 9,
        meanVelocityDbPerSec: 0.4,
        maxVelocityDbPerSec: 0.7,
        persistenceMs: 1500,
      },
      velocityDbPerSec: 0.4,
      qEstimate: 9,
      bandwidthHz: 10,
    })

    const result = classifyTrack(track, makeSettings({ mode: 'speech' }), [82, 90, 99])

    expect(result.severity).toBe('GROWING')
    expect(result.reasons).toContain('Early warning: slow buildup detected')
    expect(result.reasons.some((reason) => /room|schroeder/i.test(reason))).toBe(false)
  })

  it('three-class probabilities (pFeedback + pWhistle + pInstrument) sum to >= 1', () => {
    const track = makeTrack()
    const result = classifyTrack(track)

    // After normalization, probabilities sum to 1. Severity overrides
    // (RUNAWAY/GROWING) may then boost pFeedback above its normalized
    // value, so the sum can exceed 1. It should never be below 1.
    const classSum = result.pFeedback + result.pWhistle + result.pInstrument
    expect(classSum).toBeGreaterThanOrEqual(1 - 0.05)
  })

  it('pUnknown is residual probability mass (1 - class sum)', () => {
    const track = makeTrack()
    const result = classifyTrack(track)
    // F5: pUnknown = 1 - (pFeedback + pWhistle + pInstrument), NOT 1 - confidence
    const classSum = result.pFeedback + result.pWhistle + result.pInstrument
    expect(result.pUnknown).toBeCloseTo(Math.max(0, 1 - classSum), 5)
  })

  it('always returns reasons array', () => {
    const result = classifyTrack(makeTrack())
    expect(Array.isArray(result.reasons)).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('keeps a pure whistle candidate as WHISTLE with non-corrective copy', () => {
    const result = classifyTrack(makeWhistleTrack())

    expect(result.label).toBe('WHISTLE')
    expect(result.severity).toBe('WHISTLE')
    expect(result.reasons).toContain(
      'Whistle-like tone detected without enough feedback evidence for corrective action',
    )
  })
})

describe('whistle promotion policy', () => {
  it('promotes an urgent whistle candidate on RUNAWAY severity', () => {
    expect(
      shouldPromoteWhistleToFeedback(true, 'RUNAWAY', 'UNCERTAIN', 0.34, 0.72),
    ).toBe(true)
  })

  it('promotes a whistle candidate when fusion is definitive FEEDBACK', () => {
    const track = makeWhistleTrack()
    const settings = makeSettings()
    const scores = buildScores({ msd: 0.8, phase: 0.85, spectral: 0.8, ihr: 0.75, ptmr: 0.7 })
    const fusion = makeFusionResult(scores)
    fusion.feedbackProbability = 0.82
    fusion.confidence = 0.83
    fusion.verdict = 'FEEDBACK'

    const result = classifyTrackWithAlgorithms(track, scores, fusion, settings)

    expect(result.label).toBe('ACOUSTIC_FEEDBACK')
    expect(result.severity).toBe('GROWING')
    expect(result.reasons).toContain(
      'Whistle-shaped tone retained as feedback due to growth/fusion evidence',
    )
  })

  it('promotes a whistle candidate on narrow-margin POSSIBLE_FEEDBACK evidence', () => {
    // This branch is policy-level because the current normalized classifier
    // posteriors do not naturally hit this exact numeric combination.
    expect(
      shouldPromoteWhistleToFeedback(true, 'RESONANCE', 'POSSIBLE_FEEDBACK', 0.52, 0.58),
    ).toBe(true)
  })
})

// ── Mains Hum Gate (classifyTrackWithAlgorithms) ───────────────────────────

/**
 * Helper: build a minimal FusedDetectionResult for classifyTrackWithAlgorithms.
 * The mains hum gate only reads algorithmScores.phase, so the fusion result
 * fields are set to plausible defaults.
 */
function makeFusionResult(scores: ReturnType<typeof buildScores>): FusedDetectionResult {
  return {
    feedbackProbability: 0.8,
    confidence: 0.8,
    contributingAlgorithms: ['msd', 'phase'],
    algorithmScores: scores,
    verdict: 'FEEDBACK',
    reasons: [],
  }
}

describe('Mains hum gate', () => {
  // Feedback-like track at a mains harmonic frequency
  function mainsTrack(frequencyHz: number) {
    return makeTrack({
      trueFrequencyHz: frequencyHz,
      features: {
        stabilityCentsStd: 3,
        harmonicityScore: 0.1,
        modulationScore: 0.05,
        noiseSidebandScore: 0.02,
        meanQ: 40,
        minQ: 30,
        meanVelocityDbPerSec: 2,
        maxVelocityDbPerSec: 5,
        persistenceMs: 2000,
      },
      velocityDbPerSec: 2,
      prominenceDb: 20,
      qEstimate: 40,
    })
  }

  it('60 Hz series with 2+ corroborating peaks triggers gate', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    const activeFreqs = [120, 180, 240] // 60×2, 60×3, 60×4

    const result = classifyTrackWithAlgorithms(
      mainsTrack(120), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(true)
    expect(result.reasons.some(r => r.includes('60Hz series'))).toBe(true)
  })

  it('50 Hz series with 2+ corroborating peaks triggers gate', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    const activeFreqs = [100, 150, 200] // 50×2, 50×3, 50×4

    const result = classifyTrackWithAlgorithms(
      mainsTrack(100), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(true)
    expect(result.reasons.some(r => r.includes('50Hz series'))).toBe(true)
  })

  it('single mains peak without corroboration does NOT trigger', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    const activeFreqs = [120] // Only one peak on 60Hz series

    const result = classifyTrackWithAlgorithms(
      mainsTrack(120), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(false)
  })

  it('off-frequency peaks do NOT trigger gate', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    // Peaks close to but not within ±2Hz of 60Hz harmonics
    const activeFreqs = [123, 185, 247]

    const result = classifyTrackWithAlgorithms(
      mainsTrack(123), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(false)
  })

  it('low phase coherence does NOT trigger gate', () => {
    // Phase coherence below 0.70 threshold
    const scores = buildScores({ msd: 0.9, phase: 0.50, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    const activeFreqs = [120, 180, 240]

    const result = classifyTrackWithAlgorithms(
      mainsTrack(120), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(false)
  })

  it('auto-detects correct fundamental when both could match', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    // 300 Hz is both 50×6 and 60×5. Other peaks: 180 (60×3), 240 (60×4), 360 (60×6)
    // 60 Hz has 3 corroborating, 50 Hz has 0 corroborating → picks 60 Hz
    const activeFreqs = [180, 240, 300, 360]

    const result = classifyTrackWithAlgorithms(
      mainsTrack(300), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('60Hz series'))).toBe(true)
  })

  it('reduces pFeedback when gate fires', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)

    // Without mains corroboration
    const resultNoGate = classifyTrackWithAlgorithms(
      mainsTrack(120), scores, fusion, makeSettings(), [120]
    )

    // With mains corroboration
    const resultGate = classifyTrackWithAlgorithms(
      mainsTrack(120), scores, fusion, makeSettings(), [120, 180, 240]
    )

    expect(resultGate.pFeedback).toBeLessThan(resultNoGate.pFeedback)
  })

  it('tolerance allows ±2 Hz frequency matching', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.85, spectral: 0.8 })
    const fusion = makeFusionResult(scores)
    // 121.5 is within ±2Hz of 120 (60×2), 179 is within ±2Hz of 180 (60×3)
    const activeFreqs = [121.5, 179, 241]

    const result = classifyTrackWithAlgorithms(
      mainsTrack(121.5), scores, fusion, makeSettings(), activeFreqs
    )

    expect(result.reasons.some(r => r.includes('Mains hum gate'))).toBe(true)
  })
})

// ── Fusion-driven demotion ──────────────────────────────────────────────────

describe('fusion-driven demotion', () => {
  it('lets a NOT_FEEDBACK verdict demote a runaway base classification', () => {
    const track = makeTrack({
      velocityDbPerSec: 15,
      features: {
        stabilityCentsStd: 3,
        harmonicityScore: 0.1,
        modulationScore: 0.05,
        noiseSidebandScore: 0.02,
        meanQ: 40,
        minQ: 30,
        meanVelocityDbPerSec: 12,
        maxVelocityDbPerSec: 15,
        persistenceMs: 1200,
      },
    })
    const scores = buildScores({
      msd: 0.05,
      phase: 0.1,
      spectral: 0.1,
      comb: 0,
      ihr: 0.85,
      ptmr: 0.05,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.1,
      confidence: 0.3,
      contributingAlgorithms: ['msd', 'phase'],
      algorithmScores: scores,
      verdict: 'NOT_FEEDBACK',
      reasons: ['rejected by fusion'],
    }

    const result = classifyTrackWithAlgorithms(track, scores, fusion, makeSettings())

    expect(result.label).toBe('POSSIBLE_RING')
    expect(result.severity).toBe('POSSIBLE_RING')
    expect(result.fusionVerdict).toBe('NOT_FEEDBACK')
    expect(result.recommendationEligible).toBe(false)
    expect(result.confidence).toBeLessThan(0.4)
    expect(shouldReportIssue(result, makeSettings({ mode: 'speech' }))).toBe(false)
  })

  it('keeps feedback-led posterior quiet when fusion rejects the peak', () => {
    const track = makeTrack({
      velocityDbPerSec: 10,
      features: {
        stabilityCentsStd: 2,
        harmonicityScore: 0.08,
        modulationScore: 0.03,
        noiseSidebandScore: 0.02,
        meanQ: 38,
        minQ: 32,
        meanVelocityDbPerSec: 8,
        maxVelocityDbPerSec: 10,
        persistenceMs: 1600,
      },
    })
    const scores = buildScores({
      msd: 0.42,
      phase: 0.46,
      spectral: 0.4,
      comb: 0.15,
      ihr: 0.28,
      ptmr: 0.42,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.28,
      confidence: 0.62,
      contributingAlgorithms: ['msd', 'phase', 'ptmr'],
      algorithmScores: scores,
      verdict: 'NOT_FEEDBACK',
      reasons: ['borderline rejection'],
    }

    const result = classifyTrackWithAlgorithms(track, scores, fusion, makeSettings())

    expect(result.label).toBe('POSSIBLE_RING')
    expect(result.fusionVerdict).toBe('NOT_FEEDBACK')
    expect(result.recommendationEligible).toBe(false)
    expect(shouldReportIssue(result, makeSettings({ mode: 'speech', confidenceThreshold: 0.4 }))).toBe(false)
  })

  it('removes the urgent bypass when fusion is uncertain about a growing peak', () => {
    const track = makeTrack({
      velocityDbPerSec: 8,
      features: {
        stabilityCentsStd: 4,
        harmonicityScore: 0.15,
        modulationScore: 0.08,
        noiseSidebandScore: 0.05,
        meanQ: 25,
        minQ: 18,
        meanVelocityDbPerSec: 6,
        maxVelocityDbPerSec: 8,
        persistenceMs: 900,
      },
    })
    const scores = buildScores({
      msd: 0.3,
      phase: 0.35,
      spectral: 0.25,
      comb: 0,
      ihr: 0.4,
      ptmr: 0.35,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.35,
      confidence: 0.35,
      contributingAlgorithms: ['msd', 'phase'],
      algorithmScores: scores,
      verdict: 'UNCERTAIN',
      reasons: ['mixed evidence'],
    }

    const settings = makeSettings({ confidenceThreshold: 0.8 })
    const result = classifyTrackWithAlgorithms(track, scores, fusion, settings)

    expect(result.label).toBe('ACOUSTIC_FEEDBACK')
    expect(result.severity).toBe('RESONANCE')
    expect(result.fusionVerdict).toBe('UNCERTAIN')
    expect(result.recommendationEligible).toBe(true)
    expect(result.confidence).toBeLessThan(0.8)
    expect(shouldReportIssue(result, settings)).toBe(false)
  })

  it('keeps urgent growing feedback reportable when the posterior still strongly favors feedback', () => {
    const track = makeTrack({
      velocityDbPerSec: 7,
      features: {
        stabilityCentsStd: 2,
        harmonicityScore: 0.08,
        modulationScore: 0.03,
        noiseSidebandScore: 0.02,
        meanQ: 34,
        minQ: 28,
        meanVelocityDbPerSec: 6,
        maxVelocityDbPerSec: 7,
        persistenceMs: 1400,
      },
    })
    const scores = buildScores({
      msd: 0.58,
      phase: 0.48,
      spectral: 0.42,
      comb: 0,
      ihr: 0.55,
      ptmr: 0.62,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.38,
      confidence: 0.28,
      contributingAlgorithms: ['msd', 'phase', 'ptmr'],
      algorithmScores: scores,
      verdict: 'UNCERTAIN',
      reasons: ['conservative mixed evidence'],
    }

    const settings = makeSettings({ confidenceThreshold: 0.8 })
    const result = classifyTrackWithAlgorithms(track, scores, fusion, settings)

    expect(result.label).toBe('ACOUSTIC_FEEDBACK')
    expect(result.severity).toBe('GROWING')
    expect(result.fusionVerdict).toBe('UNCERTAIN')
    expect(result.recommendationEligible).toBe(true)
    expect(result.reasons).toContain('Urgent growth retained despite conservative fusion verdict')
    expect(shouldReportIssue(result, settings)).toBe(true)
  })

  it('speech-like possible feedback stays suppressed in speech mode while liveMusic can still surface it', () => {
    const track = makeTrack({
      trueFrequencyHz: 850,
      trueAmplitudeDb: -20,
      onsetDb: -25,
      prominenceDb: 15,
      features: {
        stabilityCentsStd: 5,
        harmonicityScore: 0.18,
        modulationScore: 0.08,
        noiseSidebandScore: 0.04,
        meanQ: 8,
        minQ: 8,
        meanVelocityDbPerSec: 0.3,
        maxVelocityDbPerSec: 0.5,
        persistenceMs: 1200,
      },
      velocityDbPerSec: 0.3,
      qEstimate: 8,
      bandwidthHz: 80,
    })
    const scores = buildScores({
      msd: 0.88,
      phase: 0.82,
      spectral: 0.52,
      ihr: 0.2,
      ptmr: 0.58,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.62,
      confidence: 0.58,
      contributingAlgorithms: ['msd', 'phase', 'spectral'],
      algorithmScores: scores,
      verdict: 'POSSIBLE_FEEDBACK',
      reasons: ['borderline voiced source'],
    }

    const speechSettings = makeSettings({ mode: 'speech' })
    const liveMusicSettings = makeSettings({ mode: 'liveMusic' })
    const result = classifyTrackWithAlgorithms(track, scores, fusion, speechSettings, [550, 850, 2400])

    expect(result.speechLikePattern).toBe(true)
    expect(result.severity).toBe('RESONANCE')
    expect(shouldReportIssue(result, speechSettings)).toBe(false)
    expect(shouldReportIssue(result, liveMusicSettings)).toBe(true)
  })

  it('possible feedback is not suppressed by removed room-risk policy', () => {
    const track = makeTrack({
      trueFrequencyHz: 90,
      trueAmplitudeDb: -18,
      onsetDb: -22,
      prominenceDb: 12,
      features: {
        stabilityCentsStd: 4,
        harmonicityScore: 0.22,
        modulationScore: 0.05,
        noiseSidebandScore: 0.03,
        meanQ: 9,
        minQ: 9,
        meanVelocityDbPerSec: 0.4,
        maxVelocityDbPerSec: 0.7,
        persistenceMs: 1500,
      },
      velocityDbPerSec: 0.4,
      qEstimate: 9,
      bandwidthHz: 10,
    })
    const scores = buildScores({
      msd: 0.78,
      phase: 0.72,
      spectral: 0.48,
      ihr: 0.3,
      ptmr: 0.45,
      msdFrames: 20,
    })
    const fusion: FusedDetectionResult = {
      feedbackProbability: 0.49,
      confidence: 0.43,
      contributingAlgorithms: ['msd', 'phase'],
      algorithmScores: scores,
      verdict: 'POSSIBLE_FEEDBACK',
      reasons: ['borderline low-band evidence'],
    }

    const speechSettings = makeSettings({ mode: 'speech' })
    const monitorsSettings = makeSettings({ mode: 'monitors' })
    const result = classifyTrackWithAlgorithms(track, scores, fusion, speechSettings, [82, 90, 99])

    expect(result.reasons.some((reason) => /room|schroeder/i.test(reason))).toBe(false)
    expect(shouldReportIssue(result, speechSettings)).toBe(true)
    expect(shouldReportIssue(result, monitorsSettings)).toBe(true)
  })
})

describe('local-only classifier output', () => {
  function trackAtFreq(frequencyHz: number) {
    return makeTrack({
      trueFrequencyHz: frequencyHz,
      features: {
        stabilityCentsStd: 5,
        harmonicityScore: 0.2,
        modulationScore: 0.1,
        noiseSidebandScore: 0.05,
        meanQ: 30,
        minQ: 20,
        meanVelocityDbPerSec: 0.3,
        maxVelocityDbPerSec: 0.5,
        persistenceMs: 1000,
      },
      velocityDbPerSec: 0.3,
      prominenceDb: 15,
      qEstimate: 30,
    })
  }

  it('does not add room or Schroeder reasons', () => {
    const result = classifyTrack(trackAtFreq(50))

    expect(result.reasons.some(r => /room|schroeder/i.test(r))).toBe(false)
  })
})

// ── F5: Posterior consistency ─────────────────────────────────────────────────

describe('classifyTrack posterior consistency (F5)', () => {
  it('pFeedback + pWhistle + pInstrument + pUnknown sums to ~1', () => {
    const result = classifyTrack(makeTrack())
    const sum = result.pFeedback + result.pWhistle + result.pInstrument + result.pUnknown
    expect(sum).toBeGreaterThanOrEqual(0.99)
    expect(sum).toBeLessThanOrEqual(1.01)
  })

  it('all class probabilities are non-negative', () => {
    const result = classifyTrack(makeTrack())
    expect(result.pFeedback).toBeGreaterThanOrEqual(0)
    expect(result.pWhistle).toBeGreaterThanOrEqual(0)
    expect(result.pInstrument).toBeGreaterThanOrEqual(0)
    expect(result.pUnknown).toBeGreaterThanOrEqual(0)
  })

  it('confidence is monotonic with returned pFeedback for feedback-dominant tracks', () => {
    // A track with higher Q should have >= confidence
    const lowQ = makeTrack({ qEstimate: 5 })
    const highQ = makeTrack({ qEstimate: 50 })
    const lowResult = classifyTrack(lowQ)
    const highResult = classifyTrack(highQ)
    // Higher Q -> more feedback-like -> higher pFeedback -> higher confidence
    if (highResult.pFeedback > lowResult.pFeedback) {
      expect(highResult.confidence).toBeGreaterThanOrEqual(lowResult.confidence)
    }
  })

  it('adjustedPFeedback from calibration is reflected in returned posterior', () => {
    // A track with strong feedback features should have boosted pFeedback
    // because calculateCalibratedConfidence adjusts it
    const track = makeTrack({ prominenceDb: 25, qEstimate: 40 })
    const result = classifyTrack(track)
    // The returned pFeedback should be > 0 (not the discarded pre-adjustment value)
    expect(result.pFeedback).toBeGreaterThan(0)
    // And confidence should be consistent with the returned class probs
    expect(result.confidence).toBeGreaterThanOrEqual(
      Math.max(result.pFeedback, result.pWhistle, result.pInstrument) - 0.01
    )
  })

  it('calibration confidence follows the adjusted feedback posterior', () => {
    const result = calculateCalibratedConfidence(0.4, 0.2, 0.1, 0.15, 'NONE')

    expect(result.adjustedPFeedback).toBeCloseTo(0.55, 6)
    expect(result.confidence).toBeCloseTo(0.55, 6)
  })
})

// ── Local-only output hygiene ────────────────────────────────────────────────

describe('room-model remnants stay absent', () => {
  it('does not apply room-delta clamps', () => {
    const track = makeTrack({
      trueFrequencyHz: 80,
      trueAmplitudeDb: -20,
      prominenceDb: 15,
      features: {
        stabilityCentsStd: 5,
        meanQ: 5,
        minQ: 5,
        meanVelocityDbPerSec: 1,
        maxVelocityDbPerSec: 3,
        persistenceMs: 1000,
        harmonicityScore: 0.2,
        modulationScore: 0.1,
        noiseSidebandScore: 0.05,
      },
      qEstimate: 5,
      bandwidthHz: 16,
    })

    const result = classifyTrack(track, DEFAULT_SETTINGS)

    expect(result.reasons.some(r => /room|schroeder|clamp/i.test(r))).toBe(false)
  })

  it('keeps low-band tracks free of room clamp reasons', () => {
    const track = makeTrack({ trueFrequencyHz: 80 })
    const result = classifyTrack(track, DEFAULT_SETTINGS)
    expect(result.reasons.some(r => /room|schroeder|clamp/i.test(r))).toBe(false)
  })
})

// ── S9: classifyTrackWithAlgorithms wrapper posterior consistency ─────────────

describe('classifyTrackWithAlgorithms wrapper posterior (S9)', () => {
  it('posterior sums to ~1 after RUNAWAY severity override', () => {
    // Create a track with strong feedback features + high velocity for RUNAWAY
    const track = makeTrack({
      prominenceDb: 30,
      qEstimate: 60,
      features: {
        stabilityCentsStd: 2,
        meanQ: 60,
        minQ: 55,
        meanVelocityDbPerSec: 5,
        maxVelocityDbPerSec: 8,
        persistenceMs: 2000,
        harmonicityScore: 0.1,
        modulationScore: 0.05,
        noiseSidebandScore: 0.02,
      },
    })
    const scores = buildScores({ msd: 0.9, phase: 0.95, spectral: 0.85, comb: 0.8, ihr: 0.1, ptmr: 0.9 })
    const fusion = makeFusionResult(scores)
    fusion.feedbackProbability = 0.95
    fusion.confidence = 0.95

    const result = classifyTrackWithAlgorithms(track, scores, fusion)
    const sum = result.pFeedback + result.pWhistle + result.pInstrument + result.pUnknown
    expect(sum).toBeGreaterThanOrEqual(0.99)
    expect(sum).toBeLessThanOrEqual(1.01)
    expect(result.pUnknown).toBeGreaterThanOrEqual(0)
    expect(result.recommendationEligible).toBe(true)
  })

  it('posterior sums to ~1 after GROWING severity override', () => {
    const track = makeTrack({
      prominenceDb: 20,
      qEstimate: 40,
      features: {
        stabilityCentsStd: 3,
        meanQ: 40,
        minQ: 35,
        meanVelocityDbPerSec: 2.5,
        maxVelocityDbPerSec: 4,
        persistenceMs: 1500,
        harmonicityScore: 0.15,
        modulationScore: 0.08,
        noiseSidebandScore: 0.03,
      },
    })
    const scores = buildScores({ msd: 0.7, phase: 0.8, spectral: 0.7, comb: 0.6, ihr: 0.2, ptmr: 0.7 })
    const fusion = makeFusionResult(scores)
    fusion.feedbackProbability = 0.75
    fusion.confidence = 0.75

    const result = classifyTrackWithAlgorithms(track, scores, fusion)
    const sum = result.pFeedback + result.pWhistle + result.pInstrument + result.pUnknown
    expect(sum).toBeGreaterThanOrEqual(0.99)
    expect(sum).toBeLessThanOrEqual(1.01)
    expect(result.pUnknown).toBeGreaterThanOrEqual(0)
  })

  it('all class scores are non-negative in wrapper path', () => {
    const track = makeTrack({ prominenceDb: 15, qEstimate: 25 })
    const scores = buildScores({ msd: 0.5, phase: 0.5, spectral: 0.5, comb: 0.3, ihr: 0.3, ptmr: 0.5 })
    const fusion = makeFusionResult(scores)

    const result = classifyTrackWithAlgorithms(track, scores, fusion)
    expect(result.pFeedback).toBeGreaterThanOrEqual(0)
    expect(result.pWhistle).toBeGreaterThanOrEqual(0)
    expect(result.pInstrument).toBeGreaterThanOrEqual(0)
    expect(result.pUnknown).toBeGreaterThanOrEqual(0)
  })

  it('demotes POSSIBLE_FEEDBACK urgency back through the confidence gate', () => {
    const track = makeTrack({
      prominenceDb: 24,
      qEstimate: 48,
      features: {
        stabilityCentsStd: 2,
        meanQ: 48,
        minQ: 42,
        meanVelocityDbPerSec: 3,
        maxVelocityDbPerSec: 8,
        persistenceMs: 1800,
        harmonicityScore: 0.1,
        modulationScore: 0.04,
        noiseSidebandScore: 0.02,
      },
    })
    const scores = buildScores({ msd: 0.72, phase: 0.74, spectral: 0.7, comb: 0.62, ihr: 0.18, ptmr: 0.72 })
    const fusion = makeFusionResult(scores)
    fusion.feedbackProbability = 0.56
    fusion.confidence = 0.45
    fusion.verdict = 'POSSIBLE_FEEDBACK'

    const result = classifyTrackWithAlgorithms(track, scores, fusion)

    expect(result.label).toBe('ACOUSTIC_FEEDBACK')
    expect(result.severity).toBe('RESONANCE')
    expect(shouldReportIssue(result, makeSettings({ confidenceThreshold: 0.9 }))).toBe(false)
  })
})
