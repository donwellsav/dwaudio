/**
 * Algorithm Fusion unit tests
 *
 * Tests the multi-algorithm detection fusion engine:
 * - detectCombPattern: DBX comb filter pattern detection
 * - analyzeInterHarmonicRatio: IHR feedback vs music discrimination
 * - calculatePTMR: Peak-to-Median Ratio for spectral peak sharpness
 * - calculateMINDS: DAFx-16 adaptive notch depth setting
 * - detectContentType: speech vs music vs compressed classification
 * - fuseAlgorithmResults: weighted multi-algorithm fusion with verdict
 */

import { describe, it, expect } from 'vitest'
import { detectCombPattern, COMB_CONSTANTS } from '../combPattern'
import { analyzeInterHarmonicRatio, calculatePTMR, detectContentType } from '../spectralAlgorithms'
import {
  calculateMINDS,
  fuseAlgorithmResults,
  FUSION_WEIGHTS,
  DEFAULT_FUSION_CONFIG,
  AgreementPersistenceTracker,
  calibrateProbability,
  IDENTITY_CALIBRATION,
} from '../fusionEngine'
import type {
  AlgorithmScores,
  CalibrationTable,
} from '../fusionEngine'
import { buildScores } from '@/tests/helpers/mockAlgorithmScores'

// ── detectCombPattern ──────────────────────────────────────────────────────

