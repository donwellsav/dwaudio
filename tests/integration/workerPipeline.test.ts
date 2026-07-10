/**
 * Worker Pipeline Integration Tests
 *
 * Tests the DSP processing pipeline that runs in the web worker:
 *   AlgorithmEngine.computeScores() → fuseAlgorithmResults() → classifyTrackWithAlgorithms()
 *
 * These tests exercise the full chain with synthetic spectra to verify that:
 * 1. A clean feedback-like peak (narrow, persistent, high MSD) produces high pFeedback
 * 2. A broad musical peak produces low pFeedback
 * 3. The pipeline doesn't crash on edge cases (empty spectrum, silence, NaN)
 *
 * This covers the main-thread → worker contract gap: the message types are
 * tested in dspWorkerMessages.test.ts, but the actual processing logic
 * was previously untested end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackDetector } from '@/lib/dsp/feedbackDetector'
import { AlgorithmEngine } from '@/lib/dsp/workerFft'
import {
  AgreementPersistenceTracker,
  CombStabilityTracker,
  fuseAlgorithmResults,
  DEFAULT_FUSION_CONFIG,
  buildFusionConfig,
} from '@/lib/dsp/advancedDetection'
import { classifyTrackWithAlgorithms, shouldReportIssue } from '@/lib/dsp/classifier'
import { generateEQAdvisory } from '@/lib/dsp/eqAdvisor'
import { TrackManager } from '@/lib/dsp/trackManager'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
import { DEFAULT_CONFIG } from '@/types/advisory'
import type { DetectedPeak, Track } from '@/types/advisory'
import type { AlgorithmScores } from '@/lib/dsp/advancedDetection'
import type { WorkerInboundMessage, WorkerOutboundMessage } from '@/lib/dsp/dspWorker'
import {
  buildScores,
} from '@/tests/helpers/mockAlgorithmScores'

// ── Helpers ─────────────────────────────────────────────────────────────────

const FFT_SIZE = 8192
const SAMPLE_RATE = 48000
const NUM_BINS = FFT_SIZE / 2

/** Create a synthetic spectrum with a single peak at the given bin */
function makePeakSpectrum(peakBin: number, peakDb: number, floorDb: number = -80): Float32Array {
  const spectrum = new Float32Array(NUM_BINS)
  spectrum.fill(floorDb)

  // Narrow peak: ±3 bins with -3dB/bin rolloff (high Q)
  for (let offset = -3; offset <= 3; offset++) {
    const bin = peakBin + offset
    if (bin >= 0 && bin < NUM_BINS) {
      spectrum[bin] = peakDb - Math.abs(offset) * 3
    }
  }
  return spectrum
}

function makeMusicSpectrum(): Float32Array {
  const spectrum = new Float32Array(NUM_BINS)
  for (let i = 0; i < NUM_BINS; i++) {
    const normFreq = i / NUM_BINS
    spectrum[i] = -35 - normFreq * 15
  }
  return spectrum
}

function makeHarmonicInstrumentSpectrum(fundamentalBin: number): Float32Array {
  const spectrum = new Float32Array(NUM_BINS)
  spectrum.fill(-85)

  for (let harmonic = 1; harmonic <= 5; harmonic++) {
    const centerBin = fundamentalBin * harmonic
    if (centerBin >= NUM_BINS) break
    const centerDb = -24 - (harmonic - 1) * 4
    for (let offset = -2; offset <= 2; offset++) {
      const bin = centerBin + offset
      if (bin >= 0 && bin < NUM_BINS) {
        spectrum[bin] = centerDb - Math.abs(offset) * 4
      }
    }
  }

  return spectrum
}

function makeStableSineFrame(binIndex: number): Float32Array {
  const frame = new Float32Array(FFT_SIZE)
  const phaseStep = 2 * Math.PI * binIndex / FFT_SIZE
  for (let i = 0; i < FFT_SIZE; i++) {
    frame[i] = Math.sin(phaseStep * i)
  }
  return frame
}

function createDetectorHarness(
  spectrumFiller: (array: Float32Array) => void,
  timeDomainFiller: (array: Float32Array) => void,
  configOverrides: NonNullable<ConstructorParameters<typeof FeedbackDetector>[0]> = {},
): {
  detector: FeedbackDetector
  detectedPeaks: DetectedPeak[]
  analyzeFrame: (timestamp: number, deltaMs: number) => void
} {
  const detectedPeaks: DetectedPeak[] = []
  const detector = new FeedbackDetector({
    ...DEFAULT_CONFIG,
    aWeightingEnabled: false,
    noiseFloorEnabled: false,
    inputGainDb: 0,
    autoGainEnabled: false,
    analysisIntervalMs: 20,
    thresholdDb: -50,
    prominenceDb: 8,
    sustainMs: 240,
    minHz: 150,
    maxHz: 10000,
    ...configOverrides,
  }, {
    onPeakDetected: (peak) => {
      detectedPeaks.push({ ...peak })
    },
  })

  const analyser = {
    frequencyBinCount: NUM_BINS,
    fftSize: FFT_SIZE,
    smoothingTimeConstant: 0.5,
    minDecibels: -100,
    maxDecibels: 0,
    getFloatFrequencyData: (array: Float32Array) => {
      spectrumFiller(array)
    },
    getFloatTimeDomainData: (array: Float32Array) => {
      timeDomainFiller(array)
    },
  }

  Reflect.set(detector, 'audioContext', {
    sampleRate: SAMPLE_RATE,
    state: 'running',
    resume: () => Promise.resolve(),
  })
  Reflect.set(detector, 'analyser', analyser)
  detector.setFftSize(FFT_SIZE)

  const analyze = Reflect.get(detector, 'analyze') as (now: number, deltaMs: number) => void

  return {
    detector,
    detectedPeaks,
    analyzeFrame: (timestamp, deltaMs) => {
      analyze.call(detector, timestamp, deltaMs)
    },
  }
}

