/**
 * AdvisoryManager — Unit Tests
 *
 * Tests the AdvisoryManager class for advisory creation, updating,
 * frequency proximity dedup, GEQ band dedup, harmonic filtering,
 * rate limiting, band cooldown, clearing, memory bounds, and reset.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AdvisoryManager } from '../advisoryManager'
import type * as MathHelpersModule from '@/lib/utils/mathHelpers'
import type {
  Track,
  TrackFeatures,
  DetectedPeak,
  ClassificationResult,
  EQAdvisory,
  DetectorSettings,
  SeverityLevel,
} from '@/types/advisory'

// ── Mock helpers ─────────────────────────────────────────────────────────────

/** Stable counter for unique IDs in tests */
let idCounter = 0

vi.mock('@/lib/utils/mathHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof MathHelpersModule>()
  return {
    ...actual,
    generateId: () => `test-id-${++idCounter}`,
  }
})

/** Minimal TrackFeatures with sane defaults */
function makeFeatures(overrides: Partial<TrackFeatures> = {}): TrackFeatures {
  return {
    stabilityCentsStd: 2.0,
    meanQ: 30,
    minQ: 20,
    meanVelocityDbPerSec: 5,
    maxVelocityDbPerSec: 10,
    persistenceMs: 500,
    harmonicityScore: 0.1,
    modulationScore: 0.05,
    noiseSidebandScore: 0.02,
    ...overrides,
  }
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: `track-${++idCounter}`,
    binIndex: 100,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -30,
    prominenceDb: 15,
    onsetTime: 1000,
    onsetDb: -35,
    lastUpdateTime: 1500,
    history: [],
    features: makeFeatures(),
    qEstimate: 30,
    bandwidthHz: 33,
    qMeasurementMode: 'full',
    velocityDbPerSec: 5,
    harmonicOfHz: null,
    isSubHarmonicRoot: false,
    isActive: true,
    ...overrides,
  }
}

function makePeak(overrides: Partial<DetectedPeak> = {}): DetectedPeak {
  return {
    binIndex: 100,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -30,
    prominenceDb: 15,
    sustainedMs: 500,
    harmonicOfHz: null,
    timestamp: 10000,
    noiseFloorDb: -80,
    effectiveThresholdDb: -50,
    ...overrides,
  }
}

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    pFeedback: 0.85,
    pWhistle: 0.05,
    pInstrument: 0.05,
    pUnknown: 0.05,
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'RESONANCE',
    confidence: 0.85,
    fusionVerdict: 'FEEDBACK',
    recommendationEligible: true,
    reasons: ['High phase coherence', 'Sustained peak'],
    ...overrides,
  }
}

function makeEQAdvisory(overrides: Partial<EQAdvisory> = {}): EQAdvisory {
  return {
    geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 },
    peq: { type: 'bell', hz: 1000, q: 8, gainDb: -6 },
    shelves: [],
    pitch: { note: 'B', octave: 4, cents: -14, midi: 71 },
    ...overrides,
  }
}