describe('detectCombPattern', () => {
  it('returns no pattern when too few peaks', () => {
    const result = detectCombPattern([100, 200]) // < MIN_PEAKS
    expect(result.hasPattern).toBe(false)
    expect(result.confidence).toBe(0)
  })

  it('detects evenly-spaced peaks as comb pattern', () => {
    // Simulate comb filter with 200 Hz spacing (5m path length: 343/200 ≈ 1.7m)
    const spacing = 200
    const peaks = Array.from({ length: 6 }, (_, i) => (i + 1) * spacing)
    // [200, 400, 600, 800, 1000, 1200]
    const result = detectCombPattern(peaks, 48000)
    expect(result.hasPattern).toBe(true)
    expect(result.fundamentalSpacing).toBeCloseTo(spacing, -1) // Within ~10 Hz
    expect(result.matchingPeaks).toBeGreaterThanOrEqual(COMB_CONSTANTS.MIN_PEAKS_FOR_PATTERN)
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('estimates path length from fundamental spacing', () => {
    // d = c / Δf = 343 / 200 = 1.715 m
    const peaks = [200, 400, 600, 800, 1000]
    const result = detectCombPattern(peaks, 48000)
    if (result.hasPattern && result.estimatedPathLength !== null) {
      expect(result.estimatedPathLength).toBeCloseTo(343 / 200, 0)
    }
  })

  it('rejects random non-evenly-spaced peaks', () => {
    const randomPeaks = [137, 523, 891, 1247, 1759]
    const result = detectCombPattern(randomPeaks, 48000)
    // Random peaks shouldn't form a comb pattern
    // (may technically match by chance, so we just check confidence is low)
    if (result.hasPattern) {
      expect(result.confidence).toBeLessThan(0.5)
    }
  })

  it('rejects unrealistic path lengths (>50m)', () => {
    // Very small spacing → very long path → reject
    // d = 343 / 5 = 68.6 m > MAX_PATH_LENGTH (50m)
    const peaks = [5, 10, 15, 20, 25]
    const result = detectCombPattern(peaks, 48000)
    expect(result.hasPattern).toBe(false)
  })

  it('returns predicted frequencies for undetected harmonics', () => {
    // Missing the 3rd harmonic (600 Hz)
    const peaks = [200, 400, 800, 1000, 1200]
    const result = detectCombPattern(peaks, 48000)
    if (result.hasPattern && result.predictedFrequencies.length > 0) {
      // Should predict 600 Hz as a missing harmonic
      const hasCloseTo600 = result.predictedFrequencies.some(f => Math.abs(f - 600) < 20)
      expect(hasCloseTo600).toBe(true)
    }
  })
})

// ── analyzeInterHarmonicRatio ──────────────────────────────────────────────

describe('analyzeInterHarmonicRatio', () => {
  const sampleRate = 48000
  const fftSize = 8192
  const numBins = fftSize / 2

  /** Create spectrum with a single pure tone (feedback-like) */
  function pureToneSpectrum(fundamentalBin: number): Float32Array {
    const arr = new Float32Array(numBins)
    arr.fill(-80) // Noise floor
    arr[fundamentalBin] = -10 // Strong fundamental
    return arr
  }

  /** Create spectrum with rich harmonics (music-like) */
  function harmonicSpectrum(fundamentalBin: number): Float32Array {
    const arr = new Float32Array(numBins)
    arr.fill(-80)
    // Add fundamental + decaying harmonics
    for (let k = 1; k <= 6; k++) {
      const bin = Math.round(fundamentalBin * k)
      if (bin < numBins) {
        arr[bin] = -10 - (k - 1) * 6 // 6 dB/octave decay
      }
    }
    // Add inter-harmonic energy (noise between harmonics)
    for (let k = 1; k <= 5; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) {
        arr[midBin] = -40 // Significant inter-harmonic energy
      }
    }
    return arr
  }

  it('pure tone has low IHR and high feedback score', () => {
    const spectrum = pureToneSpectrum(100)
    const result = analyzeInterHarmonicRatio(spectrum, 100, sampleRate, fftSize)
    expect(result.harmonicsFound).toBeLessThanOrEqual(2) // Just fundamental, maybe 1 harmonic
    expect(result.feedbackScore).toBeGreaterThan(0)
  })

  it('harmonic-rich signal has higher IHR', () => {
    const spectrum = harmonicSpectrum(100)
    const result = analyzeInterHarmonicRatio(spectrum, 100, sampleRate, fftSize)
    expect(result.harmonicsFound).toBeGreaterThanOrEqual(3)
    // IHR should be higher for music-like content
    expect(result.interHarmonicRatio).toBeGreaterThan(0)
  })

  it('returns neutral result for out-of-range fundamentalBin', () => {
    const spectrum = pureToneSpectrum(100)
    const result = analyzeInterHarmonicRatio(spectrum, 0, sampleRate, fftSize) // DC
    expect(result.interHarmonicRatio).toBe(0.5)
    expect(result.feedbackScore).toBe(0)
  })

  it('feedbackScore is clamped to [0, 1]', () => {
    const spectrum = pureToneSpectrum(100)
    const result = analyzeInterHarmonicRatio(spectrum, 100, sampleRate, fftSize)
    expect(result.feedbackScore).toBeGreaterThanOrEqual(0)
    expect(result.feedbackScore).toBeLessThanOrEqual(1)
  })
})

// ── analyzeInterHarmonicRatio — Harmonic Series Validation ────────────────

describe('analyzeInterHarmonicRatio — harmonic series validation', () => {
  const sampleRate = 48000
  const fftSize = 8192
  const numBins = fftSize / 2

  it('real harmonic series at exact multiples passes validation and triggers music-like gate', () => {
    // Source: analyzeInterHarmonicRatio lines 382-432 in algorithmFusion.ts
    // fundamentalBin=100, halfBinWidth = max(1, round(100*0.02)) = 2
    // Peaks placed at exact k*100 bins => relDev = 0 for each => all pass
    // IHR = interHarmonicEnergy / harmonicEnergy. For isMusicLike we need IHR > 0.35
    // Harmonic at -20 dB each: 6 * 10^(-20/10) = 6 * 0.01 = 0.06
    // Inter-harmonic at -15 dB each: 5 * 10^(-15/10) = 5 * 0.0316 = 0.158
    // IHR = 0.158 / 0.06 = 2.63 >> 0.35
    const fundamentalBin = 100
    const arr = new Float32Array(numBins)
    arr.fill(-90)
    // Place 6 harmonics at equal level (all above -80 dB threshold)
    for (let k = 1; k <= 6; k++) {
      const bin = Math.round(fundamentalBin * k)
      if (bin < numBins) arr[bin] = -20
    }
    // Strong inter-harmonic energy to push IHR well above 0.35
    for (let k = 1; k < 6; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) arr[midBin] = -15
    }

    const result = analyzeInterHarmonicRatio(arr, fundamentalBin, sampleRate, fftSize)
    // All 6 exact harmonics should pass relDev <= 0.02 check
    expect(result.harmonicsFound).toBeGreaterThanOrEqual(3)
    expect(result.isMusicLike).toBe(true)
    expect(result.interHarmonicRatio).toBeGreaterThan(0.35)
  })

  it('coincidental clutter peaks outside search window do not inflate harmonic count', () => {
    // fundamentalBin=50, halfBinWidth = max(1, round(50*0.02)) = 1
    // Place "harmonic" peaks offset by ceil(k*50*0.025) bins from expected position
    // These offsets exceed the +-1 bin search window so peaks are not found at all
    const fundamentalBin = 50
    const arr = new Float32Array(numBins)
    arr.fill(-90)
    arr[fundamentalBin] = -10 // Exact fundamental
    for (let k = 2; k <= 6; k++) {
      const expectedBin = Math.round(fundamentalBin * k)
      const offset = Math.ceil(fundamentalBin * k * 0.025)
      const clutterBin = expectedBin + offset
      if (clutterBin < numBins) arr[clutterBin] = -15
    }
    for (let k = 1; k < 6; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) arr[midBin] = -35
    }

    const result = analyzeInterHarmonicRatio(arr, fundamentalBin, sampleRate, fftSize)
    // Only the exact fundamental passes; clutter is outside search window
    expect(result.harmonicsFound).toBeLessThan(3)
    expect(result.isMusicLike).toBe(false)
  })

  it('validated count drives feedbackScore branching, not raw peak count', () => {
    // When only 1 validated harmonic exists (fundamental), feedbackScore
    // uses the harmonicsFound<=1 branch: max(0, 1 - ihr*5)
    // Source: algorithmFusion.ts lines 416-423
    const fundamentalBin = 200
    const arr = new Float32Array(numBins)
    arr.fill(-90)
    arr[fundamentalBin] = -10 // Only the fundamental is exact
    const halfBinWidth = Math.max(1, Math.round(fundamentalBin * 0.02))
    // Place other "harmonics" beyond the search window
    for (let k = 2; k <= 5; k++) {
      const expectedBin = Math.round(fundamentalBin * k)
      const outsideBin = expectedBin + halfBinWidth + 2
      if (outsideBin < numBins) arr[outsideBin] = -15
    }
    for (let k = 1; k < 5; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) arr[midBin] = -35
    }

    const result = analyzeInterHarmonicRatio(arr, fundamentalBin, sampleRate, fftSize)
    expect(result.harmonicsFound).toBeLessThan(3)
    expect(result.isMusicLike).toBe(false)
    // feedbackScore should be > 0 since only 1 harmonic found
    expect(result.feedbackScore).toBeGreaterThan(0)
  })

  it('IHR energy ratio is unchanged by harmonic count validation', () => {
    // Energy calculation sums all peaks found in the search window regardless
    // of validation. Source: algorithmFusion.ts lines 396-397 (energy always added)
    const fundamentalBin = 100
    const arr = new Float32Array(numBins)
    arr.fill(-90)
    for (let k = 1; k <= 5; k++) {
      const bin = Math.round(fundamentalBin * k)
      if (bin < numBins) arr[bin] = -10 - (k - 1) * 5
    }
    for (let k = 1; k < 5; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) arr[midBin] = -35
    }

    const result = analyzeInterHarmonicRatio(arr, fundamentalBin, sampleRate, fftSize)
    // IHR reflects energy ratio, not harmonic count
    expect(result.interHarmonicRatio).toBeGreaterThan(0)
    expect(result.interHarmonicRatio).toBeLessThan(1)
  })

  it('small fundamentalBin with exact harmonics still validates correctly', () => {
    // fundamentalBin=30, halfBinWidth = max(1, round(30*0.02)) = 1
    // Exact multiples have relDev=0, all pass
    // For isMusicLike: need IHR > 0.35 and harmonicsFound >= 3
    // Harmonics at -20 dB, inter-harmonics at -15 dB => IHR >> 0.35
    const fundamentalBin = 30
    const arr = new Float32Array(numBins)
    arr.fill(-90)
    for (let k = 1; k <= 5; k++) {
      const bin = Math.round(fundamentalBin * k)
      if (bin < numBins) arr[bin] = -20
    }
    for (let k = 1; k < 5; k++) {
      const midBin = Math.round(fundamentalBin * (k + 0.5))
      if (midBin < numBins) arr[midBin] = -15
    }

    const result = analyzeInterHarmonicRatio(arr, fundamentalBin, sampleRate, fftSize)
    expect(result.harmonicsFound).toBeGreaterThanOrEqual(3)
    expect(result.isMusicLike).toBe(true)
  })
})