function crestFactorForSpectrum(spectrum: Float32Array): number {
  let peak = -Infinity
  let sumLinear = 0
  let validBins = 0

  for (const value of spectrum) {
    if (!Number.isFinite(value)) continue
    if (value > peak) peak = value
    sumLinear += 10 ** (value / 10)
    validBins++
  }

  if (validBins === 0 || !Number.isFinite(peak)) return 0

  const rmsDb = 10 * Math.log10(sumLinear / validBins)
  return peak - rmsDb
}

/** Create a minimal Track for classification */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track',
    binIndex: 170,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -30,
    prominenceDb: 15,
    onsetTime: Date.now() - 2000,
    onsetDb: -40,
    lastUpdateTime: Date.now(),
    history: [],
    features: {
      stabilityCentsStd: 2,
      meanQ: 25,
      minQ: 20,
      meanVelocityDbPerSec: 3,
      maxVelocityDbPerSec: 5,
      persistenceMs: 2000,
      harmonicityScore: 0.1,
      modulationScore: 0.05,
      noiseSidebandScore: 0.1,
    },
    qEstimate: 25,
    bandwidthHz: 40,
    velocityDbPerSec: 3,
    harmonicOfHz: null,
    isSubHarmonicRoot: false,
    isActive: true,
    msd: 0.5,
    msdGrowthRate: 0.1,
    msdIsHowl: true,
    persistenceFrames: 50,
    isPersistent: true,
    isHighlyPersistent: true,
    ...overrides,
  }
}

/** Create a minimal DetectedPeak */
function makePeak(overrides: Partial<DetectedPeak> = {}): DetectedPeak {
  return {
    binIndex: 170,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -30,
    prominenceDb: 15,
    sustainedMs: 500,
    harmonicOfHz: null,
    timestamp: Date.now(),
    noiseFloorDb: -70,
    effectiveThresholdDb: -50,
    qEstimate: 25,
    bandwidthHz: 40,
    msd: 0.5,
    msdGrowthRate: 0.1,
    msdIsHowl: true,
    persistenceFrames: 50,
    isPersistent: true,
    isHighlyPersistent: true,
    ...overrides,
  }
}

