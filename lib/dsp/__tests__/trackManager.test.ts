import { describe, it, expect, beforeEach } from 'vitest'
import { TrackManager } from '@/lib/dsp/trackManager'
import type { DetectedPeak } from '@/types/advisory'

/** Helper to create a minimal valid DetectedPeak */
function makePeak(overrides: Partial<DetectedPeak> = {}): DetectedPeak {
  return {
    binIndex: 100,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -20,
    prominenceDb: 12,
    sustainedMs: 200,
    harmonicOfHz: null,
    timestamp: Date.now(),
    noiseFloorDb: -80,
    effectiveThresholdDb: -40,
    ...overrides,
  }
}

describe('TrackManager', () => {
  let tm: TrackManager

  beforeEach(() => {
    tm = new TrackManager({
      maxTracks: 10,
      historySize: 32,
      associationToleranceCents: 100,
      trackTimeoutMs: 1000,
    })
  })

  // ================================================================
  // Track creation
  // ================================================================
  describe('processPeak — new track creation', () => {
    it('creates a track from a new peak', () => {
      const peak = makePeak({ binIndex: 50, trueFrequencyHz: 440, timestamp: 1000 })
      const track = tm.processPeak(peak)

      expect(track).toBeDefined()
      expect(track.id).toBeTruthy()
      expect(track.binIndex).toBe(50)
      expect(track.trueFrequencyHz).toBe(440)
      expect(track.trueAmplitudeDb).toBe(-20)
      expect(track.prominenceDb).toBe(12)
      expect(track.onsetTime).toBe(1000)
      expect(track.isActive).toBe(true)
      expect(track.history).toHaveLength(1)
    })

    it('assigns default qEstimate and bandwidthHz when not provided', () => {
      const track = tm.processPeak(makePeak())
      expect(track.qEstimate).toBe(10)
      expect(track.bandwidthHz).toBe(100)
    })

    it('uses provided qEstimate and bandwidthHz', () => {
      const track = tm.processPeak({ ...makePeak(), qEstimate: 25, bandwidthHz: 40 })
      expect(track.qEstimate).toBe(25)
      expect(track.bandwidthHz).toBe(40)
    })

    it('creates distinct tracks for different bins', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440 }))
      const t2 = tm.processPeak(makePeak({ binIndex: 200, trueFrequencyHz: 2000 }))
      expect(t1.id).not.toBe(t2.id)
      expect(tm.getAllTracks()).toHaveLength(2)
    })

    it('populates MSD fields from the peak', () => {
      const track = tm.processPeak({
        ...makePeak(),
        msd: 0.05,
        msdGrowthRate: 1.2,
        msdIsHowl: true,
        msdFastConfirm: false,
      })
      expect(track.msd).toBe(0.05)
      expect(track.msdGrowthRate).toBe(1.2)
      expect(track.msdIsHowl).toBe(true)
      expect(track.msdFastConfirm).toBe(false)
    })

    it('populates persistence fields from the peak', () => {
      const track = tm.processPeak({
        ...makePeak(),
        persistenceFrames: 30,
        persistenceBoost: 0.15,
        isPersistent: true,
        isHighlyPersistent: false,
      })
      expect(track.persistenceFrames).toBe(30)
      expect(track.persistenceBoost).toBe(0.15)
      expect(track.isPersistent).toBe(true)
      expect(track.isHighlyPersistent).toBe(false)
    })

    it('populates confirmation timing fields from the peak', () => {
      const track = tm.processPeak(makePeak({
        firstSeenAt: 1000,
        confirmedAt: 1120,
        confirmLatencyMs: 120,
      }))

      expect(track.firstSeenAt).toBe(1000)
      expect(track.confirmedAt).toBe(1120)
      expect(track.confirmLatencyMs).toBe(120)
    })

    it('uses detector firstSeenAt as onset so worker persistence includes confirmation hold time', () => {
      tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 1000,
        timestamp: 1120,
        firstSeenAt: 1000,
        confirmedAt: 1120,
        confirmLatencyMs: 120,
      }))

      const updated = tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 1000,
        timestamp: 1200,
        firstSeenAt: 1000,
        confirmedAt: 1120,
        confirmLatencyMs: 120,
      }))

      expect(updated.onsetTime).toBe(1000)
      expect(updated.features.persistenceMs).toBe(200)
    })
  })

  // ================================================================
  // Track updating (same bin)
  // ================================================================
  describe('processPeak — updating existing track', () => {
    it('updates a track when the same binIndex is used', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, trueAmplitudeDb: -25, timestamp: 1000 }))
      const id = t1.id

      const t2 = tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 442, trueAmplitudeDb: -18, timestamp: 1100 }))
      expect(t2.id).toBe(id)
      expect(t2.trueFrequencyHz).toBe(442)
      expect(t2.trueAmplitudeDb).toBe(-18)
      expect(t2.lastUpdateTime).toBe(1100)
      expect(t2.history).toHaveLength(2)
    })

    it('does not create duplicate tracks for the same bin', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1100 }))
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1200 }))
      expect(tm.getAllTracks()).toHaveLength(1)
    })

    it('caps history at historySize', () => {
      const historySize = 8
      const tmSmall = new TrackManager({ historySize })

      for (let i = 0; i < 20; i++) {
        tmSmall.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, timestamp: 1000 + i * 100 }))
      }

      const tracks = tmSmall.getAllTracks()
      expect(tracks[0].history.length).toBe(historySize)
    })

    it('preserves onsetTime when updating', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      const t2 = tm.processPeak(makePeak({ binIndex: 50, timestamp: 2000 }))
      expect(t2.onsetTime).toBe(1000)
      expect(t2.id).toBe(t1.id)
    })

    it('updates confirmation timing fields on refreshed peaks', () => {
      tm.processPeak(makePeak({
        binIndex: 50,
        timestamp: 1000,
        firstSeenAt: 920,
        confirmedAt: 1000,
        confirmLatencyMs: 80,
      }))

      const updated = tm.processPeak(makePeak({
        binIndex: 50,
        timestamp: 1200,
        firstSeenAt: 920,
        confirmedAt: 1000,
        confirmLatencyMs: 80,
      }))

      expect(updated.firstSeenAt).toBe(920)
      expect(updated.confirmedAt).toBe(1000)
      expect(updated.confirmLatencyMs).toBe(80)
    })

    it('keeps isSubHarmonicRoot sticky once set', () => {
      tm.processPeak(makePeak({ binIndex: 50, isSubHarmonicRoot: true, timestamp: 1000 }))
      const t2 = tm.processPeak(makePeak({ binIndex: 50, isSubHarmonicRoot: false, timestamp: 1100 }))
      expect(t2.isSubHarmonicRoot).toBe(true)
    })
  })

  // ================================================================
  // Cents-based association
  // ================================================================
  describe('processPeak — cents-based association', () => {
    it('associates a new bin to an existing track when within tolerance', () => {
      // Create a track at 1000 Hz, bin 100
      const t1 = tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 1000, timestamp: 1000 }))
      const id = t1.id

      // A nearby frequency at a different bin — 1000 * 2^(50/1200) ~ 1029.3 Hz (50 cents away)
      const nearbyHz = 1000 * Math.pow(2, 50 / 1200)
      const t2 = tm.processPeak(makePeak({ binIndex: 102, trueFrequencyHz: nearbyHz, timestamp: 1100 }))

      expect(t2.id).toBe(id)
      expect(tm.getAllTracks()).toHaveLength(1)
      // Bin association should be updated to the new bin
      expect(t2.binIndex).toBe(102)
    })

    it('does NOT associate when frequency is beyond tolerance', () => {
      tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 1000, timestamp: 1000 }))

      // 200 cents away — beyond the 100-cent tolerance
      const farHz = 1000 * Math.pow(2, 200 / 1200)
      tm.processPeak(makePeak({ binIndex: 120, trueFrequencyHz: farHz, timestamp: 1100 }))

      expect(tm.getAllTracks()).toHaveLength(2)
    })

    it('associates to the nearest track when multiple exist', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 1000, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 200, trueFrequencyHz: 2000, timestamp: 1000 }))

      // 30 cents above 1000 Hz — closer to t1 than to the 2000 Hz track
      const nearHz = 1000 * Math.pow(2, 30 / 1200)
      const t3 = tm.processPeak(makePeak({ binIndex: 101, trueFrequencyHz: nearHz, timestamp: 1100 }))
      expect(t3.id).toBe(t1.id)
    })

    it('only associates to active tracks', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 1000, timestamp: 1000 }))
      tm.clearTrack(100, 1050)

      // Same frequency, different bin — should NOT associate because track is inactive
      const t2 = tm.processPeak(makePeak({ binIndex: 101, trueFrequencyHz: 1002, timestamp: 1100 }))
      expect(t2.id).not.toBe(t1.id)
      expect(tm.getAllTracks()).toHaveLength(2)
    })
  })

  // ================================================================
  // Track timeout / expiration
  // ================================================================
  describe('pruneInactiveTracks', () => {
    it('removes inactive tracks that have timed out', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.clearTrack(50, 1100)

      // Not yet timed out
      tm.pruneInactiveTracks(1500)
      expect(tm.getAllTracks()).toHaveLength(1)

      // Now timed out (1100 + 1000ms timeout < 2200)
      tm.pruneInactiveTracks(2200)
      expect(tm.getAllTracks()).toHaveLength(0)
    })

    it('does not prune active tracks', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.pruneInactiveTracks(50_000)
      expect(tm.getAllTracks()).toHaveLength(1)
    })

    it('respects the trackTimeoutMs value', () => {
      const tmFast = new TrackManager({ trackTimeoutMs: 200 })
      tmFast.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tmFast.clearTrack(50, 1000)

      tmFast.pruneInactiveTracks(1150)
      expect(tmFast.getAllTracks()).toHaveLength(1)

      tmFast.pruneInactiveTracks(1250)
      expect(tmFast.getAllTracks()).toHaveLength(0)
    })
  })

  // ================================================================
  // Max tracks eviction
  // ================================================================
  describe('max tracks limit', () => {
    it('evicts the oldest tracks when exceeding maxTracks via prune', () => {
      const tmTiny = new TrackManager({ maxTracks: 3, trackTimeoutMs: 100_000 })

      // Create 5 tracks with increasing timestamps
      for (let i = 0; i < 5; i++) {
        tmTiny.processPeak(makePeak({
          binIndex: i * 10,
          trueFrequencyHz: 500 + i * 500,
          timestamp: 1000 + i * 100,
        }))
      }

      expect(tmTiny.getAllTracks()).toHaveLength(5)

      // Prune triggers the max-tracks eviction
      tmTiny.pruneInactiveTracks(2000)

      expect(tmTiny.getAllTracks()).toHaveLength(3)
    })

    it('evicts low-quality tracks before high-quality tracks (recency-weighted)', () => {
      const tmSmall = new TrackManager({ maxTracks: 3, trackTimeoutMs: 100_000, historySize: 32 })

      // Create 2 high-quality tracks: high prominence, high Q, stable pitch
      // These are created earlier (more stale) but should survive due to clarity
      for (let idx = 0; idx < 2; idx++) {
        const bin = idx * 10
        const freq = 1000 + idx * 500
        // First update
        tmSmall.processPeak({
          ...makePeak({ binIndex: bin, trueFrequencyHz: freq, prominenceDb: 25, timestamp: 1000 + idx }),
          qEstimate: 40,
        })
        // Second update to populate features (stabilityCentsStd near 0)
        tmSmall.processPeak({
          ...makePeak({ binIndex: bin, trueFrequencyHz: freq, prominenceDb: 25, timestamp: 1100 + idx }),
          qEstimate: 40,
        })
      }

      // Create 3 low-quality tracks: low prominence, low Q, created more recently
      for (let idx = 0; idx < 3; idx++) {
        const bin = 50 + idx * 10
        const freq = 3000 + idx * 500
        tmSmall.processPeak({
          ...makePeak({ binIndex: bin, trueFrequencyHz: freq, prominenceDb: 2, timestamp: 1200 + idx }),
          qEstimate: 3,
        })
        // Second update with frequency jitter for high stabilityCentsStd
        tmSmall.processPeak({
          ...makePeak({ binIndex: bin, trueFrequencyHz: freq * 1.05, prominenceDb: 2, timestamp: 1300 + idx }),
          qEstimate: 3,
        })
      }

      expect(tmSmall.getAllTracks()).toHaveLength(5)

      // Prune at a time where all tracks are relatively recent
      tmSmall.pruneInactiveTracks(1400)
      expect(tmSmall.getAllTracks()).toHaveLength(3)

      // The 2 high-quality tracks should survive despite being older
      const remaining = tmSmall.getAllTracks()
      const highQualitySurvived = remaining.filter(t => t.prominenceDb === 25)
      expect(highQualitySurvived).toHaveLength(2)

      // Only 1 of the 3 low-quality tracks should remain
      const lowQualitySurvived = remaining.filter(t => t.prominenceDb === 2)
      expect(lowQualitySurvived).toHaveLength(1)
    })
  })

  // ================================================================
  // clearTrack
  // ================================================================
  describe('clearTrack', () => {
    it('marks a track as inactive and returns last amplitude', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -15, timestamp: 1000 }))
      const amp = tm.clearTrack(50, 1100)
      expect(amp).toBe(-15)
    })

    it('returns null for unknown bin', () => {
      expect(tm.clearTrack(999, 1000)).toBeNull()
    })

    it('removes the track from active tracks list', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      expect(tm.getRawTracks()).toHaveLength(1)

      tm.clearTrack(50, 1100)
      expect(tm.getRawTracks()).toHaveLength(0)
    })

    it('keeps the track in getAllTracks (just inactive)', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.clearTrack(50, 1100)

      const all = tm.getAllTracks()
      expect(all).toHaveLength(1)
      expect(all[0].isActive).toBe(false)
    })

    it('track can be reactivated by processing the same bin again', () => {
      const t1 = tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.clearTrack(50, 1100)
      expect(tm.getRawTracks()).toHaveLength(0)

      const t2 = tm.processPeak(makePeak({ binIndex: 50, timestamp: 1200 }))
      expect(t2.id).toBe(t1.id)
      expect(t2.isActive).toBe(true)
      expect(tm.getRawTracks()).toHaveLength(1)
    })
  })

  // ================================================================
  // getActiveTracks / getRawTracks
  // ================================================================
  describe('getActiveTracks and getRawTracks', () => {
    it('getActiveTracks returns TrackedPeak objects', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, timestamp: 1000 }))
      const active = tm.getActiveTracks()
      expect(active).toHaveLength(1)
      expect(active[0]).toHaveProperty('frequency', 440)
      expect(active[0]).toHaveProperty('amplitude')
      expect(active[0]).toHaveProperty('features')
      expect(active[0]).toHaveProperty('history')
    })

    it('getRawTracks returns Track objects', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, timestamp: 1000 }))
      const raw = tm.getRawTracks()
      expect(raw).toHaveLength(1)
      expect(raw[0]).toHaveProperty('trueFrequencyHz', 440)
      expect(raw[0]).toHaveProperty('trueAmplitudeDb')
      expect(raw[0]).toHaveProperty('features')
    })

    it('only includes active tracks', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 2000, timestamp: 1000 }))
      tm.clearTrack(50, 1100)

      expect(tm.getActiveTracks()).toHaveLength(1)
      expect(tm.getRawTracks()).toHaveLength(1)
      expect(tm.getAllTracks()).toHaveLength(2)
    })

    it('getActiveTrackSummaries omits history while preserving onset metadata', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, trueAmplitudeDb: -22, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 442, trueAmplitudeDb: -18, timestamp: 1100 }))

      const summaries = tm.getActiveTrackSummaries()
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).toMatchObject({
        frequency: 442,
        amplitude: -18,
        onsetTime: 1000,
        onsetAmplitudeDb: -22,
      })
      expect('history' in summaries[0]).toBe(false)
    })
  })

  // ================================================================
  // getTrack
  // ================================================================
  describe('getTrack', () => {
    it('returns a track by its ID', () => {
      const t = tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      expect(tm.getTrack(t.id)).toBe(t)
    })

    it('returns undefined for unknown ID', () => {
      expect(tm.getTrack('nonexistent')).toBeUndefined()
    })
  })

  // ================================================================
  // clear
  // ================================================================
  describe('clear', () => {
    it('removes all tracks', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 2000, timestamp: 1000 }))
      expect(tm.getAllTracks()).toHaveLength(2)

      tm.clear()
      expect(tm.getAllTracks()).toHaveLength(0)
      expect(tm.getActiveTracks()).toHaveLength(0)
      expect(tm.getRawTracks()).toHaveLength(0)
    })
  })

  // ================================================================
  // updateOptions
  // ================================================================
  describe('updateOptions', () => {
    it('updates maxTracks at runtime without clearing existing tracks', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 100, trueFrequencyHz: 2000, timestamp: 1000 }))
      expect(tm.getAllTracks()).toHaveLength(2)

      tm.updateOptions({ maxTracks: 1 })

      // Existing tracks are not immediately removed; prune enforces the new limit
      tm.pruneInactiveTracks(5000)
      expect(tm.getAllTracks()).toHaveLength(1)
    })

    it('updates trackTimeoutMs at runtime', () => {
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.clearTrack(50, 1000)

      tm.updateOptions({ trackTimeoutMs: 5000 })

      // Would be expired under old 1000ms timeout but not under new 5000ms
      tm.pruneInactiveTracks(2500)
      expect(tm.getAllTracks()).toHaveLength(1)

      tm.pruneInactiveTracks(7000)
      expect(tm.getAllTracks()).toHaveLength(0)
    })

    it('does not reset fields that are not provided', () => {
      tm.updateOptions({ maxTracks: 5 })
      tm.processPeak(makePeak({ binIndex: 50, timestamp: 1000 }))
      tm.clearTrack(50, 1000)

      // trackTimeoutMs should still be the original 1000ms
      tm.pruneInactiveTracks(2100)
      expect(tm.getAllTracks()).toHaveLength(0)
    })
  })

  // ================================================================
  // Feature extraction
  // ================================================================
  describe('feature extraction', () => {
    it('initializes single-entry tracks with detector-confirmed timing and Q', () => {
      const track = tm.processPeak(makePeak({
        binIndex: 50,
        timestamp: 1000,
        firstSeenAt: 760,
        confirmedAt: 1000,
        confirmLatencyMs: 240,
        sustainedMs: 240,
        qEstimate: 32,
      }))
      expect(track.features.stabilityCentsStd).toBe(0)
      expect(track.features.harmonicityScore).toBe(0)
      expect(track.features.modulationScore).toBe(0)
      expect(track.features.persistenceMs).toBe(240)
      expect(track.features.meanQ).toBe(32)
      expect(track.features.minQ).toBe(32)
      expect(track.onsetTime).toBe(760)
      expect(track.confirmLatencyMs).toBe(240)
    })

    it('computes persistenceMs from onset to last update', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 440, timestamp: 1000 }))
      const track = tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 441, timestamp: 2000 }))
      expect(track.features.persistenceMs).toBe(1000)
    })

    it('computes velocity from history', () => {
      // Velocity uses a 500ms window and requires dt > MIN_VELOCITY_DT_SEC (0.05s)
      // Feed several updates within a 500ms window to build a clear slope
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -30, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -25, timestamp: 1200 }))
      const track = tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -20, timestamp: 1400 }))
      // +10 dB over 0.4s = 25 dB/s
      expect(track.velocityDbPerSec).toBeCloseTo(25, 0)
    })

    it('keeps rapid decay out of the positive growth maximum', () => {
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -20, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -23, timestamp: 1100 }))
      tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -26, timestamp: 1200 }))
      const track = tm.processPeak(makePeak({ binIndex: 50, trueAmplitudeDb: -29, timestamp: 1300 }))

      expect(track.velocityDbPerSec).toBeLessThan(0)
      expect(track.features.meanVelocityDbPerSec).toBeLessThan(0)
      expect(track.features.maxVelocityDbPerSec).toBe(0)
    })

    it('computes stabilityCentsStd from frequency variation', () => {
      // Feed the same bin with slightly varying frequencies
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 1000, timestamp: 1000 }))
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 1003, timestamp: 1100 }))
      tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 997, timestamp: 1200 }))
      const track = tm.processPeak(makePeak({ binIndex: 50, trueFrequencyHz: 1001, timestamp: 1300 }))

      // There should be some nonzero stability std
      expect(track.features.stabilityCentsStd).toBeGreaterThan(0)
    })

    it('computes harmonicityScore 0.8 when harmonicOfHz is set', () => {
      tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 880,
        harmonicOfHz: 440,
        timestamp: 1000,
      }))
      // Need a second update to trigger feature extraction
      const updated = tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 880,
        harmonicOfHz: 440,
        timestamp: 1100,
      }))
      expect(updated.features.harmonicityScore).toBe(0.8)
    })

    it('computes harmonicityScore 0.75 when isSubHarmonicRoot is set', () => {
      tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 440,
        isSubHarmonicRoot: true,
        timestamp: 1000,
      }))
      const updated = tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 440,
        isSubHarmonicRoot: true,
        timestamp: 1100,
      }))
      expect(updated.features.harmonicityScore).toBe(0.75)
    })

    it('computes Q statistics from history', () => {
      tm.processPeak({ ...makePeak({ binIndex: 50, timestamp: 1000 }), qEstimate: 20 })
      tm.processPeak({ ...makePeak({ binIndex: 50, timestamp: 1100 }), qEstimate: 30 })
      const track = tm.processPeak({ ...makePeak({ binIndex: 50, timestamp: 1200 }), qEstimate: 10 })

      expect(track.features.meanQ).toBe(20)
      expect(track.features.minQ).toBe(10)
    })

    it('keeps rolling Q statistics correct after the history buffer wraps', () => {
      const tmSmall = new TrackManager({ historySize: 4 })
      const qValues = [40, 30, 20, 10, 50, 60]

      for (let i = 0; i < qValues.length; i++) {
        tmSmall.processPeak({
          ...makePeak({ binIndex: 50, timestamp: 1000 + i * 100 }),
          qEstimate: qValues[i],
        })
      }

      const [track] = tmSmall.getRawTracks()
      expect(track.history).toHaveLength(4)
      expect(track.features.meanQ).toBe(35)
      expect(track.features.minQ).toBe(10)
    })
  })

  // ================================================================
  // Default constructor
  // ================================================================
  describe('default constructor options', () => {
    it('uses TRACK_SETTINGS defaults when no options are provided', () => {
      const tmDefault = new TrackManager()
      // Create many tracks with widely spaced frequencies to avoid cents-based association
      // Default association tolerance is 100 cents (~1 semitone), so use exponential spacing
      const created: string[] = []
      for (let i = 0; i < 70; i++) {
        // Each track at least 2 semitones (200 cents) apart: 100 * 2^(i*200/1200)
        const freq = 100 * Math.pow(2, (i * 200) / 1200)
        const track = tmDefault.processPeak(makePeak({
          binIndex: i,
          trueFrequencyHz: freq,
          timestamp: 1000 + i,
        }))
        created.push(track.id)
      }
      expect(tmDefault.getAllTracks()).toHaveLength(70)
      // After prune, should be capped at default MAX_TRACKS (64)
      tmDefault.pruneInactiveTracks(5000)
      expect(tmDefault.getAllTracks()).toHaveLength(64)
    })
  })

  // ================================================================
  // TrackedPeak mapping
  // ================================================================
  describe('TrackedPeak mapping via getActiveTracks', () => {
    it('maps Track fields to TrackedPeak correctly', () => {
      tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 880,
        trueAmplitudeDb: -15,
        prominenceDb: 10,
        timestamp: 1000,
      }))
      tm.processPeak(makePeak({
        binIndex: 50,
        trueFrequencyHz: 882,
        trueAmplitudeDb: -12,
        prominenceDb: 11,
        timestamp: 1100,
      }))

      const tracked = tm.getActiveTracks()
      expect(tracked).toHaveLength(1)
      const tp = tracked[0]

      expect(tp.frequency).toBe(882)
      expect(tp.amplitude).toBe(-12)
      expect(tp.prominenceDb).toBe(11)
      expect(tp.onsetTime).toBe(1000)
      expect(tp.lastUpdateTime).toBe(1100)
      expect(tp.active).toBe(true)
      expect(tp.history).toHaveLength(2)
      expect(tp.history[0]).toHaveProperty('time')
      expect(tp.history[0]).toHaveProperty('frequency')
      expect(tp.history[0]).toHaveProperty('amplitude')
      expect(tp.features).toHaveProperty('stabilityCentsStd')
      expect(tp.features).toHaveProperty('harmonicityScore')
      expect(tp.features).toHaveProperty('modulationScore')
      expect(tp.features).toHaveProperty('velocityDbPerSec')
    })
  })
})