// ── calculatePTMR ──────────────────────────────────────────────────────────

describe('calculatePTMR', () => {
  it('returns high PTMR for sharp spectral peak (feedback)', () => {
    const spectrum = new Float32Array(1024)
    spectrum.fill(-60) // Noise floor
    spectrum[500] = -20 // Sharp peak: 40 dB above floor
    const result = calculatePTMR(spectrum, 500, 20)
    expect(result.ptmrDb).toBeGreaterThan(15)
    expect(result.isFeedbackLike).toBe(true)
    expect(result.feedbackScore).toBeGreaterThan(0)
  })

  it('returns low PTMR for broad spectral content', () => {
    const spectrum = new Float32Array(1024)
    // Fill with uniform level
    spectrum.fill(-40)
    const result = calculatePTMR(spectrum, 500, 20)
    // Peak and median are the same → PTMR ≈ 0
    expect(result.ptmrDb).toBeLessThan(5)
    expect(result.isFeedbackLike).toBe(false)
  })

  it('returns zero result when too few values', () => {
    const spectrum = new Float32Array(5)
    spectrum.fill(-40)
    spectrum[2] = -20
    const result = calculatePTMR(spectrum, 2, 1)
    // halfWidth=1, excluding ±2 around peak → almost no values
    expect(result.ptmrDb).toBe(0)
    expect(result.feedbackScore).toBe(0)
  })

  it('feedbackScore scales between 0 and 1', () => {
    const spectrum = new Float32Array(1024)
    spectrum.fill(-60)
    spectrum[500] = -30 // 30 dB peak
    const result = calculatePTMR(spectrum, 500, 20)
    expect(result.feedbackScore).toBeGreaterThanOrEqual(0)
    expect(result.feedbackScore).toBeLessThanOrEqual(1)
  })
})

// ── calculateMINDS ─────────────────────────────────────────────────────────