async function createWorkerHarness(): Promise<{
  messages: WorkerOutboundMessage[]
  dispatch: (message: WorkerInboundMessage) => void
}> {
  const messages: WorkerOutboundMessage[] = []
  const workerScope: {
    onmessage: ((event: MessageEvent<WorkerInboundMessage>) => void) | null
    postMessage: (message: WorkerOutboundMessage) => void
  } = {
    onmessage: null,
    postMessage(message) {
      messages.push(message)
    },
  }

  vi.stubGlobal('self', workerScope)
  await import('@/lib/dsp/dspWorker')

  if (!workerScope.onmessage) {
    throw new Error('DSP worker did not install its message handler')
  }

  return {
    messages,
    dispatch(message) {
      workerScope.onmessage?.({ data: message } as MessageEvent<WorkerInboundMessage>)
    },
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Worker Pipeline Integration', () => {
  let engine: AlgorithmEngine

  beforeEach(() => {
    engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('clears current-run recurrence on reset and applies initial track options', async () => {
    const updateOptions = vi.spyOn(TrackManager.prototype, 'updateOptions')
    const { dispatch, messages } = await createWorkerHarness()
    const settings = {
      ...DEFAULT_SETTINGS,
      maxTracks: 9,
      trackTimeoutMs: 275,
    }

    dispatch({
      type: 'init',
      settings,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    })

    expect.soft(updateOptions).toHaveBeenCalledWith({
      maxTracks: 9,
      trackTimeoutMs: 275,
    })

    dispatch({
      type: 'syncFeedbackHistory',
      hotspots: [
        {
          centerFrequencyHz: 1000,
          occurrences: 3,
          lastSeen: 900,
        },
      ],
    })
    dispatch({ type: 'reset', generation: 17 })
    expect.soft(messages.at(-1)).toEqual({
      type: 'resetComplete',
      generation: 17,
    })
    dispatch({
      type: 'processPeak',
      peak: makePeak({
        binIndex: 170,
        trueFrequencyHz: 1000,
        trueAmplitudeDb: -24,
        prominenceDb: 36,
        sustainedMs: 240,
        timestamp: 1000,
        qEstimate: 40,
        bandwidthHz: 25,
        msd: 0.02,
        msdGrowthRate: 1.4,
        msdIsHowl: true,
        msdFastConfirm: true,
        persistenceFrames: 12,
        isPersistent: true,
      }),
      spectrum: makePeakSpectrum(170, -24),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    })

    const recommendation = messages.findLast(
      (message): message is Extract<WorkerOutboundMessage, { type: 'advisory' }> =>
        message.type === 'advisory',
    )

    expect(recommendation).toBeDefined()
    expect(recommendation?.advisory.advisory?.recommendationContext).toMatchObject({
      recurrenceCount: 0,
    })
  })

  describe('AlgorithmEngine → computeScores', () => {
    it('computes scores for a narrow feedback-like peak', () => {
      const peakBin = 170 // ~1000 Hz at 48kHz/8192 FFT
      const spectrum = makePeakSpectrum(peakBin, -30)
      const peak = makePeak({ binIndex: peakBin })
      const track = makeTrack({ binIndex: peakBin })

      const result = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [1000])

      expect(result).toBeDefined()
      expect(result.algorithmScores.msd).toBeDefined()
      expect(result.algorithmScores.phase).toBeDefined()
      expect(result.algorithmScores.spectral).toBeDefined()
      expect(result.algorithmScores.comb).toBeDefined()
      expect(result.algorithmScores.ihr).toBeDefined()
      expect(result.algorithmScores.ptmr).toBeDefined()
    })

    it('produces valid score ranges (all between 0 and 1)', () => {
      const peakBin = 170
      const spectrum = makePeakSpectrum(peakBin, -30)
      const peak = makePeak({ binIndex: peakBin })
      const track = makeTrack({ binIndex: peakBin })

      // Feed several frames to build history
      for (let i = 0; i < 15; i++) {
        engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [1000])
      }

      const result = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [1000])
      const scores = result.algorithmScores

      // feedbackScore should be in [0, 1] range
      expect(scores.msd!.feedbackScore).toBeGreaterThanOrEqual(0)
      expect(scores.msd!.feedbackScore).toBeLessThanOrEqual(1)
      expect(scores.phase!.coherence).toBeGreaterThanOrEqual(0)
      expect(scores.phase!.coherence).toBeLessThanOrEqual(1)
    })

    it('handles empty spectrum without crashing', () => {
      const emptySpectrum = new Float32Array(NUM_BINS).fill(-100)
      const peak = makePeak({ trueAmplitudeDb: -100 })
      const track = makeTrack({ trueAmplitudeDb: -100 })

      expect(() => {
        engine.computeScores(peak, track, emptySpectrum, SAMPLE_RATE, FFT_SIZE, [])
      }).not.toThrow()
    })
  })

  describe('fuseAlgorithmResults', () => {
    it('produces a fused probability for feedback-like scores', () => {
      // Simulate high-confidence feedback: high MSD score, high phase coherence
      const scores: AlgorithmScores = buildScores({
        msd: 0.9,
        phase: 0.85,
        spectral: 0.7,
        comb: 0,
        ihr: 0.3,
        ptmr: 0.8,
        msdFrames: 20,
      })

      const result = fuseAlgorithmResults(scores, 'unknown', { ...DEFAULT_FUSION_CONFIG })

      expect(result.feedbackProbability).toBeGreaterThan(0.5)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('produces low probability for broad musical scores', () => {
      const scores: AlgorithmScores = buildScores({
        msd: 0.1,
        phase: 0.2,
        spectral: 0.2,
        comb: 0,
        ihr: 0.8,
        ptmr: 0.1,
        msdFrames: 20,
      })

      const result = fuseAlgorithmResults(scores, 'unknown', { ...DEFAULT_FUSION_CONFIG })

      expect(result.feedbackProbability).toBeLessThan(0.5)
    })
  })

  describe('classifyTrackWithAlgorithms', () => {
    it('classifies a feedback-like track as ACOUSTIC_FEEDBACK', () => {
      const track = makeTrack({
        features: {
          stabilityCentsStd: 1,
          meanQ: 30,
          minQ: 25,
          meanVelocityDbPerSec: 5,
          maxVelocityDbPerSec: 8,
          persistenceMs: 3000,
          harmonicityScore: 0.05,
          modulationScore: 0.02,
          noiseSidebandScore: 0.05,
        },
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0.9,
        phase: 0.85,
        spectral: 0.7,
        comb: 0,
        ihr: 0.3,
        ptmr: 0.8,
        msdFrames: 20,
      })

      const fusionResult = fuseAlgorithmResults(scores, 'unknown', { ...DEFAULT_FUSION_CONFIG })
      const result = classifyTrackWithAlgorithms(track, scores, fusionResult)

      expect(result.label).toBe('ACOUSTIC_FEEDBACK')
      expect(result.pFeedback).toBeGreaterThan(0.5)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('classifies an instrument-like track with low feedback probability', () => {
      const track = makeTrack({
        features: {
          stabilityCentsStd: 30,
          meanQ: 3,
          minQ: 2,
          meanVelocityDbPerSec: 0,
          maxVelocityDbPerSec: 0.5,
          persistenceMs: 300,
          harmonicityScore: 0.9,
          modulationScore: 0.5,
          noiseSidebandScore: 0.6,
        },
        msd: 50,
        msdGrowthRate: 0,
        msdIsHowl: false,
        isPersistent: false,
        isHighlyPersistent: false,
        prominenceDb: 3,
        qEstimate: 3,
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0.02,
        phase: 0.05,
        spectral: 0.05,
        comb: 0,
        ihr: 0.95,
        ptmr: 0.02,
        msdFrames: 20,
      })

      const fusionResult = fuseAlgorithmResults(scores, 'music', { ...DEFAULT_FUSION_CONFIG })
      const result = classifyTrackWithAlgorithms(track, scores, fusionResult)

      // Instrument-like track with very low algorithm scores should classify below feedback threshold
      expect(result.pFeedback).toBeLessThan(0.5)
    })

    it('reports core-consensus feedback even when harmonic content is classified as music', () => {
      const track = makeTrack({
        features: {
          stabilityCentsStd: 1,
          meanQ: 28,
          minQ: 22,
          meanVelocityDbPerSec: 3,
          maxVelocityDbPerSec: 5,
          persistenceMs: 2200,
          harmonicityScore: 0.55,
          modulationScore: 0.04,
          noiseSidebandScore: 0.08,
        },
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0.9,
        phase: 0.9,
        spectral: 0.85,
        comb: 0,
        ihr: 0.15,
        ptmr: 0.9,
        msdFrames: 20,
      })
      scores.ihr = {
        ...scores.ihr!,
        harmonicsFound: 4,
        isFeedbackLike: false,
        isMusicLike: true,
      }

      const settings = { ...DEFAULT_SETTINGS, mode: 'liveMusic' as const }
      const fusionResult = fuseAlgorithmResults(scores, 'music', { ...DEFAULT_FUSION_CONFIG })
      const result = classifyTrackWithAlgorithms(track, scores, fusionResult, settings)

      expect(['POSSIBLE_FEEDBACK', 'FEEDBACK']).toContain(fusionResult.verdict)
      expect(shouldReportIssue(result, settings)).toBe(true)
    })

    it('keeps strong non-MSD feedback evidence reportable in speech mode', () => {
      const track = makeTrack({
        trueAmplitudeDb: -24,
        prominenceDb: 32,
        features: {
          stabilityCentsStd: 1,
          meanQ: 30,
          minQ: 24,
          meanVelocityDbPerSec: 1.5,
          maxVelocityDbPerSec: 3,
          persistenceMs: 420,
          harmonicityScore: 0.05,
          modulationScore: 0.02,
          noiseSidebandScore: 0.04,
        },
        qEstimate: 30,
        bandwidthHz: 34,
        velocityDbPerSec: 1.5,
        persistenceFrames: 21,
        isPersistent: true,
        isHighlyPersistent: true,
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0,
        phase: 0.2,
        spectral: 0.8,
        comb: 0,
        ihr: 0.8,
        ptmr: 0.8,
        msdFrames: 20,
      })

      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const fusionResult = fuseAlgorithmResults(scores, 'speech', { ...DEFAULT_FUSION_CONFIG })
      const result = classifyTrackWithAlgorithms(track, scores, fusionResult, settings, [1000])

      expect(fusionResult.verdict).toBe('POSSIBLE_FEEDBACK')
      expect(result.label).toBe('ACOUSTIC_FEEDBACK')
      expect(shouldReportIssue(result, settings)).toBe(true)
    })

    it('keeps no-phase music feedback evidence reportable in live music mode', () => {
      const track = makeTrack({
        trueAmplitudeDb: -24,
        prominenceDb: 32,
        features: {
          stabilityCentsStd: 1,
          meanQ: 30,
          minQ: 24,
          meanVelocityDbPerSec: 1.5,
          maxVelocityDbPerSec: 3,
          persistenceMs: 420,
          harmonicityScore: 0.05,
          modulationScore: 0.02,
          noiseSidebandScore: 0.04,
        },
        qEstimate: 30,
        bandwidthHz: 34,
        velocityDbPerSec: 1.5,
        persistenceFrames: 21,
        isPersistent: true,
        isHighlyPersistent: true,
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0.8,
        phase: 0,
        spectral: 0.8,
        comb: 0,
        ihr: 0.8,
        ptmr: 0.2,
        msdFrames: 20,
      })

      const settings = { ...DEFAULT_SETTINGS, mode: 'liveMusic' as const }
      const fusionResult = fuseAlgorithmResults(scores, 'music', { ...DEFAULT_FUSION_CONFIG })
      const result = classifyTrackWithAlgorithms(track, scores, fusionResult, settings, [1000])

      expect(fusionResult.verdict).toBe('POSSIBLE_FEEDBACK')
      expect(result.label).toBe('ACOUSTIC_FEEDBACK')
      expect(shouldReportIssue(result, settings)).toBe(true)
    })

    it('marks NOT_FEEDBACK fusion results as ineligible for recommendation', () => {
      const track = makeTrack({
        features: {
          stabilityCentsStd: 2,
          meanQ: 30,
          minQ: 24,
          meanVelocityDbPerSec: 6,
          maxVelocityDbPerSec: 12,
          persistenceMs: 1800,
          harmonicityScore: 0.05,
          modulationScore: 0.02,
          noiseSidebandScore: 0.04,
        },
        velocityDbPerSec: 12,
      })

      const scores: AlgorithmScores = buildScores({
        msd: 0.1,
        phase: 0.05,
        spectral: 0.08,
        comb: 0,
        ihr: 0.9,
        ptmr: 0.05,
        msdFrames: 20,
      })

      const result = classifyTrackWithAlgorithms(track, scores, {
        feedbackProbability: 0.08,
        confidence: 0.25,
        contributingAlgorithms: ['msd', 'phase'],
        algorithmScores: scores,
        verdict: 'NOT_FEEDBACK',
        reasons: ['fusion rejected'],
      })

      expect(result.fusionVerdict).toBe('NOT_FEEDBACK')
      expect(result.recommendationEligible).toBe(false)
    })

    it('uses recommendation context to deepen cuts for recurring current-run feedback', () => {
      const track = makeTrack({ trueFrequencyHz: 1000 })

      const baseline = generateEQAdvisory(track, 'RESONANCE', 'heavy')
      const recurring = generateEQAdvisory(
        track,
        'RESONANCE',
        'heavy',
        undefined,
        undefined,
        undefined,
        [],
        {
          recurrenceCount: 2,
        },
      )

      expect(recurring.peq.gainDb).toBeLessThan(baseline.peq.gainDb)
      expect(recurring.geq.suggestedDb).toBeLessThan(baseline.geq.suggestedDb)
      expect(recurring.recommendationContext).toMatchObject({
        recurrenceCount: 2,
      })
    })
  })

  describe('deterministic frame replay', () => {
    it('uses detector MSD fallback to avoid worker cold-start latency at active-refresh cadence', () => {
      const trackManager = new TrackManager({ historySize: 16 })
      const peakBin = 170
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const timestamp = 1000
      const spectrum = makePeakSpectrum(peakBin, -24)
      const peak = makePeak({
        binIndex: peakBin,
        timestamp,
        sustainedMs: 240,
        trueAmplitudeDb: -24,
        prominenceDb: 36,
        qEstimate: 40,
        bandwidthHz: 25,
        msd: 0.02,
        msdGrowthRate: 1.4,
        msdIsHowl: true,
        msdFastConfirm: true,
        persistenceFrames: 12,
        isPersistent: true,
      })

      const track = trackManager.processPeak(peak)
      const activeFrequencies = trackManager.getRawTracks().map((activeTrack) => activeTrack.trueFrequencyHz)

      engine.feedFrame(timestamp, spectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
      const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, activeFrequencies)
      const contentType = engine.getContentType() !== 'unknown'
        ? engine.getContentType()
        : algorithmResult.contentType
      const fusionResult = fuseAlgorithmResults(
        algorithmResult.algorithmScores,
        contentType,
        DEFAULT_FUSION_CONFIG,
        track.trueFrequencyHz,
      )
      const classification = classifyTrackWithAlgorithms(
        track,
        algorithmResult.algorithmScores,
        fusionResult,
        settings,
        activeFrequencies,
      )

      expect(algorithmResult.algorithmScores.msd?.msd).toBe(0.02)
      expect(fusionResult.verdict).toBe('POSSIBLE_FEEDBACK')
      expect(shouldReportIssue(classification, settings)).toBe(true)
    })

    it('uses TrackManager persistence to block first-frame growth while preserving fast feedback reports', () => {
      const trackManager = new TrackManager({ historySize: 16 })
      const peakBin = 170
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      let firstReportFrame: number | null = null
      let firstReportPersistenceMs = 0

      for (let frame = 0; frame < 8; frame++) {
        const timestamp = 1000 + frame * 20
        const peakDb = -30 + frame * 0.1
        const spectrum = makePeakSpectrum(peakBin, peakDb)
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: frame * 20,
          trueAmplitudeDb: peakDb,
          prominenceDb: 36,
          qEstimate: 40,
          bandwidthHz: 25,
        })
        const track = trackManager.processPeak(peak)
        const activeFrequencies = trackManager.getRawTracks().map((activeTrack) => activeTrack.trueFrequencyHz)

        engine.updateContentType(spectrum, 13, SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, activeFrequencies)
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          DEFAULT_FUSION_CONFIG,
          track.trueFrequencyHz,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          activeFrequencies,
        )
        const reported = shouldReportIssue(classification, settings)

        if (frame < 4) {
          expect(reported).toBe(false)
        }

        if (reported && firstReportFrame === null) {
          firstReportFrame = frame + 1
          firstReportPersistenceMs = classification.persistenceMs ?? 0
        }
      }

      expect(firstReportFrame).not.toBeNull()
      expect(firstReportFrame).toBeLessThanOrEqual(8)
      expect(firstReportPersistenceMs).toBeGreaterThanOrEqual(80)
    })

    it('promotes clean narrow feedback within eight 20ms frames', () => {
      const peakBin = 170
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      let firstReportFrame: number | null = null
      let firstReportPersistenceMs = 0
      let firstReportProbability = 0

      for (let frame = 0; frame < 8; frame++) {
        const timestamp = 1000 + frame * 20
        const spectrum = makePeakSpectrum(peakBin, -24)
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: frame * 20,
          trueAmplitudeDb: -24,
          prominenceDb: 36,
        })
        const track = makeTrack({
          binIndex: peakBin,
          trueAmplitudeDb: -24,
          prominenceDb: 36,
          onsetTime: 1000,
          lastUpdateTime: timestamp,
          history: [],
          features: {
            stabilityCentsStd: 1,
            meanQ: 40,
            minQ: 34,
            meanVelocityDbPerSec: 4,
            maxVelocityDbPerSec: 7,
            persistenceMs: frame * 20,
            harmonicityScore: 0.02,
            modulationScore: 0.01,
            noiseSidebandScore: 0.02,
          },
          qEstimate: 40,
          bandwidthHz: 25,
          velocityDbPerSec: 4,
          persistenceFrames: frame + 1,
          isPersistent: frame >= 3,
          isHighlyPersistent: frame >= 6,
        })

        engine.updateContentType(spectrum, 13, SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [1000])
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          DEFAULT_FUSION_CONFIG,
          track.trueFrequencyHz,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
        )

        if (shouldReportIssue(classification, settings)) {
          firstReportFrame = frame + 1
          firstReportPersistenceMs = classification.persistenceMs ?? 0
          firstReportProbability = fusionResult.feedbackProbability
          break
        }
      }

      expect(firstReportFrame).not.toBeNull()
      expect(firstReportFrame).toBeGreaterThan(1)
      expect(firstReportFrame).toBeLessThanOrEqual(8)
      expect(firstReportPersistenceMs).toBeGreaterThanOrEqual(80)
      expect(firstReportProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold * 0.6)
    })

    it('keeps broad music-like spectra below the recommendation path', () => {
      const peakBin = 170
      const settings = { ...DEFAULT_SETTINGS, mode: 'liveMusic' as const }
      let maxFeedbackProbability = 0
      let reported = false
      let sawMusicContentType = false

      for (let frame = 0; frame < 16; frame++) {
        const timestamp = 1000 + frame * 20
        const spectrum = makeMusicSpectrum()
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: frame * 20,
          trueAmplitudeDb: spectrum[peakBin],
          prominenceDb: 4,
          qEstimate: 3,
          bandwidthHz: 320,
        })
        const track = makeTrack({
          binIndex: peakBin,
          trueAmplitudeDb: spectrum[peakBin],
          prominenceDb: 4,
          onsetTime: 1000,
          lastUpdateTime: timestamp,
          features: {
            stabilityCentsStd: 24,
            meanQ: 3,
            minQ: 2,
            meanVelocityDbPerSec: 0.2,
            maxVelocityDbPerSec: 0.4,
            persistenceMs: frame * 20,
            harmonicityScore: 0.9,
            modulationScore: 0.35,
            noiseSidebandScore: 0.45,
          },
          qEstimate: 3,
          bandwidthHz: 320,
          velocityDbPerSec: 0.2,
          persistenceFrames: frame + 1,
          isPersistent: frame >= 3,
          isHighlyPersistent: frame >= 6,
        })

        engine.updateContentType(spectrum, 13, SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [
          1000,
          2000,
          3000,
          4000,
        ])
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        sawMusicContentType ||= contentType === 'music'
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          DEFAULT_FUSION_CONFIG,
          track.trueFrequencyHz,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
        )

        maxFeedbackProbability = Math.max(maxFeedbackProbability, fusionResult.feedbackProbability)
        reported ||= shouldReportIssue(classification, settings)
      }

      expect(maxFeedbackProbability).toBeLessThan(0.35)
      expect(reported).toBe(false)
      expect(sawMusicContentType).toBe(true)
    })

    it('keeps stable harmonic musical notes below the recommendation path', () => {
      const peakBin = 170
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'liveMusic' as const }
      let maxFeedbackProbability = 0
      let reported = false

      for (let frame = 0; frame < 20; frame++) {
        const timestamp = 1000 + frame * 20
        const spectrum = makeHarmonicInstrumentSpectrum(peakBin)
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: frame * 20,
          trueAmplitudeDb: spectrum[peakBin],
          prominenceDb: 32,
          qEstimate: 24,
          bandwidthHz: 42,
          firstSeenAt: 1000,
          confirmedAt: 1120,
          confirmLatencyMs: 120,
        })
        const track = makeTrack({
          binIndex: peakBin,
          trueAmplitudeDb: spectrum[peakBin],
          prominenceDb: 32,
          onsetTime: 1000,
          lastUpdateTime: timestamp,
          features: {
            stabilityCentsStd: 1,
            meanQ: 24,
            minQ: 20,
            meanVelocityDbPerSec: 0.1,
            maxVelocityDbPerSec: 0.2,
            persistenceMs: frame * 20,
            harmonicityScore: 0.9,
            modulationScore: 0.02,
            noiseSidebandScore: 0.05,
          },
          qEstimate: 24,
          bandwidthHz: 42,
          velocityDbPerSec: 0.1,
          persistenceFrames: frame + 1,
          isPersistent: frame >= 3,
          isHighlyPersistent: frame >= 6,
        })

        engine.updateContentType(spectrum, 12, SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [
          1000,
          2000,
          3000,
          4000,
          5000,
        ])
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          DEFAULT_FUSION_CONFIG,
          track.trueFrequencyHz,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          [1000, 2000, 3000, 4000, 5000],
        )

        maxFeedbackProbability = Math.max(maxFeedbackProbability, fusionResult.feedbackProbability)
        reported ||= shouldReportIssue(classification, settings)
      }

      expect(maxFeedbackProbability).toBeLessThan(0.35)
      expect(reported).toBe(false)
    })

    it('keeps steady chromatic pure tones below the recommendation path', () => {
      const peakBin = Math.round(440 / (SAMPLE_RATE / FFT_SIZE))
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const fusionConfig = buildFusionConfig(settings)
      const combTracker = new CombStabilityTracker()
      const agreementTracker = new AgreementPersistenceTracker()
      let maxFeedbackProbability = 0
      let reported = false

      for (let frame = 0; frame < 20; frame++) {
        const timestamp = 1000 + frame * 80
        const spectrum = makePeakSpectrum(peakBin, -18)
        const peak = makePeak({
          binIndex: peakBin,
          trueFrequencyHz: 440,
          timestamp,
          sustainedMs: 240 + frame * 80,
          trueAmplitudeDb: -18,
          prominenceDb: 34,
          qEstimate: 34,
          bandwidthHz: 22,
          firstSeenAt: 1000,
          confirmedAt: 1240,
          confirmLatencyMs: 240,
          msd: 0.04,
          msdGrowthRate: 0.05,
          msdIsHowl: true,
          msdFastConfirm: true,
          persistenceFrames: 12 + frame,
          isPersistent: true,
          isHighlyPersistent: frame >= 2,
        })
        const track = makeTrack({
          binIndex: peakBin,
          trueFrequencyHz: 440,
          trueAmplitudeDb: -18,
          prominenceDb: 34,
          onsetTime: 1000,
          onsetDb: -18,
          lastUpdateTime: timestamp,
          features: {
            stabilityCentsStd: 1,
            meanQ: 34,
            minQ: 28,
            meanVelocityDbPerSec: 0.05,
            maxVelocityDbPerSec: 0.1,
            persistenceMs: 240 + frame * 80,
            harmonicityScore: 0.04,
            modulationScore: 0.01,
            noiseSidebandScore: 0.02,
          },
          qEstimate: 34,
          bandwidthHz: 22,
          velocityDbPerSec: 0.05,
          persistenceFrames: 12 + frame,
          isPersistent: true,
          isHighlyPersistent: frame >= 2,
        })

        engine.updateContentType(spectrum, crestFactorForSpectrum(spectrum), SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, [440])
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          fusionConfig,
          track.trueFrequencyHz,
          combTracker,
          agreementTracker,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          [440],
        )

        maxFeedbackProbability = Math.max(maxFeedbackProbability, fusionResult.feedbackProbability)
        reported ||= shouldReportIssue(classification, settings)
      }

      expect(maxFeedbackProbability).toBeGreaterThan(0.35)
      expect(reported).toBe(false)
    })

    it('reports clean confirmed feedback quickly at the live active-peak cadence', () => {
      const trackManager = new TrackManager({ historySize: 32 })
      const peakBin = 170
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const fusionConfig = buildFusionConfig(settings)
      const combTracker = new CombStabilityTracker()
      const agreementTracker = new AgreementPersistenceTracker()
      const firstSeenAt = 1000
      const confirmedAt = 1240
      let firstReportAt: number | null = null
      let firstReportPersistenceMs = 0
      let firstReportProbability = 0

      for (let frame = 0; frame < 8; frame++) {
        const timestamp = confirmedAt + frame * 80
        const spectrum = makePeakSpectrum(peakBin, -24)
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: timestamp - firstSeenAt,
          trueAmplitudeDb: -24,
          prominenceDb: 36,
          qEstimate: 40,
          bandwidthHz: 25,
          firstSeenAt,
          confirmedAt,
          confirmLatencyMs: confirmedAt - firstSeenAt,
          msd: 0.02,
          msdGrowthRate: 1.4,
          msdIsHowl: true,
          msdFastConfirm: true,
          persistenceFrames: 12 + frame,
          isPersistent: true,
          isHighlyPersistent: frame >= 2,
        })
        const track = trackManager.processPeak(peak)
        const activeFrequencies = trackManager.getRawTracks().map((activeTrack) => activeTrack.trueFrequencyHz)

        engine.updateContentType(spectrum, crestFactorForSpectrum(spectrum), SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, activeFrequencies)
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          fusionConfig,
          track.trueFrequencyHz,
          combTracker,
          agreementTracker,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          activeFrequencies,
        )

        if (shouldReportIssue(classification, settings)) {
          firstReportAt = timestamp
          firstReportPersistenceMs = classification.persistenceMs ?? 0
          firstReportProbability = fusionResult.feedbackProbability
          break
        }
      }

      expect(firstReportAt).not.toBeNull()
      expect((firstReportAt ?? Infinity) - firstSeenAt).toBeLessThanOrEqual(400)
      expect(firstReportPersistenceMs).toBeGreaterThanOrEqual(240)
      expect(firstReportProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold * 0.6)
    })

    it('reports a detector-produced narrow feedback peak through the worker gate within 240ms', () => {
      const trackManager = new TrackManager({ historySize: 32 })
      const peakBin = 170
      const spectrumFixture = makePeakSpectrum(peakBin, -24)
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const fusionConfig = buildFusionConfig(settings)
      const combTracker = new CombStabilityTracker()
      const agreementTracker = new AgreementPersistenceTracker()
      const { detector, detectedPeaks, analyzeFrame } = createDetectorHarness(
        (array) => array.set(spectrumFixture),
        (array) => array.set(sineFrame),
      )

      for (let frame = 0; frame < 28; frame++) {
        analyzeFrame(1000 + frame * 20, 20)
      }

      const firstPeak = detectedPeaks[0]
      const detectorSpectrum = detector.getSpectrum()
      const detectorTimeDomain = detector.getTimeDomain()
      expect(firstPeak).toBeDefined()
      expect(detectorSpectrum).not.toBeNull()
      expect(detectorTimeDomain).not.toBeNull()
      expect(firstPeak.confirmLatencyMs).toBeLessThanOrEqual(200)
      expect(firstPeak.confirmLatencyMs).toBe((firstPeak.confirmedAt ?? 0) - (firstPeak.firstSeenAt ?? 0))

      let firstReportAt: number | null = null
      let firstReportProbability = 0
      let firstReportPersistenceMs = 0

      for (const peak of detectedPeaks) {
        const track = trackManager.processPeak(peak)
        const activeFrequencies = trackManager.getRawTracks().map((activeTrack) => activeTrack.trueFrequencyHz)

        engine.updateContentType(
          detectorSpectrum!,
          crestFactorForSpectrum(detectorSpectrum!),
          SAMPLE_RATE,
          FFT_SIZE,
        )
        engine.feedFrame(
          peak.timestamp,
          detectorSpectrum!,
          detectorTimeDomain ?? sineFrame,
          150,
          10000,
          SAMPLE_RATE,
          FFT_SIZE,
        )
        const algorithmResult = engine.computeScores(
          peak,
          track,
          detectorSpectrum!,
          SAMPLE_RATE,
          FFT_SIZE,
          activeFrequencies,
        )
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          fusionConfig,
          track.trueFrequencyHz,
          combTracker,
          agreementTracker,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          activeFrequencies,
        )

        if (shouldReportIssue(classification, settings)) {
          firstReportAt = peak.timestamp
          firstReportProbability = fusionResult.feedbackProbability
          firstReportPersistenceMs = classification.persistenceMs ?? 0
          break
        }
      }

      expect(firstReportAt).not.toBeNull()
      expect((firstReportAt ?? Infinity) - (firstPeak.firstSeenAt ?? firstPeak.timestamp)).toBeLessThanOrEqual(240)
      expect((firstReportAt ?? Infinity) - (firstPeak.confirmedAt ?? firstPeak.timestamp)).toBeLessThanOrEqual(80)
      expect(firstReportPersistenceMs).toBeGreaterThanOrEqual(firstPeak.confirmLatencyMs ?? 0)
      expect(firstReportProbability).toBeGreaterThanOrEqual(DEFAULT_FUSION_CONFIG.feedbackThreshold * 0.6)
    })

    it('keeps sustained harmonic music quiet at the live active-peak cadence', () => {
      const trackManager = new TrackManager({ historySize: 32 })
      const peakBin = 170
      const sineFrame = makeStableSineFrame(peakBin)
      const settings = { ...DEFAULT_SETTINGS, mode: 'speech' as const }
      const fusionConfig = buildFusionConfig(settings)
      const combTracker = new CombStabilityTracker()
      const agreementTracker = new AgreementPersistenceTracker()
      let maxFeedbackProbability = 0
      let reported = false
      let sawMusicLikeHarmonics = false

      for (let frame = 0; frame < 20; frame++) {
        const timestamp = 1000 + frame * 80
        const spectrum = makeHarmonicInstrumentSpectrum(peakBin)
        const peak = makePeak({
          binIndex: peakBin,
          timestamp,
          sustainedMs: frame * 80,
          trueAmplitudeDb: spectrum[peakBin],
          prominenceDb: 32,
          qEstimate: 24,
          bandwidthHz: 42,
          firstSeenAt: 1000,
          confirmedAt: 1240,
          confirmLatencyMs: 240,
          msd: 0.04,
          msdGrowthRate: 0.1,
          msdIsHowl: true,
          msdFastConfirm: true,
          persistenceFrames: 12 + frame,
          isPersistent: true,
          isHighlyPersistent: frame >= 2,
        })
        const track = trackManager.processPeak(peak)
        const activeFrequencies = [1000, 2000, 3000, 4000, 5000]

        engine.updateContentType(spectrum, 12, SAMPLE_RATE, FFT_SIZE)
        engine.feedFrame(timestamp, spectrum, sineFrame, 150, 10000, SAMPLE_RATE, FFT_SIZE)
        const algorithmResult = engine.computeScores(peak, track, spectrum, SAMPLE_RATE, FFT_SIZE, activeFrequencies)
        const contentType = engine.getContentType() !== 'unknown'
          ? engine.getContentType()
          : algorithmResult.contentType
        const fusionResult = fuseAlgorithmResults(
          algorithmResult.algorithmScores,
          contentType,
          fusionConfig,
          track.trueFrequencyHz,
          combTracker,
          agreementTracker,
        )
        const classification = classifyTrackWithAlgorithms(
          track,
          algorithmResult.algorithmScores,
          fusionResult,
          settings,
          activeFrequencies,
        )

        sawMusicLikeHarmonics ||= algorithmResult.algorithmScores.ihr?.isMusicLike === true
        maxFeedbackProbability = Math.max(maxFeedbackProbability, fusionResult.feedbackProbability)
        reported ||= shouldReportIssue(classification, settings)
      }

      expect(sawMusicLikeHarmonics).toBe(true)
      expect(maxFeedbackProbability).toBeLessThan(0.35)
      expect(reported).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('engine handles zero-length init gracefully', () => {
      const smallEngine = new AlgorithmEngine()
      // Don't call init — engine should handle uninitialized state
      const spectrum = new Float32Array(64).fill(-60)
      const peak = makePeak({ binIndex: 10 })
      const track = makeTrack({ binIndex: 10 })

      // Should not throw
      expect(() => {
        smallEngine.computeScores(peak, track, spectrum, SAMPLE_RATE, 128, [])
      }).not.toThrow()
    })

    it('fusion handles sparse algorithm scores', () => {
      const scores: AlgorithmScores = buildScores({
        msd: 0.5,
        phase: 0.5,
        spectral: 0.5,
        comb: 0,
        ihr: 0.5,
        ptmr: 0.5,
        msdFrames: 10,
      })

      const result = fuseAlgorithmResults(scores, 'unknown', DEFAULT_FUSION_CONFIG)
      expect(result.feedbackProbability).toBeGreaterThanOrEqual(0)
      expect(result.feedbackProbability).toBeLessThanOrEqual(1)
      expect(Number.isFinite(result.feedbackProbability)).toBe(true)
    })
  })
})