function makeSettings(overrides: Partial<DetectorSettings> = {}): DetectorSettings {
  return {
    mode: 'speech',
    fftSize: 8192,
    smoothingTimeConstant: 0.3,
    minFrequency: 150,
    maxFrequency: 10000,
    feedbackThresholdDb: 27,
    ringThresholdDb: 2,
    growthRateThreshold: 3,
    peakMergeCents: 100,
    maxDisplayedIssues: 8,
    eqPreset: 'surgical',
    inputGainDb: 0,
    autoGainEnabled: false,
    autoGainTargetDb: -18,
    graphFontSize: 15,
    harmonicToleranceCents: 200,
    showTooltips: true,
    aWeightingEnabled: true,
    confidenceThreshold: 0.35,
    algorithmMode: 'auto',
    enabledAlgorithms: ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr'],
    adaptivePhaseSkip: true,
    showAlgorithmScores: false,
    showPeqDetails: true,
    showFreqZones: false,
    spectrumWarmMode: false,
    spectrumSmoothingMode: 'raw',
    sustainMs: 300,
    clearMs: 400,
    thresholdMode: 'hybrid',
    prominenceDb: 12,
    noiseFloorAttackMs: 200,
    noiseFloorReleaseMs: 1000,
    maxTracks: 64,
    trackTimeoutMs: 1000,
    ignoreWhistle: true,
    rtaDbMin: -100,
    rtaDbMax: 0,
    spectrumLineWidth: 1.5,
    showThresholdLine: true,
    canvasTargetFps: 30,
    faderMode: 'sensitivity',
    faderLinkMode: 'unlinked',
    faderLinkRatio: 1.0,
    faderLinkCenterGainDb: 0,
    faderLinkCenterSensDb: 25,
    signalTintEnabled: true,
    mainsHumEnabled: true,
    mainsHumFundamental: 'auto' as const,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AdvisoryManager', () => {
  let mgr: AdvisoryManager
  let settings: DetectorSettings

  beforeEach(() => {
    mgr = new AdvisoryManager()
    settings = makeSettings()
    idCounter = 0
  })

  // ── 1. Advisory creation ─────────────────────────────────────────────────

  describe('advisory creation', () => {
    it('creates a new advisory for a new track', () => {
      const track = makeTrack({ id: 'track-new' })
      const peak = makePeak({ timestamp: 10000 })
      const classification = makeClassification()
      const eq = makeEQAdvisory()

      const actions = mgr.createOrUpdate(track, peak, classification, eq, settings)

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
      const advisory = (actions[0] as { type: 'advisory'; advisory: { id: string; trackId: string; severity: string; trueFrequencyHz: number } }).advisory
      expect(advisory.trackId).toBe('track-new')
      expect(advisory.severity).toBe('RESONANCE')
      expect(advisory.trueFrequencyHz).toBe(1000)
    })

    it('preserves detector confirmation timing on new advisories', () => {
      const track = makeTrack({ id: 'track-latency' })
      const peak = makePeak({
        timestamp: 10000,
        firstSeenAt: 9860,
        confirmedAt: 10000,
        confirmLatencyMs: 140,
      })

      const actions = mgr.createOrUpdate(
        track,
        peak,
        makeClassification(),
        makeEQAdvisory(),
        settings,
      )

      expect(actions).toHaveLength(1)
      const advisory = (actions[0] as { type: 'advisory'; advisory: { firstSeenAt?: number; confirmedAt?: number; confirmLatencyMs?: number } }).advisory
      expect(advisory.firstSeenAt).toBe(9860)
      expect(advisory.confirmedAt).toBe(10000)
      expect(advisory.confirmLatencyMs).toBe(140)
    })

    it('maps track ID to advisory ID after creation', () => {
      const track = makeTrack({ id: 'track-a' })
      const peak = makePeak({ timestamp: 10000 })

      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      expect(mgr.getAdvisoryIdForTrack('track-a')).toBeDefined()
    })

    it('returns undefined for unknown track ID', () => {
      expect(mgr.getAdvisoryIdForTrack('nonexistent')).toBeUndefined()
    })

    it('populates all advisory fields from track and classification', () => {
      const track = makeTrack({
        id: 'track-full',
        trueFrequencyHz: 2500,
        trueAmplitudeDb: -25,
        prominenceDb: 18,
        qEstimate: 40,
        bandwidthHz: 62.5,
        phpr: 12,
        velocityDbPerSec: 8,
        features: makeFeatures({
          stabilityCentsStd: 1.5,
          harmonicityScore: 0.2,
          modulationScore: 0.03,
        }),
      })
      const classification = makeClassification({
        label: 'ACOUSTIC_FEEDBACK',
        severity: 'GROWING',
        confidence: 0.92,
        reasons: ['High MSD', 'Fast growth'],
        modalOverlapFactor: 0.05,
        cumulativeGrowthDb: 8,
        frequencyBand: 'HIGH',
      })
      const peak = makePeak({ timestamp: 20000 })
      const eq = makeEQAdvisory()

      const actions = mgr.createOrUpdate(track, peak, classification, eq, settings)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adv = (actions[0] as any).advisory

      expect(adv.trueFrequencyHz).toBe(2500)
      expect(adv.trueAmplitudeDb).toBe(-25)
      expect(adv.prominenceDb).toBe(18)
      expect(adv.qEstimate).toBe(40)
      expect(adv.bandwidthHz).toBe(62.5)
      expect(adv.phpr).toBe(12)
      expect(adv.velocityDbPerSec).toBe(8)
      expect(adv.stabilityCentsStd).toBe(1.5)
      expect(adv.harmonicityScore).toBe(0.2)
      expect(adv.modulationScore).toBe(0.03)
      expect(adv.severity).toBe('GROWING')
      expect(adv.confidence).toBe(0.92)
      expect(adv.modalOverlapFactor).toBe(0.05)
      expect(adv.cumulativeGrowthDb).toBe(8)
      expect(adv.frequencyBand).toBe('HIGH')
    })
  })

  // ── 2. Advisory updating ─────────────────────────────────────────────────

  describe('advisory updating (existing track)', () => {
    it('updates advisory in-place when the same track reports again', () => {
      const track = makeTrack({ id: 'track-upd' })
      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      const actions1 = mgr.createOrUpdate(track, peak1, makeClassification({ severity: 'RESONANCE' }), makeEQAdvisory(), settings)
      const id1 = (actions1[0] as { type: 'advisory'; advisory: { id: string } }).advisory.id

      // Update the same track with higher severity
      const actions2 = mgr.createOrUpdate(
        track, peak2,
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory(), settings,
      )

      expect(actions2).toHaveLength(1)
      expect(actions2[0].type).toBe('advisory')
      const adv2 = (actions2[0] as { type: 'advisory'; advisory: { id: string; severity: string; timestamp: number } }).advisory
      // Same advisory ID reused
      expect(adv2.id).toBe(id1)
      // Updated severity
      expect(adv2.severity).toBe('GROWING')
      // Updated timestamp
      expect(adv2.timestamp).toBe(11000)
    })

    it('existing track update bypasses rate limiting', () => {
      const track = makeTrack({ id: 'track-rl-upd' })
      const peak1 = makePeak({ timestamp: 10000 })
      // Only 100ms later — would be rate-limited for new advisory
      const peak2 = makePeak({ timestamp: 10100 })

      mgr.createOrUpdate(track, peak1, makeClassification(), makeEQAdvisory(), settings)
      const actions2 = mgr.createOrUpdate(track, peak2, makeClassification({ severity: 'GROWING' }), makeEQAdvisory(), settings)

      // Should still produce an update (not be rate-limited)
      expect(actions2).toHaveLength(1)
      expect(actions2[0].type).toBe('advisory')
    })

    it('removes the previous GEQ band mapping when an updated advisory changes bands', () => {
      const initialTrack = makeTrack({ id: 'track-band-shift', trueFrequencyHz: 1000 })
      const shiftedTrack = makeTrack({ id: 'track-band-shift', trueFrequencyHz: 1250 })
      const oldBandEq = makeEQAdvisory({
        geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 },
      })
      const newBandEq = makeEQAdvisory({
        geq: { bandHz: 1250, bandIndex: 16, suggestedDb: -6 },
        peq: { type: 'bell', hz: 1250, q: 8, gainDb: -6 },
      })

      mgr.createOrUpdate(
        initialTrack,
        makePeak({ timestamp: 10000 }),
        makeClassification(),
        oldBandEq,
        settings,
      )

      mgr.createOrUpdate(
        shiftedTrack,
        makePeak({ timestamp: 11000, trueFrequencyHz: 1250 }),
        makeClassification(),
        newBandEq,
        settings,
      )

      const newTrack = makeTrack({
        id: 'track-old-band',
        trueFrequencyHz: 1000,
      })
      const actions = mgr.createOrUpdate(
        newTrack,
        makePeak({ timestamp: 12050 }),
        makeClassification(),
        oldBandEq,
        makeSettings({ peakMergeCents: 0 }),
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
      expect(mgr.getAdvisoryIdForTrack('track-band-shift')).toBeDefined()
      expect(mgr.getAdvisoryIdForTrack('track-old-band')).toBeDefined()
      expect(mgr.getAdvisoryIdForTrack('track-old-band')).not.toBe(
        mgr.getAdvisoryIdForTrack('track-band-shift'),
      )
    })
  })

  // ── 3. Frequency proximity dedup ─────────────────────────────────────────

  describe('frequency proximity dedup', () => {
    it('merges a new track into an existing advisory when within peakMergeCents', () => {
      const track1 = makeTrack({ id: 'track-f1', trueFrequencyHz: 1000, trueAmplitudeDb: -25 })
      const track2 = makeTrack({ id: 'track-f2', trueFrequencyHz: 1050, trueAmplitudeDb: -30 })
      // 1050/1000 = 83 cents — within default 100 cents merge window

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      mgr.createOrUpdate(track1, peak1, makeClassification({ severity: 'GROWING' }), makeEQAdvisory(), settings)

      // track2 is nearby and less urgent/loud → absorbed into existing
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'RESONANCE' }), // lower urgency
        makeEQAdvisory(),
        settings,
      )

      expect(actions2).toHaveLength(1)
      const adv = (actions2[0] as {
        type: 'advisory'
        advisory: {
          clusterCount: number
          trackId: string
          advisory: { peq: { strategy?: string; reason?: string; qSource?: string } }
        }
      }).advisory
      expect(adv.clusterCount).toBe(2) // merged
      // Original track1's advisory is updated
      expect(adv.trackId).toBe('track-f1')
      expect(adv.advisory.peq.strategy).toBe('broad-region')
      expect(adv.advisory.peq.qSource).toBe('cluster')
      expect(adv.advisory.peq.reason).toMatch(/broader unstable region/i)
    })

    it('supersedes existing advisory when new peak is more urgent', () => {
      const track1 = makeTrack({ id: 'track-s1', trueFrequencyHz: 1000, trueAmplitudeDb: -30 })
      const track2 = makeTrack({ id: 'track-s2', trueFrequencyHz: 1050, trueAmplitudeDb: -20 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      const actions1 = mgr.createOrUpdate(track1, peak1, makeClassification({ severity: 'RESONANCE' }), makeEQAdvisory(), settings)
      const oldId = (actions1[0] as { type: 'advisory'; advisory: { id: string } }).advisory.id

      // track2 is more urgent → supersedes
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'RUNAWAY' }),
        makeEQAdvisory(),
        settings,
      )

      // Should clear the old advisory and create a new one
      const clearAction = actions2.find(a => a.type === 'advisoryCleared')
      const advisoryAction = actions2.find(a => a.type === 'advisory')
      expect(clearAction).toBeDefined()
      expect((clearAction as { advisoryId: string }).advisoryId).toBe(oldId)
      expect(advisoryAction).toBeDefined()
      const newAdv = (advisoryAction as { type: 'advisory'; advisory: { trackId: string; clusterCount: number } }).advisory
      expect(newAdv.trackId).toBe('track-s2')
      expect(newAdv.clusterCount).toBe(2) // carried cluster count forward
    })

    it('cleans up absorbed track mappings when a merged advisory is superseded', () => {
      const track1 = makeTrack({ id: 'track-sup-1', trueFrequencyHz: 1000, trueAmplitudeDb: -25 })
      const track2 = makeTrack({ id: 'track-sup-2', trueFrequencyHz: 1050, trueAmplitudeDb: -30 })
      const track3 = makeTrack({ id: 'track-sup-3', trueFrequencyHz: 1045, trueAmplitudeDb: -20 })

      mgr.createOrUpdate(
        track1,
        makePeak({ timestamp: 10000 }),
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory(),
        settings,
      )

      mgr.createOrUpdate(
        track2,
        makePeak({ timestamp: 11000, trueFrequencyHz: 1050 }),
        makeClassification({ severity: 'RESONANCE' }),
        makeEQAdvisory(),
        settings,
      )

      const actions = mgr.createOrUpdate(
        track3,
        makePeak({ timestamp: 12000, trueFrequencyHz: 1045 }),
        makeClassification({ severity: 'RUNAWAY' }),
        makeEQAdvisory(),
        settings,
      )

      expect(actions.some((action) => action.type === 'advisoryCleared')).toBe(true)
      expect(mgr.getAdvisoryIdForTrack('track-sup-1')).toBeUndefined()
      expect(mgr.getAdvisoryIdForTrack('track-sup-2')).toBeUndefined()
      expect(mgr.getAdvisoryIdForTrack('track-sup-3')).toBeDefined()
    })

    it('does not dedup tracks that are far apart in frequency', () => {
      const track1 = makeTrack({ id: 'track-d1', trueFrequencyHz: 1000 })
      const track2 = makeTrack({ id: 'track-d2', trueFrequencyHz: 2000 })
      // 2000/1000 = 1200 cents — well beyond 100 cents merge

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 2000, bandIndex: 20, suggestedDb: -6 } }),
        settings,
      )

      // Should create a separate advisory, not merge
      expect(actions2).toHaveLength(1)
      expect(actions2[0].type).toBe('advisory')
      const adv = (actions2[0] as { type: 'advisory'; advisory: { trackId: string; clusterCount?: number } }).advisory
      expect(adv.trackId).toBe('track-d2')
      expect(adv.clusterCount).toBeUndefined() // not merged
    })

    it('merges into the nearest existing advisory when multiple advisories are within tolerance', () => {
      const noRateLimitGap = makeSettings({ peakMergeCents: 100 })
      const lowTrack = makeTrack({ id: 'track-near-low', trueFrequencyHz: 1000, trueAmplitudeDb: -24 })
      const highTrack = makeTrack({ id: 'track-near-high', trueFrequencyHz: 1090, trueAmplitudeDb: -23 })
      const incomingTrack = makeTrack({ id: 'track-near-new', trueFrequencyHz: 1088, trueAmplitudeDb: -30 })

      mgr.createOrUpdate(
        lowTrack,
        makePeak({ timestamp: 10000, trueFrequencyHz: 1000 }),
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        noRateLimitGap,
      )

      mgr.createOrUpdate(
        highTrack,
        makePeak({ timestamp: 10300, trueFrequencyHz: 1090 }),
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory({ geq: { bandHz: 1120, bandIndex: 16, suggestedDb: -6 } }),
        noRateLimitGap,
      )

      const actions = mgr.createOrUpdate(
        incomingTrack,
        makePeak({ timestamp: 10600, trueFrequencyHz: 1088 }),
        makeClassification({ severity: 'RESONANCE' }),
        makeEQAdvisory({ geq: { bandHz: 1120, bandIndex: 16, suggestedDb: -6 } }),
        noRateLimitGap,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
      const advisory = (actions[0] as { type: 'advisory'; advisory: { trackId: string; clusterCount: number } }).advisory
      expect(advisory.trackId).toBe('track-near-high')
      expect(advisory.clusterCount).toBe(2)
    })
  })

  // ── 4. GEQ band dedup ────────────────────────────────────────────────────

  describe('GEQ band dedup', () => {
    it('merges when two tracks share the same GEQ band index', () => {
      const track1 = makeTrack({ id: 'track-b1', trueFrequencyHz: 980, trueAmplitudeDb: -25 })
      const track2 = makeTrack({ id: 'track-b2', trueFrequencyHz: 1020, trueAmplitudeDb: -30 })
      // Different frequencies but same GEQ band index (15)

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      // Use wide peakMergeCents=0 to disable frequency dedup so band dedup triggers
      const narrowSettings = makeSettings({ peakMergeCents: 0 })
      const sameEqBand = makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } })

      mgr.createOrUpdate(track1, peak1, makeClassification({ severity: 'GROWING' }), sameEqBand, narrowSettings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'RESONANCE' }), // lower urgency
        sameEqBand,
        narrowSettings,
      )

      expect(actions2).toHaveLength(1)
      const adv = (actions2[0] as { type: 'advisory'; advisory: { clusterCount: number } }).advisory
      expect(adv.clusterCount).toBe(2) // merged via band dedup
    })
  })

  // ── 5. Harmonic filtering ────────────────────────────────────────────────

  describe('isHarmonicOfExisting', () => {
    it('returns true when new frequency is an overtone of existing advisory', () => {
      const track = makeTrack({ id: 'track-h1', trueFrequencyHz: 500 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      // 1000 Hz is 2nd harmonic of 500 Hz (0 cents difference)
      expect(mgr.isHarmonicOfExisting(1000, settings)).toBe(true)
      // 1500 Hz is 3rd harmonic of 500 Hz
      expect(mgr.isHarmonicOfExisting(1500, settings)).toBe(true)
      // 2000 Hz is 4th harmonic
      expect(mgr.isHarmonicOfExisting(2000, settings)).toBe(true)
    })

    it('returns true for near-harmonic within tolerance', () => {
      const track = makeTrack({ id: 'track-h2', trueFrequencyHz: 440 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      // 882 Hz is close to 2nd harmonic (880 Hz), 4 cents off
      expect(mgr.isHarmonicOfExisting(882, settings)).toBe(true)
    })

    it('returns false when frequency is not a harmonic of any existing', () => {
      const track = makeTrack({ id: 'track-h3', trueFrequencyHz: 440 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      // 700 Hz is not a harmonic of 440 Hz
      expect(mgr.isHarmonicOfExisting(700, settings)).toBe(false)
    })

    it('returns false when no advisories exist', () => {
      expect(mgr.isHarmonicOfExisting(1000, settings)).toBe(false)
    })

    it('does not suppress fundamentals (sub-harmonic check removed)', () => {
      const track = makeTrack({ id: 'track-h4', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      // 500 Hz is the fundamental of 1000 Hz — should NOT be suppressed
      expect(mgr.isHarmonicOfExisting(500, settings)).toBe(false)
    })

    it('respects harmonicToleranceCents setting', () => {
      const track = makeTrack({ id: 'track-h5', trueFrequencyHz: 440 })
      const peak = makePeak({ timestamp: 10000 })
      const tightSettings = makeSettings({ harmonicToleranceCents: 5 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), tightSettings)

      // 882 Hz is ~4 cents off from 880 Hz (2nd harmonic) — within 5 cents
      expect(mgr.isHarmonicOfExisting(882, tightSettings)).toBe(true)
      // 890 Hz is ~20 cents off — outside 5 cents
      expect(mgr.isHarmonicOfExisting(890, tightSettings)).toBe(false)
    })
  })

  // ── 6. Rate limiting ─────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('does not rate-limit the first advisory in a fresh analyzer run', () => {
      const track = makeTrack({ id: 'track-first-fast', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 120 })

      const actions = mgr.createOrUpdate(
        track,
        peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
    })

    it('blocks new advisory within 200ms of last creation', () => {
      const track1 = makeTrack({ id: 'track-rl1', trueFrequencyHz: 1000 })
      const track2 = makeTrack({ id: 'track-rl2', trueFrequencyHz: 3000 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 10100 }) // Only 100ms later

      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'RESONANCE' }),
        makeEQAdvisory({ geq: { bandHz: 3000, bandIndex: 25, suggestedDb: -6 } }),
        settings,
      )

      // Should be rate-limited → empty actions
      expect(actions2).toHaveLength(0)
    })

    it('allows new advisory after 500ms', () => {
      const track1 = makeTrack({ id: 'track-rl3', trueFrequencyHz: 1000 })
      const track2 = makeTrack({ id: 'track-rl4', trueFrequencyHz: 3000 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 10600 }) // 600ms later — past rate limit

      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 3000, bandIndex: 25, suggestedDb: -6 } }),
        settings,
      )

      expect(actions2).toHaveLength(1)
      expect(actions2[0].type).toBe('advisory')
    })

    it('RUNAWAY severity bypasses rate limiting', () => {
      const track1 = makeTrack({ id: 'track-rl5', trueFrequencyHz: 1000 })
      const track2 = makeTrack({ id: 'track-rl6', trueFrequencyHz: 3000 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 10100 }) // Only 100ms later

      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'RUNAWAY' }),
        makeEQAdvisory({ geq: { bandHz: 3000, bandIndex: 25, suggestedDb: -6 } }),
        settings,
      )

      expect(actions2).toHaveLength(1)
      expect(actions2[0].type).toBe('advisory')
    })

    it('GROWING severity bypasses rate limiting', () => {
      const track1 = makeTrack({ id: 'track-rl7', trueFrequencyHz: 1000 })
      const track2 = makeTrack({ id: 'track-rl8', trueFrequencyHz: 3000 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 10100 })

      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory({ geq: { bandHz: 3000, bandIndex: 25, suggestedDb: -6 } }),
        settings,
      )

      expect(actions2).toHaveLength(1)
    })
  })

  // ── 7. Band cooldown ─────────────────────────────────────────────────────

  describe('band cooldown', () => {
    it('blocks advisory creation when band is in cooldown', () => {
      // Set cooldown on band 15
      mgr.setBandCooldown(15, 10000)

      const track = makeTrack({ id: 'track-cd1', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10200 }) // Only 200ms after cooldown (within 500ms)

      const actions = mgr.createOrUpdate(
        track, peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(0)
    })

    it('allows advisory after cooldown expires', () => {
      mgr.setBandCooldown(15, 10000)

      const track = makeTrack({ id: 'track-cd2', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 12000 }) // 2000ms after cooldown set (> 1500ms)

      const actions = mgr.createOrUpdate(
        track, peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
    })

    it('pruneBandCooldowns removes expired cooldowns', () => {
      mgr.setBandCooldown(15, 10000)
      mgr.setBandCooldown(20, 10000)

      // 1001ms after cooldown set — greater than BAND_COOLDOWN_MS * 2 = 1000ms
      mgr.pruneBandCooldowns(11001)

      // Now creating an advisory in band 15 should work even if timestamp would be in cooldown
      const track = makeTrack({ id: 'track-cd3', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 13001 })

      const actions = mgr.createOrUpdate(
        track, peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
    })

    it('pruneBandCooldowns keeps recent cooldowns', () => {
      mgr.setBandCooldown(15, 10000)

      // Only 300ms after — still within BAND_COOLDOWN_MS * 2 = 1000ms
      mgr.pruneBandCooldowns(10300)

      const track = makeTrack({ id: 'track-cd4', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10300 })

      const actions = mgr.createOrUpdate(
        track, peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(0) // still in cooldown
    })
  })

  // ── 8. clearByFrequency ──────────────────────────────────────────────────

  describe('clearByFrequency', () => {
    it('clears advisory within 100 cents of given frequency', () => {
      const track = makeTrack({ id: 'track-cf1', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      const advisoryId = mgr.getAdvisoryIdForTrack('track-cf1')!
      // 1050 Hz is ~83 cents from 1000 Hz — within 100 cents tolerance
      const cleared = mgr.clearByFrequency(1050, 20000)

      expect(cleared).toBe(advisoryId)
      // Track mapping should also be removed
      expect(mgr.getAdvisoryIdForTrack('track-cf1')).toBeUndefined()
    })

    it('returns null when no advisory is within tolerance', () => {
      const track = makeTrack({ id: 'track-cf2', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      // 2000 Hz is 1200 cents from 1000 Hz — way outside tolerance
      const cleared = mgr.clearByFrequency(2000, 20000)
      expect(cleared).toBeNull()
    })

    it('sets band cooldown after clearing', () => {
      const track = makeTrack({ id: 'track-cf3', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)

      mgr.clearByFrequency(1000, 20000)

      // Now trying to create in same band should be blocked by cooldown
      const track2 = makeTrack({ id: 'track-cf4', trueFrequencyHz: 1010 })
      const peak2 = makePeak({ timestamp: 20200 }) // 200ms after clear — within 500ms cooldown

      const actions = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(0)
    })

    it('removes all absorbed track mappings when clearing a merged advisory by frequency', () => {
      const track1 = makeTrack({ id: 'track-cf-merged-1', trueFrequencyHz: 1000, trueAmplitudeDb: -25 })
      const track2 = makeTrack({ id: 'track-cf-merged-2', trueFrequencyHz: 1050, trueAmplitudeDb: -30 })

      mgr.createOrUpdate(
        track1,
        makePeak({ timestamp: 10000 }),
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory(),
        settings,
      )
      mgr.createOrUpdate(
        track2,
        makePeak({ timestamp: 11000, trueFrequencyHz: 1050 }),
        makeClassification({ severity: 'RESONANCE' }),
        makeEQAdvisory(),
        settings,
      )

      mgr.clearByFrequency(1000, 20000)

      expect(mgr.getAdvisoryIdForTrack('track-cf-merged-1')).toBeUndefined()
      expect(mgr.getAdvisoryIdForTrack('track-cf-merged-2')).toBeUndefined()
    })

    it('clears the nearest advisory when multiple advisories are within tolerance', () => {
      mgr.createOrUpdate(
        makeTrack({ id: 'track-cf-near-1', trueFrequencyHz: 1000 }),
        makePeak({ timestamp: 10000, trueFrequencyHz: 1000 }),
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        makeSettings({ peakMergeCents: 0 }),
      )

      mgr.createOrUpdate(
        makeTrack({ id: 'track-cf-near-2', trueFrequencyHz: 1085 }),
        makePeak({ timestamp: 10300, trueFrequencyHz: 1085 }),
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1120, bandIndex: 16, suggestedDb: -6 } }),
        makeSettings({ peakMergeCents: 0 }),
      )

      const expectedId = mgr.getAdvisoryIdForTrack('track-cf-near-2')
      const cleared = mgr.clearByFrequency(1082, 20000)

      expect(cleared).toBe(expectedId)
      expect(mgr.getAdvisoryIdForTrack('track-cf-near-1')).toBeDefined()
      expect(mgr.getAdvisoryIdForTrack('track-cf-near-2')).toBeUndefined()
    })
  })

  // ── 9. clearForTrack ─────────────────────────────────────────────────────

  describe('clearForTrack', () => {
    it('clears advisory associated with the given track ID', () => {
      const track = makeTrack({ id: 'track-ct1', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      const advisoryId = mgr.getAdvisoryIdForTrack('track-ct1')!
      const cleared = mgr.clearForTrack('track-ct1')

      expect(cleared).toBe(advisoryId)
      expect(mgr.getAdvisoryIdForTrack('track-ct1')).toBeUndefined()
    })

    it('returns null when track has no advisory', () => {
      const cleared = mgr.clearForTrack('nonexistent-track')
      expect(cleared).toBeNull()
    })

    it('removes GEQ band mapping when clearing', () => {
      const track1 = makeTrack({ id: 'track-ct2', trueFrequencyHz: 1000 })
      const peak1 = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }), settings)

      mgr.clearForTrack('track-ct2')

      // Now a different track in the same band should not trigger band dedup
      const track2 = makeTrack({ id: 'track-ct3', trueFrequencyHz: 1010 })
      const peak2 = makePeak({ timestamp: 11000 })
      const actions = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
      const adv = (actions[0] as { type: 'advisory'; advisory: { clusterCount?: number } }).advisory
      expect(adv.clusterCount).toBeUndefined() // fresh advisory, not merged
    })

    it('removes absorbed track mappings when clearing by the primary track', () => {
      const track1 = makeTrack({ id: 'track-ct-merged-1', trueFrequencyHz: 1000, trueAmplitudeDb: -25 })
      const track2 = makeTrack({ id: 'track-ct-merged-2', trueFrequencyHz: 1050, trueAmplitudeDb: -30 })

      mgr.createOrUpdate(
        track1,
        makePeak({ timestamp: 10000 }),
        makeClassification({ severity: 'GROWING' }),
        makeEQAdvisory(),
        settings,
      )
      mgr.createOrUpdate(
        track2,
        makePeak({ timestamp: 11000, trueFrequencyHz: 1050 }),
        makeClassification({ severity: 'RESONANCE' }),
        makeEQAdvisory(),
        settings,
      )

      mgr.clearForTrack('track-ct-merged-1')

      expect(mgr.getAdvisoryIdForTrack('track-ct-merged-1')).toBeUndefined()
      expect(mgr.getAdvisoryIdForTrack('track-ct-merged-2')).toBeUndefined()
    })

    it('does not clear an existing advisory on a brief report-gate miss', () => {
      const track = makeTrack({ id: 'track-ct-grace', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)

      const advisoryId = mgr.getAdvisoryIdForTrack('track-ct-grace')!

      expect(mgr.clearForTrackAfterReportGateMiss('track-ct-grace', 10100, 1200)).toBeNull()
      expect(mgr.getAdvisoryIdForTrack('track-ct-grace')).toBe(advisoryId)

      expect(mgr.clearForTrackAfterReportGateMiss('track-ct-grace', 11250, 1200)).toBeNull()
      expect(mgr.getAdvisoryIdForTrack('track-ct-grace')).toBe(advisoryId)

      const cleared = mgr.clearForTrackAfterReportGateMiss('track-ct-grace', 11301, 1200)
      expect(cleared).toBe(advisoryId)
      expect(mgr.getAdvisoryIdForTrack('track-ct-grace')).toBeUndefined()
    })
  })

  // ── 10. Memory bounds ────────────────────────────────────────────────────

  describe('memory bounds (MAX_ADVISORIES = 200)', () => {
    it('prunes oldest advisory when exceeding 200', () => {
      // Disable frequency proximity dedup so each track gets its own advisory
      const noDedup = makeSettings({ peakMergeCents: 0 })

      for (let i = 0; i < 200; i++) {
        const track = makeTrack({
          id: `track-mem-${i}`,
          trueFrequencyHz: 200 + i * 50,
        })
        const peak = makePeak({ timestamp: 10000 + i * 1000 })
        mgr.createOrUpdate(
          track, peak,
          makeClassification(),
          makeEQAdvisory({ geq: { bandHz: 200 + i * 50, bandIndex: i, suggestedDb: -6 } }),
          noDedup,
        )
      }

      // Verify the first track's advisory still exists at this point
      expect(mgr.getAdvisoryIdForTrack('track-mem-0')).toBeDefined()

      // Add one more — should prune the oldest (track-mem-0)
      const overflowTrack = makeTrack({
        id: 'track-mem-overflow',
        trueFrequencyHz: 15000,
      })
      const overflowPeak = makePeak({ timestamp: 10000 + 200 * 1000 })
      const actions = mgr.createOrUpdate(
        overflowTrack, overflowPeak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 15000, bandIndex: 200, suggestedDb: -6 } }),
        noDedup,
      )

      // Should include both the pruned advisory clear and the new advisory
      const clearAction = actions.find(a => a.type === 'advisoryCleared')
      expect(clearAction).toBeDefined()

      const advisoryAction = actions.find(a => a.type === 'advisory')
      expect(advisoryAction).toBeDefined()

      // The oldest advisory's track mapping should be gone
      expect(mgr.getAdvisoryIdForTrack('track-mem-0')).toBeUndefined()
    })
  })

  // ── 11. reset() ──────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all state', () => {
      const track = makeTrack({ id: 'track-rst', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track, peak, makeClassification(), makeEQAdvisory(), settings)
      mgr.setBandCooldown(15, 10000)

      expect(mgr.getAdvisoryIdForTrack('track-rst')).toBeDefined()

      mgr.reset()

      expect(mgr.getAdvisoryIdForTrack('track-rst')).toBeUndefined()
      expect(mgr.isHarmonicOfExisting(2000, settings)).toBe(false)
    })

    it('allows new advisory creation after reset without rate limit from previous state', () => {
      const track1 = makeTrack({ id: 'track-rst2', trueFrequencyHz: 1000 })
      const peak1 = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(track1, peak1, makeClassification(), makeEQAdvisory(), settings)

      mgr.reset()

      // Immediately create — should not be rate limited since lastAdvisoryCreatedAt is reset
      const track2 = makeTrack({ id: 'track-rst3', trueFrequencyHz: 2000 })
      const peak2 = makePeak({ timestamp: 10100 }) // Would have been within rate limit
      const actions = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 2000, bandIndex: 20, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
    })

    it('clears band cooldowns after reset', () => {
      mgr.setBandCooldown(15, 10000)
      mgr.reset()

      const track = makeTrack({ id: 'track-rst4', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10500 }) // Would have been in cooldown

      const actions = mgr.createOrUpdate(
        track, peak,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles clearByFrequency on empty manager', () => {
      expect(mgr.clearByFrequency(1000, 10000)).toBeNull()
    })

    it('handles clearForTrack on empty manager', () => {
      expect(mgr.clearForTrack('nonexistent')).toBeNull()
    })

    it('handles isHarmonicOfExisting on empty manager', () => {
      expect(mgr.isHarmonicOfExisting(1000, settings)).toBe(false)
    })

    it('frequency proximity dedup: equal urgency and louder new peak supersedes', () => {
      const track1 = makeTrack({ id: 'track-eq1', trueFrequencyHz: 1000, trueAmplitudeDb: -30 })
      const track2 = makeTrack({ id: 'track-eq2', trueFrequencyHz: 1050, trueAmplitudeDb: -20 })

      const peak1 = makePeak({ timestamp: 10000 })
      const peak2 = makePeak({ timestamp: 11000 })

      const sev: SeverityLevel = 'RESONANCE'
      mgr.createOrUpdate(track1, peak1, makeClassification({ severity: sev }), makeEQAdvisory(), settings)
      const actions2 = mgr.createOrUpdate(
        track2, peak2,
        makeClassification({ severity: sev }), // same severity, but louder
        makeEQAdvisory(),
        settings,
      )

      // New is louder with same urgency → supersedes
      const clearAction = actions2.find(a => a.type === 'advisoryCleared')
      expect(clearAction).toBeDefined()
    })

    it('clearByFrequency cleans up band-by-band mapping', () => {
      const track = makeTrack({ id: 'track-bb', trueFrequencyHz: 1000 })
      const peak = makePeak({ timestamp: 10000 })
      mgr.createOrUpdate(
        track, peak, makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      mgr.clearByFrequency(1000, 20000)

      // After clearing, a new track in the same band should create fresh (not dedup)
      // Wait for cooldown to expire
      const track2 = makeTrack({ id: 'track-bb2', trueFrequencyHz: 1010 })
      const peak2 = makePeak({ timestamp: 22000 }) // past cooldown
      const actions = mgr.createOrUpdate(
        track2, peak2,
        makeClassification(),
        makeEQAdvisory({ geq: { bandHz: 1000, bandIndex: 15, suggestedDb: -6 } }),
        settings,
      )

      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('advisory')
    })
  })
})