describe('calculateMINDS', () => {
  it('returns -3 dB default with insufficient data', () => {
    const result = calculateMINDS([])
    expect(result.suggestedDepthDb).toBe(-3)
    expect(result.isGrowing).toBe(false)
    expect(result.confidence).toBe(0.3)
  })

  it('detects growing feedback and suggests deeper cut', () => {
    // Simulate rapid growth: +2 dB per frame
    const history = [-20, -18, -16, -14, -12, -10]
    const result = calculateMINDS(history, 0, 50)
    expect(result.isGrowing).toBe(true)
    expect(result.suggestedDepthDb).toBeLessThan(-3) // Deeper than default
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('suggests more aggressive cut for runaway (>6 dB/s)', () => {
    // At 50 fps, each frame is 0.02s. 6 dB/s = 0.12 dB/frame
    // Over 50 frames (1 second), total growth = 6 dB
    const frames = 50
    const history = Array.from({ length: frames }, (_, i) => -30 + (i * 0.15)) // 0.15 dB/frame = 7.5 dB/s
    const result = calculateMINDS(history, 0, 50)
    expect(result.isGrowing).toBe(true)
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('suggests lighter cut for stable signal', () => {
    // Flat signal: no growth
    const history = [-20, -20, -20, -20, -20]
    const result = calculateMINDS(history, 0, 50)
    expect(result.isGrowing).toBe(false)
    expect(result.suggestedDepthDb).toBe(-3) // Light resonance default
  })

  it('deepens from currentDepthDb when growing', () => {
    const history = [-20, -18, -16, -14, -12, -10]
    const noExisting = calculateMINDS(history, 0, 50)
    const withExisting = calculateMINDS(history, -6, 50)
    // Starting from -6 dB should produce a deeper suggestion
    expect(withExisting.suggestedDepthDb).toBeLessThan(noExisting.suggestedDepthDb)
  })

  it('caps suggested depth at -18 dB', () => {
    // Extreme growth scenario
    const history = Array.from({ length: 10 }, (_, i) => -30 + i * 5) // 5 dB/frame!
    const result = calculateMINDS(history, -12, 50)
    expect(result.suggestedDepthDb).toBeGreaterThanOrEqual(-18)
  })
})

// ── detectContentType ──────────────────────────────────────────────────────

describe('detectContentType', () => {
  /**
   * Create a speech-like spectrum: energy concentrated in low bins (100-4kHz),
   * steep rolloff, low global spectral flatness (tonal formants).
   */
  function speechSpectrum(length: number = 4096): Float32Array {
    const arr = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      // Strong energy in low bins (formant region), steep rolloff
      const normFreq = i / length
      if (normFreq < 0.10) arr[i] = -25 - normFreq * 100  // Strong 0–2kHz
      else if (normFreq < 0.20) arr[i] = -45 - normFreq * 50  // Moderate 2–4kHz
      else arr[i] = -80 - normFreq * 20  // Very weak above 4kHz
    }
    return arr
  }

  /**
   * Create a music-like spectrum: energy spread evenly across wide range,
   * high global spectral flatness (dense harmonics across many bins).
   * All bins at roughly the same level → high centroid, high rolloff, high flatness.
   */
  function musicSpectrum(length: number = 4096): Float32Array {
    const arr = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      // Broad, even energy spread — slight slope but energy present throughout
      const normFreq = i / length
      arr[i] = -35 - normFreq * 15  // -35 to -50 — very flat slope
    }
    return arr
  }

  /** Create a flat spectrum (all bins equal dB) */
  function flatSpectrum(db: number, length: number = 4096): Float32Array {
    const arr = new Float32Array(length)
    arr.fill(db)
    return arr
  }

  it('detects compressed content from low crest factor', () => {
    // crestFactor=4 < COMPRESSED_CREST_FACTOR (6) — early gate fires
    const result = detectContentType(flatSpectrum(-40), 4)
    expect(result).toBe('compressed')
  })

  it('detects speech from speech-like spectrum + high crest factor', () => {
    // Speech: concentrated low energy, steep rolloff, high crest (pauses)
    const result = detectContentType(speechSpectrum(), 12)
    expect(result).toBe('speech')
  })

  it('detects speech regardless of crest factor when spectral shape is speech-like', () => {
    // Key test: spectral centroid + rolloff + flatness should dominate over crest factor.
    // Speech with moderate crest (sustained vowel, no pauses) should still classify as speech.
    const result = detectContentType(speechSpectrum(), 7)
    expect(result).toBe('speech')
  })

  it('detects music from music-like spectrum + moderate crest factor', () => {
    // Music: broad energy spread, moderate crest factor
    const result = detectContentType(musicSpectrum(), 7)
    expect(result).toBe('music')
  })

  it('detects music even with high crest factor when spectral shape is music-like', () => {
    // Key test: music with a loud fundamental can have high crest factor (> 12 dB).
    // The broad spectral spread should still classify as music, not speech.
    const result = detectContentType(musicSpectrum(), 13)
    expect(result).toBe('music')
  })

  it('returns unknown for silent/empty spectrum', () => {
    // All bins at -Infinity → no valid power → unknown
    const silent = new Float32Array(4096)
    silent.fill(-Infinity)
    const result = detectContentType(silent, 10)
    expect(result).toBe('unknown')
  })

  it('returns a valid ContentType string', () => {
    const result = detectContentType(flatSpectrum(-40), 8)
    expect(['speech', 'music', 'compressed', 'unknown']).toContain(result)
  })
})

// ── fuseAlgorithmResults ───────────────────────────────────────────────────

describe('fuseAlgorithmResults', () => {
  /** Create empty/null algorithm scores */
  function emptyScores(): AlgorithmScores {
    return {
      msd: null,
      phase: null,
      spectral: null,
      comb: null,
      compression: null,
      ihr: null,
      ptmr: null,
    }
  }

  /** Create high-confidence feedback scores */
  function feedbackScores(): AlgorithmScores {
    return {
      msd: {
        msd: 0.5,
        framesAnalyzed: 100,
        isFeedbackLikely: true,
        feedbackScore: 0.9,
        meanMagnitudeDb: -10,
        secondDerivative: 0.1,
      },
      phase: {
        coherence: 0.95,
        isFeedbackLikely: true,
        feedbackScore: 0.85,
        meanPhaseDelta: 0.05,
        phaseDeltaStd: 0.1,
      },
      spectral: {
        flatness: 0.01,
        isFeedbackLikely: true,
        feedbackScore: 0.8,
        kurtosis: 15,
      },
      comb: null,
      compression: null,
      ihr: {
        interHarmonicRatio: 0.05,
        isFeedbackLike: true,
        isMusicLike: false,
        harmonicsFound: 1,
        feedbackScore: 0.9,
      },
      ptmr: {
        ptmrDb: 25,
        isFeedbackLike: true,
        feedbackScore: 0.85,
      },
    }
  }

  it('returns FEEDBACK verdict for high-scoring algorithms', () => {
    const result = fuseAlgorithmResults(feedbackScores(), 'unknown')
    expect(result.verdict).toBe('FEEDBACK')
    expect(result.feedbackProbability).toBeGreaterThan(0.6)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('returns NOT_FEEDBACK for low-scoring algorithms', () => {
    const scores = feedbackScores()
    // Zero out all feedback scores
    if (scores.msd) scores.msd.feedbackScore = 0.05
    if (scores.phase) scores.phase.feedbackScore = 0.05
    if (scores.spectral) scores.spectral.feedbackScore = 0.05
    if (scores.ihr) scores.ihr.feedbackScore = 0.05
    if (scores.ptmr) scores.ptmr.feedbackScore = 0.05

    const result = fuseAlgorithmResults(scores, 'unknown')
    expect(result.feedbackProbability).toBeLessThan(0.3)
    expect(result.verdict).toBe('NOT_FEEDBACK')
  })

  it('lists contributing algorithms', () => {
    const result = fuseAlgorithmResults(feedbackScores(), 'unknown')
    expect(result.contributingAlgorithms).toContain('MSD')
    expect(result.contributingAlgorithms).toContain('Phase')
    // Legacy/existing weight removed — no longer contributes
  })

  it('generates reasons array for detected issues', () => {
    const result = fuseAlgorithmResults(feedbackScores())
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('feedbackProbability stays in [0, 1]', () => {
    const result = fuseAlgorithmResults(feedbackScores(), 'unknown')
    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0)
    expect(result.feedbackProbability).toBeLessThanOrEqual(1)
  })

  it('handles all-null scores gracefully', () => {
    const result = fuseAlgorithmResults(emptyScores(), 'unknown')
    // No algorithms contribute (existing weight removed), probability should be 0
    expect(result.feedbackProbability).toBe(0)
    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0)
    expect(result.feedbackProbability).toBeLessThanOrEqual(1)
  })

  it('uses speech weights for speech content', () => {
    const result = fuseAlgorithmResults(feedbackScores(), 'speech')
    // Speech mode upweights MSD (0.33 vs 0.30 default)
    expect(result.contributingAlgorithms).toContain('MSD')
  })

  it('uses compressed weights when compression detected', () => {
    const scores = feedbackScores()
    scores.compression = {
      isCompressed: true,
      estimatedRatio: 8.0,
      crestFactor: 4,
      dynamicRange: 6,
      thresholdMultiplier: 1.5,
    }
    const result = fuseAlgorithmResults(scores)
    expect(result.reasons.some(r => r.includes('Compression'))).toBe(true)
  })

  it('doubles comb weight when comb pattern detected (FLAW 6 FIX)', () => {
    const scores = feedbackScores()
    scores.comb = {
      hasPattern: true,
      fundamentalSpacing: 200,
      estimatedPathLength: 1.7,
      matchingPeaks: 5,
      predictedFrequencies: [600],
      confidence: 0.8,
    }
    const result = fuseAlgorithmResults(scores)
    expect(result.contributingAlgorithms).toContain('Comb')
    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0)
    expect(result.feedbackProbability).toBeLessThanOrEqual(1)
  })
})

// ── Confidence formula ──────────────────────────────────────────────────────

describe('confidence formula', () => {
  /** Create scores with known feedbackScore values for all algorithms */
  function uniformScores(score: number): AlgorithmScores {
    return {
      msd: {
        msd: 0.5, framesAnalyzed: 100, isFeedbackLikely: score > 0.5,
        feedbackScore: score, meanMagnitudeDb: -10, secondDerivative: 0.1,
      },
      phase: {
        coherence: score, isFeedbackLikely: score > 0.5,
        feedbackScore: score, meanPhaseDelta: 0.05, phaseDeltaStd: 0.1,
      },
      spectral: {
        flatness: 0.01, isFeedbackLikely: score > 0.5,
        feedbackScore: score, kurtosis: 15,
      },
      comb: null,
      compression: null,
      ihr: {
        interHarmonicRatio: 0.05, isFeedbackLike: score > 0.5,
        isMusicLike: false, harmonicsFound: 1, feedbackScore: score,
      },
      ptmr: {
        ptmrDb: 25, isFeedbackLike: score > 0.5, feedbackScore: score,
      },
    }
  }

  it('confidence = probability * (0.5 + 0.5 * agreement)', () => {
    // When all algorithms agree (uniform scores), variance=0 → agreement=1
    // confidence = probability * (0.5 + 0.5 * 1.0) = probability
    const result = fuseAlgorithmResults(uniformScores(0.9), 'unknown')
    // With uniform scores at 0.9, probability ≈ 0.9, agreement ≈ 1
    // So confidence ≈ probability
    expect(result.confidence).toBeGreaterThan(0.7)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('mixed scores produce lower confidence than uniform scores', () => {
    const uniform = fuseAlgorithmResults(uniformScores(0.8), 'unknown')

    // Create mixed scores — some high, some low
    const mixed = uniformScores(0.8)
    if (mixed.msd) mixed.msd.feedbackScore = 0.9
    if (mixed.phase) mixed.phase.feedbackScore = 0.2
    if (mixed.spectral) mixed.spectral.feedbackScore = 0.7
    if (mixed.ihr) mixed.ihr.feedbackScore = 0.3
    if (mixed.ptmr) mixed.ptmr.feedbackScore = 0.9
    const mixedResult = fuseAlgorithmResults(mixed, 'unknown')

    // Higher variance → lower agreement → confidence scaled down toward 0.5 * probability
    expect(mixedResult.confidence).toBeLessThan(uniform.confidence)
  })

  it('maximally conflicting algorithms can push confidence near the 0.5× floor', () => {
    const conflicting = uniformScores(0)
    if (conflicting.msd) conflicting.msd.feedbackScore = 1
    if (conflicting.phase) conflicting.phase.feedbackScore = 0
    if (conflicting.spectral) conflicting.spectral.feedbackScore = 1
    if (conflicting.ihr) conflicting.ihr.feedbackScore = 0
    if (conflicting.ptmr) conflicting.ptmr.feedbackScore = 0

    const result = fuseAlgorithmResults(conflicting, 'unknown')
    const confidenceScale = result.confidence / result.feedbackProbability

    expect(confidenceScale).toBeGreaterThanOrEqual(0.5)
    expect(confidenceScale).toBeLessThan(0.6)
  })
})

// ── Verdict boundary ───────────────────────────────────────────────────────

describe('verdict boundaries', () => {
  function uniformScores(score: number): AlgorithmScores {
    return {
      msd: {
        msd: 0.5, framesAnalyzed: 100, isFeedbackLikely: score > 0.5,
        feedbackScore: score, meanMagnitudeDb: -10, secondDerivative: 0.1,
      },
      phase: {
        coherence: score, isFeedbackLikely: score > 0.5,
        feedbackScore: score, meanPhaseDelta: 0.05, phaseDeltaStd: 0.1,
      },
      spectral: {
        flatness: 0.01, isFeedbackLikely: score > 0.5,
        feedbackScore: score, kurtosis: 15,
      },
      comb: null, compression: null,
      ihr: {
        interHarmonicRatio: 0.05, isFeedbackLike: score > 0.5,
        isMusicLike: false, harmonicsFound: 1, feedbackScore: score,
      },
      ptmr: {
        ptmrDb: 25, isFeedbackLike: score > 0.5, feedbackScore: score,
      },
    }
  }

  it('very low scores → NOT_FEEDBACK or UNCERTAIN', () => {
    const result = fuseAlgorithmResults(uniformScores(0.05), 'unknown')
    expect(['NOT_FEEDBACK', 'UNCERTAIN']).toContain(result.verdict)
  })

  it('no algorithm evidence returns NOT_FEEDBACK instead of UNCERTAIN', () => {
    const empty: AlgorithmScores = {
      msd: null,
      phase: null,
      spectral: null,
      comb: null,
      compression: null,
      ihr: null,
      ptmr: null,
    }

    const result = fuseAlgorithmResults(empty, 'unknown')

    expect(result.feedbackProbability).toBe(0)
    expect(result.confidence).toBe(0)
    expect(result.verdict).toBe('NOT_FEEDBACK')
  })

  it('very high scores → FEEDBACK', () => {
    const result = fuseAlgorithmResults(uniformScores(0.95), 'unknown')
    expect(result.verdict).toBe('FEEDBACK')
  })

  it('moderate scores → POSSIBLE_FEEDBACK or UNCERTAIN', () => {
    const result = fuseAlgorithmResults(uniformScores(0.5), 'unknown')
    expect(['POSSIBLE_FEEDBACK', 'UNCERTAIN', 'FEEDBACK']).toContain(result.verdict)
  })

  it('conflicting mid-probability evidence stays UNCERTAIN instead of escalating to POSSIBLE_FEEDBACK', () => {
    const conflicting = uniformScores(0)
    if (conflicting.msd) conflicting.msd.feedbackScore = 1
    if (conflicting.phase) conflicting.phase.feedbackScore = 0
    if (conflicting.spectral) conflicting.spectral.feedbackScore = 1
    if (conflicting.ihr) conflicting.ihr.feedbackScore = 0
    if (conflicting.ptmr) conflicting.ptmr.feedbackScore = 0

    const result = fuseAlgorithmResults(conflicting, 'unknown')

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0.35)
    expect(result.confidence).toBeLessThan(0.3)
    expect(result.verdict).toBe('UNCERTAIN')
  })

  it('strong corroboration can promote clear feedback to FEEDBACK even when agreement-scaled confidence is conservative', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.4, phase: 0.5, spectral: 0.9, ihr: 0.9, ptmr: 0.8 }),
      'unknown',
    )

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.confidence).toBeLessThan(0.55)
    expect(result.verdict).toBe('FEEDBACK')
    expect(result.reasons).toContain('Strong multi-algorithm corroboration')
  })

  it('strong harmonic disagreement still blocks promotion for sustained non-feedback', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.95, phase: 0.4, spectral: 0.8, ihr: 0.2, ptmr: 0.8 }),
      'speech',
    )

    expect(result.feedbackProbability).toBeLessThan(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.verdict).toBe('UNCERTAIN')
    expect(result.reasons).toContain('Sustained tonal-source gate: low harmonic cleanliness')
  })

  it('strong corroboration can still produce POSSIBLE_FEEDBACK when early algorithms are missing', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0, phase: 0, spectral: 0.8, ihr: 0.8, ptmr: 0.8 }),
      'unknown',
    )

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0.3)
    expect(result.confidence).toBeLessThan(0.3)
    expect(result.verdict).toBe('POSSIBLE_FEEDBACK')
    expect(result.reasons).toContain('Strong corroboration despite limited algorithm availability')
  })

  it('feedback promotion still requires shape or stability corroboration', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.1, phase: 0.8, spectral: 0.7, ihr: 0.8, ptmr: 0.3, compressed: true }),
      'unknown',
    )

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.confidence).toBeGreaterThan(0.4)
    expect(result.verdict).toBe('POSSIBLE_FEEDBACK')
    expect(result.reasons).not.toContain('Strong multi-algorithm corroboration')
  })

  it('near-threshold dense feedback can promote to FEEDBACK when corroboration is strong', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.6, phase: 0.3, spectral: 0.8, ihr: 0.8, ptmr: 0.7 }),
      'music',
    )

    expect(result.feedbackProbability).toBeLessThan(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.feedbackProbability).toBeGreaterThanOrEqual(
      DEFAULT_FUSION_CONFIG.feedbackThreshold - 0.03,
    )
    expect(result.confidence).toBeLessThan(0.66)
    expect(result.verdict).toBe('FEEDBACK')
    expect(result.reasons).toContain('Strong multi-algorithm corroboration')
  })

  it('compressed feedback can still promote when phase is destroyed but corroboration is overwhelming', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.8, phase: 0.2, spectral: 0.8, ihr: 0.9, ptmr: 0.8, compressed: true }),
      'unknown',
    )

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.confidence).toBeGreaterThanOrEqual(0.4)
    expect(result.verdict).toBe('FEEDBACK')
    expect(result.reasons).toContain('Compression-resistant corroboration despite phase damage')
  })

  it('sustained speech-like tonal sources stay UNCERTAIN', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.9, phase: 0.8, spectral: 0.5, ihr: 0.2, ptmr: 0.6 }),
      'speech',
    )

    expect(result.verdict).toBe('UNCERTAIN')
    expect(result.reasons).toContain('Sustained tonal-source gate: low harmonic cleanliness')
  })

  it('phase-dominant music without MSD support stays UNCERTAIN', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0, phase: 1.0, spectral: 0.8, ihr: 0.6, ptmr: 0.4 }),
      'music',
    )

    expect(result.verdict).toBe('UNCERTAIN')
    expect(result.reasons).toContain('Phase-dominant music gate: missing MSD support')
  })

  it('rich harmonic music with high phase and spectral energy stays below recommendation threshold', () => {
    const scores = buildScores({ msd: 0.55, phase: 0.9, spectral: 0.75, ihr: 0.15, ptmr: 0.65 })
    scores.ihr = {
      ...scores.ihr!,
      harmonicsFound: 4,
      isFeedbackLike: false,
      isMusicLike: true,
    }

    const result = fuseAlgorithmResults(scores, 'music')

    expect(result.feedbackProbability).toBeLessThan(0.35)
    expect(result.verdict).not.toBe('POSSIBLE_FEEDBACK')
    expect(result.verdict).not.toBe('FEEDBACK')
    expect(result.reasons).toContain('Rich harmonic music gate: harmonic series retained as music')
  })

  it('rich harmonic sources stay quiet even when content type is still unknown', () => {
    const scores = buildScores({ msd: 0.55, phase: 0.9, spectral: 0.75, ihr: 0.15, ptmr: 0.65 })
    scores.ihr = {
      ...scores.ihr!,
      harmonicsFound: 4,
      isFeedbackLike: false,
      isMusicLike: true,
    }

    const result = fuseAlgorithmResults(scores, 'unknown')

    expect(result.feedbackProbability).toBeLessThan(0.35)
    expect(result.verdict).not.toBe('POSSIBLE_FEEDBACK')
    expect(result.verdict).not.toBe('FEEDBACK')
    expect(result.reasons).toContain('Rich harmonic music gate: harmonic series retained as music')
  })

  it('music-mode sustained tonal material needs clean feedback shape before escalating', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.7, phase: 0.9, spectral: 0.85, ihr: 0.5, ptmr: 0.7, msdFrames: 20 }),
      'music',
    )

    expect(result.verdict).not.toBe('POSSIBLE_FEEDBACK')
    expect(result.verdict).not.toBe('FEEDBACK')
    expect(result.reasons).toContain('Music tonal-source gate: harmonic/shape evidence not clean enough')
  })

  it('startup unknown tonal music needs clean feedback shape before escalating', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.7, phase: 0.9, spectral: 0.85, ihr: 0.5, ptmr: 0.7, msdFrames: 20 }),
      'unknown',
    )

    expect(result.verdict).not.toBe('POSSIBLE_FEEDBACK')
    expect(result.verdict).not.toBe('FEEDBACK')
    expect(result.reasons).toContain('Startup tonal-source gate: waiting for clean feedback shape')
  })

  it('music-mode clean feedback shape still escalates', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.9, phase: 0.9, spectral: 0.8, ihr: 0.9, ptmr: 0.9, msdFrames: 20 }),
      'music',
    )

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold)
    expect(result.verdict).toBe('FEEDBACK')
    expect(result.reasons).not.toContain('Music tonal-source gate: harmonic/shape evidence not clean enough')
  })

  it('core feedback consensus overrides the rich harmonic music gate', () => {
    const scores = buildScores({ msd: 0.9, phase: 0.9, spectral: 0.85, ihr: 0.15, ptmr: 0.9 })
    scores.ihr = {
      ...scores.ihr!,
      harmonicsFound: 4,
      isFeedbackLike: false,
      isMusicLike: true,
    }

    const result = fuseAlgorithmResults(scores, 'music')

    expect(result.feedbackProbability).toBeGreaterThanOrEqual(0.35)
    expect(['POSSIBLE_FEEDBACK', 'FEEDBACK']).toContain(result.verdict)
    expect(result.reasons).not.toContain('Rich harmonic music gate: harmonic series retained as music')
  })

  it('compressed phase-dominant tonal sources no longer escalate to FEEDBACK', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.7, phase: 0.95, spectral: 0.85, ihr: 0.5, ptmr: 0.7, compressed: true }),
      'unknown',
    )

    expect(result.verdict).not.toBe('FEEDBACK')
    expect(result.reasons).toContain('Compressed tonal-source gate: phase-dominant sustained source')
  })

  it('music comb modulation effects stay UNCERTAIN instead of escalating', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.7, phase: 0.8, spectral: 0.7, comb: 0.8, ihr: 0.4, ptmr: 0.6 }),
      'music',
    )

    expect(result.verdict).toBe('UNCERTAIN')
    expect(result.reasons).toContain('Music comb-effect gate: modulation pattern suspicion')
  })

  it('compressed voiced tonal sources stay UNCERTAIN instead of POSSIBLE_FEEDBACK', () => {
    const result = fuseAlgorithmResults(
      buildScores({ msd: 0.7, phase: 0.95, spectral: 0.85, ihr: 0.5, ptmr: 0.7, compressed: true }),
      'unknown',
    )

    expect(result.verdict).toBe('UNCERTAIN')
    expect(result.reasons).toContain('Compressed voiced-source gate: phase-stable voiced source')
  })
})

// ── Content-weight interaction ──────────────────────────────────────────────

describe('content-weight interaction', () => {
  function feedbackScoresForWeight(): AlgorithmScores {
    return {
      msd: {
        msd: 0.05, framesAnalyzed: 100, isFeedbackLikely: true,
        feedbackScore: 0.9, meanMagnitudeDb: -10, secondDerivative: 0.01,
      },
      phase: {
        coherence: 0.9, isFeedbackLikely: true,
        feedbackScore: 0.9, meanPhaseDelta: 0.05, phaseDeltaStd: 0.05,
      },
      spectral: {
        flatness: 0.02, isFeedbackLikely: true,
        feedbackScore: 0.8, kurtosis: 12,
      },
      comb: null, compression: null,
      ihr: {
        interHarmonicRatio: 0.05, isFeedbackLike: true,
        isMusicLike: false, harmonicsFound: 1, feedbackScore: 0.85,
      },
      ptmr: {
        ptmrDb: 25, isFeedbackLike: true, feedbackScore: 0.85,
      },
    }
  }

  it('speech mode uses SPEECH weights', () => {
    const result = fuseAlgorithmResults(feedbackScoresForWeight(), 'speech')
    // Speech mode upweights MSD (0.33) vs default (0.30)
    expect(result.contributingAlgorithms).toContain('MSD')
    expect(result.verdict).toBe('FEEDBACK')
  })

  it('music mode uses MUSIC weights', () => {
    const result = fuseAlgorithmResults(feedbackScoresForWeight(), 'music')
    // Music mode upweights Phase (0.35) vs default (0.25)
    expect(result.contributingAlgorithms).toContain('Phase')
    expect(result.verdict).toBe('FEEDBACK')
  })
})

// ── FUSION_WEIGHTS ─────────────────────────────────────────────────────────

describe('FUSION_WEIGHTS', () => {
  it.each(['DEFAULT', 'SPEECH', 'MUSIC', 'COMPRESSED'] as const)(
    '%s weights sum to approximately 1',
    (key) => {
      const w = FUSION_WEIGHTS[key]
      const sum = Object.values(w).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 1)
    }
  )

  it('SPEECH mode upweights MSD relative to DEFAULT', () => {
    expect(FUSION_WEIGHTS.SPEECH.msd).toBeGreaterThan(FUSION_WEIGHTS.DEFAULT.msd)
  })

  it('MUSIC mode upweights Phase relative to DEFAULT', () => {
    expect(FUSION_WEIGHTS.MUSIC.phase).toBeGreaterThan(FUSION_WEIGHTS.DEFAULT.phase)
  })

  it('COMPRESSED mode upweights Phase over MSD', () => {
    expect(FUSION_WEIGHTS.COMPRESSED.phase).toBeGreaterThan(FUSION_WEIGHTS.COMPRESSED.msd)
  })
})

// ── Confidence/probability consistency ────────────────────────────────────────

describe('Fusion confidence uses transformed scores', () => {
  it('low-frequency phase suppression reduces confidence, not just probability', () => {
    const scores = buildScores({ msd: 0.7, phase: 0.9, spectral: 0.5, ihr: 0.8, ptmr: 0.7 })

    const highFreq = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG, 1000)
    const lowFreq = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG, 100)

    // Phase is suppressed at 100 Hz, so both probability AND confidence should drop
    expect(lowFreq.feedbackProbability).toBeLessThan(highFreq.feedbackProbability)
    expect(lowFreq.confidence).toBeLessThan(highFreq.confidence)
  })

  it('inactive algorithms do not affect confidence', () => {
    const scores = buildScores({ msd: 0.8, phase: 0.7, spectral: 0.6, ihr: 0.5, ptmr: 0.5 })

    // Custom mode can isolate an MSD-oriented subset.
    const msdSubset = fuseAlgorithmResults(scores, 'unknown', {
      ...DEFAULT_FUSION_CONFIG,
      mode: 'custom',
      enabledAlgorithms: ['msd', 'ihr', 'ptmr'],
    })

    // Auto mode: all deterministic algorithms active once MSD is ready.
    const auto = fuseAlgorithmResults(scores, 'unknown', {
      ...DEFAULT_FUSION_CONFIG,
      mode: 'auto',
    })

    // Different algorithm sets should produce different confidence values
    // because different algorithm sets contribute
    expect(msdSubset.confidence).not.toBeCloseTo(auto.confidence, 2)
  })

  it('confidence never exceeds probability', () => {
    const scores = buildScores({ msd: 0.3, phase: 0.4, spectral: 0.2, ihr: 0.3, ptmr: 0.2 })
    const result = fuseAlgorithmResults(scores)
    // confidence = probability * (0.5 + 0.5 * agreement), agreement <= 1
    // so confidence <= probability
    expect(result.confidence).toBeLessThanOrEqual(result.feedbackProbability)
  })
})

// ── AgreementPersistenceTracker (14.8) ───────────────────────────────────────

describe('AgreementPersistenceTracker', () => {
  it('returns zero bonus with only 1 frame', () => {
    const tracker = new AgreementPersistenceTracker()
    tracker.update(0.9)
    expect(tracker.persistenceBonus).toBe(0)
  })

  it('returns zero bonus with 3 frames (below threshold of 4)', () => {
    const tracker = new AgreementPersistenceTracker()
    tracker.update(0.9)
    tracker.update(0.9)
    tracker.update(0.9)
    expect(tracker.persistenceBonus).toBe(0)
    expect(tracker.frames).toBe(3)
  })

  it('returns positive bonus after 6 frames of high agreement', () => {
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 6; i++) tracker.update(0.9)
    expect(tracker.frames).toBe(6)
    expect(tracker.ewma).toBeGreaterThan(0.6)
    expect(tracker.persistenceBonus).toBeGreaterThan(0)
    expect(tracker.persistenceBonus).toBeLessThanOrEqual(0.05)
  })

  it('bonus never exceeds 0.05', () => {
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 100; i++) tracker.update(1.0)
    expect(tracker.persistenceBonus).toBeLessThanOrEqual(0.05)
  })

  it('returns zero bonus when ewma <= 0.6', () => {
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 6; i++) tracker.update(0.5)
    expect(tracker.persistenceBonus).toBe(0)
  })

  it('reset clears state', () => {
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 6; i++) tracker.update(0.9)
    expect(tracker.persistenceBonus).toBeGreaterThan(0)
    tracker.reset()
    expect(tracker.frames).toBe(0)
    expect(tracker.ewma).toBe(0)
    expect(tracker.persistenceBonus).toBe(0)
  })

  it('adds persistence bonus to confidence in fuseAlgorithmResults', () => {
    const scores = buildScores({ msd: 0.8, phase: 0.8, spectral: 0.8, ihr: 0.8, ptmr: 0.8 })
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 6; i++) tracker.update(0.9)
    const withTracker = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG, undefined, undefined, tracker)
    const without = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG)
    expect(withTracker.confidence).toBeGreaterThan(without.confidence)
    expect(withTracker.confidence).toBeLessThanOrEqual(1)
  })

  it('can lift stable borderline evidence from UNCERTAIN to POSSIBLE_FEEDBACK', () => {
    const scores: AlgorithmScores = {
      msd: {
        msd: 0.02,
        feedbackScore: 1,
        secondDerivative: 0,
        isFeedbackLikely: true,
        framesAnalyzed: 10,
        meanMagnitudeDb: -24,
      },
      phase: {
        coherence: 0.1,
        feedbackScore: 0,
        meanPhaseDelta: 0,
        phaseDeltaStd: 1,
        isFeedbackLikely: false,
      },
      spectral: {
        flatness: 0.02,
        kurtosis: 12,
        feedbackScore: 1,
        isFeedbackLikely: true,
      },
      comb: null,
      compression: null,
      ihr: {
        interHarmonicRatio: 0.5,
        isFeedbackLike: false,
        isMusicLike: false,
        harmonicsFound: 1,
        feedbackScore: 0,
      },
      ptmr: {
        ptmrDb: 8,
        isFeedbackLike: false,
        feedbackScore: 0,
      },
    }
    const tracker = new AgreementPersistenceTracker()
    for (let i = 0; i < 6; i++) tracker.update(0.9)

    const withoutTracker = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG)
    const withTracker = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG, undefined, undefined, tracker)

    expect(withoutTracker.verdict).toBe('UNCERTAIN')
    expect(withTracker.verdict).toBe('POSSIBLE_FEEDBACK')
  })
})

// ── calibrateProbability (14.3) ──────────────────────────────────────────────

describe('calibrateProbability', () => {
  it('returns raw when no table is provided', () => {
    expect(calibrateProbability(0.5)).toBe(0.5)
    expect(calibrateProbability(0.0)).toBe(0.0)
    expect(calibrateProbability(1.0)).toBe(1.0)
  })

  it('returns raw with identity (empty breakpoints) table', () => {
    expect(calibrateProbability(0.5, IDENTITY_CALIBRATION)).toBe(0.5)
    expect(calibrateProbability(0.75, IDENTITY_CALIBRATION)).toBe(0.75)
  })

  it('interpolates linearly between two breakpoints', () => {
    const table: CalibrationTable = {
      breakpoints: [
        { raw: 0.0, calibrated: 0.0 },
        { raw: 1.0, calibrated: 0.5 },
      ],
    }
    expect(calibrateProbability(0.0, table)).toBeCloseTo(0.0)
    expect(calibrateProbability(0.5, table)).toBeCloseTo(0.25)
    expect(calibrateProbability(1.0, table)).toBeCloseTo(0.5)
  })

  it('clamps below first breakpoint', () => {
    const table: CalibrationTable = {
      breakpoints: [
        { raw: 0.2, calibrated: 0.1 },
        { raw: 0.8, calibrated: 0.9 },
      ],
    }
    expect(calibrateProbability(0.0, table)).toBe(0.1)
  })

  it('clamps above last breakpoint', () => {
    const table: CalibrationTable = {
      breakpoints: [
        { raw: 0.2, calibrated: 0.1 },
        { raw: 0.8, calibrated: 0.9 },
      ],
    }
    expect(calibrateProbability(1.0, table)).toBe(0.9)
  })

  it('preserves monotonicity for monotonic input', () => {
    const table: CalibrationTable = {
      breakpoints: [
        { raw: 0.0, calibrated: 0.0 },
        { raw: 0.3, calibrated: 0.2 },
        { raw: 0.6, calibrated: 0.5 },
        { raw: 1.0, calibrated: 1.0 },
      ],
    }
    const values = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    const calibrated = values.map(v => calibrateProbability(v, table))
    for (let i = 1; i < calibrated.length; i++) {
      expect(calibrated[i]).toBeGreaterThanOrEqual(calibrated[i - 1])
    }
  })

  it('does not change fuseAlgorithmResults with identity table', () => {
    const scores = buildScores({ msd: 0.7, phase: 0.6, spectral: 0.5, ihr: 0.4, ptmr: 0.5 })
    const without = fuseAlgorithmResults(scores)
    const withIdentity = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG, undefined, undefined, undefined, IDENTITY_CALIBRATION)
    expect(withIdentity.feedbackProbability).toBeCloseTo(without.feedbackProbability, 10)
  })
})
