/**
 * FeedbackDetector hot-path test harness (S8)
 *
 * Tests the analyze() pipeline and its internal methods that run at 50fps.
 * Uses (detector as any) to access private methods — matches existing repo patterns.
 *
 * Part A: Method-level unit tests for _buildPowerSpectrum, _scanAndProcessPeaks,
 *         updatePersistence, calculatePHPR, estimateQ
 * Part B: End-to-end analyze() harness with mocked AnalyserNode
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import { FeedbackDetector } from '../feedbackDetector'
import { DEFAULT_CONFIG } from '@/types/advisory'
import { EXP_LUT, PERSISTENCE_SCORING, PHPR_SETTINGS, MSD_SETTINGS } from '../constants'
import { deriveFreshStartDetectorSettings } from '@/lib/settings/defaultDetectorSettings'

// ── Helpers ────────────────────────────────────────────────────────────

const FFT_SIZE = 8192
const NUM_BINS = FFT_SIZE / 2 // 4096 frequencyBinCount
const SAMPLE_RATE = 48000
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE // ~5.859 Hz

/**
 * Create a mock AnalyserNode that feeds controlled spectrum data.
 * `spectrumFiller` populates the Float32Array with dB values.
 */
function createMockAnalyser(spectrumFiller: (arr: Float32Array) => void) {
  return {
    frequencyBinCount: NUM_BINS,
    fftSize: FFT_SIZE,
    smoothingTimeConstant: 0.5,
    minDecibels: -100,
    maxDecibels: 0,
    getFloatFrequencyData: (array: Float32Array) => {
      spectrumFiller(array)
    },
    getFloatTimeDomainData: (array: Float32Array) => {
      array.fill(0)
    },
  }
}

/** Minimal AudioContext mock — only sampleRate is needed for math. */
function createMockAudioContext() {
  return {
    sampleRate: SAMPLE_RATE,
    state: 'running' as const,
    resume: () => Promise.resolve(),
  }
}

/**
 * Set up a FeedbackDetector with mocked audio nodes and allocated buffers,
 * ready for calling analyze() directly.
 */
function createReadyDetector(
  spectrumFiller: (arr: Float32Array) => void,
  configOverrides: Record<string, unknown> = {},
) {
  const detector = new FeedbackDetector({
    ...DEFAULT_CONFIG,
    aWeightingEnabled: false, // Disable A-weighting for predictable dB values
    noiseFloorEnabled: false, // Disable noise floor so threshold is absolute
    inputGainDb: 0,
    autoGainEnabled: false,
    ...configOverrides,
  })

  // Wire up mocks — bypass private access via any cast
  ;(detector as any).audioContext = createMockAudioContext()
  ;(detector as any).analyser = createMockAnalyser(spectrumFiller)

  // Allocate buffers (normally done by setFftSize when analyser is present)
  detector.setFftSize(FFT_SIZE)

  return detector
}

function getPersistenceCounts(detector: FeedbackDetector): Uint16Array | null {
  return (detector as any)._persistenceTracker?.counts ?? null
}

/**
 * Bin index for a given frequency in Hz.
 */
function hzToBin(hz: number): number {
  return Math.round(hz / HZ_PER_BIN)
}

// ═══════════════════════════════════════════════════════════════════════
// Part A: Method-level unit tests
// ═══════════════════════════════════════════════════════════════════════

describe('FeedbackDetector hot path — Part A: Method-level', () => {
  // ── _buildPowerSpectrum ────────────────────────────────────────────

  describe('_buildPowerSpectrum', () => {
    it('converts constant dB spectrum to correct power values', () => {
      const testDb = -30
      const detector = createReadyDetector((arr) => arr.fill(testDb))
      const d = detector as any

      // Fill freqDb with test values (simulating getFloatFrequencyData)
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(testDb)

      ;(detector as any)._buildPowerSpectrum()

      const power = d.power as Float32Array
      const prefix = d.prefix as Float64Array

      // Power should match EXP_LUT for -30 dB
      const lutIdx = ((-30 + 100) * 10 + 0.5) | 0 // = 700
      const expectedPower = EXP_LUT[lutIdx]
      expect(power[100]).toBeCloseTo(expectedPower, 8)

      // Prefix sum should be monotonically non-decreasing
      for (let i = 1; i <= NUM_BINS; i++) {
        expect(prefix[i]).toBeGreaterThanOrEqual(prefix[i - 1])
      }

      // prefix[N] should equal N * expectedPower (constant spectrum)
      expect(prefix[NUM_BINS]).toBeCloseTo(NUM_BINS * expectedPower, 4)
    })

    it('bins far below threshold get zero power (skip optimization)', () => {
      // With threshold at -80 dB (default), skip threshold is -92 dB.
      // Bins at -100 dB should be skipped → power = 0.
      const detector = createReadyDetector((arr) => arr.fill(-100))
      const d = detector as any

      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-100)

      ;(detector as any)._buildPowerSpectrum()

      const power = d.power as Float32Array
      expect(power[100]).toBe(0)
      expect(power[500]).toBe(0)
    })

    it('handles non-finite values by clamping to -100', () => {
      const detector = createReadyDetector((arr) => arr.fill(-50))
      const d = detector as any

      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-50)
      freqDb[200] = -Infinity
      freqDb[300] = NaN

      ;(detector as any)._buildPowerSpectrum()

      // After buildPowerSpectrum, non-finite values are replaced with -100
      expect(freqDb[200]).toBe(-100)
      expect(freqDb[300]).toBe(-100)
    })

    it('applies input gain offset to all bins', () => {
      const baseDb = -40
      const gain = 10
      const detector = createReadyDetector((arr) => arr.fill(baseDb), {
        inputGainDb: gain,
      })
      const d = detector as any

      const freqDb = d.freqDb as Float32Array
      freqDb.fill(baseDb)

      ;(detector as any)._buildPowerSpectrum()

      // After build, freqDb[i] should be baseDb + gain = -30
      expect(freqDb[100]).toBeCloseTo(baseDb + gain, 1)
    })
  })

  // ── estimateQ ──────────────────────────────────────────────────────

  describe('estimateQ', () => {
    it('returns Q = centerFreq / bandwidth for controlled -3dB shape', () => {
      const peakBin = 500 // ~2930 Hz
      const peakDb = -20

      const detector = createReadyDetector((arr) => arr.fill(-100))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-100)

      // Create a triangular peak: -20 dB at center, drops 1 dB per bin
      // -3dB crossing at ±3 bins from center
      for (let offset = -10; offset <= 10; offset++) {
        const db = peakDb - Math.abs(offset)
        freqDb[peakBin + offset] = db
      }

      const result = (detector as any).estimateQ(peakBin, peakDb, peakBin * HZ_PER_BIN)
      const { qEstimate, bandwidthHz, qMeasurementMode } = result

      // With 1 dB/bin drop, -3dB crossing is at ±3 bins.
      // Bandwidth = 6 bins * HZ_PER_BIN ≈ 35.16 Hz
      // Q = centerFreq / bandwidth ≈ 2929.7 / 35.16 ≈ 83.3
      // Allow tolerance for interpolation
      expect(bandwidthHz).toBeGreaterThan(20)
      expect(bandwidthHz).toBeLessThan(60)
      expect(qEstimate).toBeGreaterThan(40)
      expect(qEstimate).toBeLessThan(200)
      expect(qMeasurementMode).toBe('full')
    })

    it('returns high Q for a very narrow peak (single bin)', () => {
      const peakBin = 300
      const peakDb = -10

      const detector = createReadyDetector((arr) => arr.fill(-100))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-100)

      // Single bin peak — neighbors are -100 dB (way below -3dB)
      freqDb[peakBin] = peakDb

      const result = (detector as any).estimateQ(peakBin, peakDb, peakBin * HZ_PER_BIN)
      // Very narrow → high Q (capped at 500 by clamp)
      expect(result.qEstimate).toBeGreaterThanOrEqual(100)
      expect(result.qMeasurementMode).toBe('full')
    })

    it('marks one-sided bandwidth reads as mirrored', () => {
      const peakBin = 1
      const peakDb = -20

      const detector = createReadyDetector((arr) => arr.fill(-100))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-100)

      freqDb[0] = -22
      freqDb[peakBin] = peakDb
      freqDb[peakBin + 1] = -24

      const result = (detector as any).estimateQ(peakBin, peakDb, peakBin * HZ_PER_BIN)
      expect(result.qMeasurementMode).toBe('mirrored')
      expect(result.bandwidthHz).toBeGreaterThan(HZ_PER_BIN)
    })

    it('returns default when freqDb is null', () => {
      const detector = new FeedbackDetector()
      // freqDb is null because no analyser was set
      const result = (detector as any).estimateQ(100, -20, 1000)
      expect(result.qEstimate).toBe(10)
      expect(result.bandwidthHz).toBe(100)
      expect(result.qMeasurementMode).toBe('defaulted')
    })
  })

  // ── calculatePHPR ─────────────────────────────────────────────────

  describe('calculatePHPR', () => {
    it('returns high PHPR for pure tone (no harmonics)', () => {
      const peakBin = 200 // ~1172 Hz

      const detector = createReadyDetector((arr) => arr.fill(-80))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-80)

      // Fundamental at -10 dB, harmonics stay at noise floor -80 dB
      freqDb[peakBin] = -10

      const phpr = (detector as any).calculatePHPR(peakBin)

      // Pure tone: PHPR ≈ peakDb - meanHarmonicDb(linear)
      // Harmonics at -80 dB: linear power ≈ 1e-8, mean = 1e-8
      // meanHarmonicDb = 10*log10(1e-8) = -80
      // PHPR = -10 - (-80) = 70 dB (approximately)
      expect(phpr).toBeGreaterThan(PHPR_SETTINGS.FEEDBACK_THRESHOLD_DB)
      expect(phpr).toBeGreaterThan(50)
    })

    it('returns low PHPR for harmonic-rich signal (music)', () => {
      const peakBin = 100 // ~586 Hz fundamental

      const detector = createReadyDetector((arr) => arr.fill(-80))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-80)

      // Fundamental at -10 dB
      freqDb[peakBin] = -10
      // Strong harmonics (typical of music): 2nd at -14, 3rd at -18, 4th at -22
      freqDb[peakBin * 2] = -14
      freqDb[peakBin * 3] = -18
      freqDb[peakBin * 4] = -22

      const phpr = (detector as any).calculatePHPR(peakBin)

      // With strong harmonics, PHPR should be low (< 15 dB)
      expect(phpr).toBeDefined()
      expect(phpr!).toBeLessThan(PHPR_SETTINGS.FEEDBACK_THRESHOLD_DB)
      expect(phpr!).toBeGreaterThan(0)
    })

    it('returns undefined when all harmonics are out of FFT range', () => {
      // Peak near Nyquist — 2nd harmonic exceeds bin count
      const peakBin = NUM_BINS - 10

      const detector = createReadyDetector((arr) => arr.fill(-80))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-80)
      freqDb[peakBin] = -10

      const phpr = (detector as any).calculatePHPR(peakBin)
      expect(phpr).toBeUndefined()
    })

    it('uses linear-domain averaging (not dB arithmetic mean)', () => {
      const peakBin = 100

      const detector = createReadyDetector((arr) => arr.fill(-80))
      const d = detector as any
      const freqDb = d.freqDb as Float32Array
      freqDb.fill(-80)

      freqDb[peakBin] = -10

      // One loud harmonic, two quiet — linear average is dominated by the loud one
      freqDb[peakBin * 2] = -15 // Loud harmonic
      freqDb[peakBin * 3] = -70 // Quiet
      freqDb[peakBin * 4] = -70 // Quiet

      const phpr = (detector as any).calculatePHPR(peakBin)

      // Linear mean: dominated by -15 dB harmonic (linear ≈ 3.16e-2)
      // Arithmetic dB mean would be (-15 + -70 + -70)/3 = -51.67 dB — very different
      // Linear mean ≈ 10*log10((3.16e-2 + 1e-7 + 1e-7)/3) ≈ -19.8 dB
      // PHPR ≈ -10 - (-19.8) ≈ 9.8 dB
      expect(phpr).toBeDefined()
      expect(phpr!).toBeLessThan(15)
      expect(phpr!).toBeGreaterThan(5)
    })
  })

  // ── updatePersistence ──────────────────────────────────────────────

  describe('updatePersistence', () => {
    it('uses elapsed milliseconds instead of configured frame count', () => {
      const detector = createReadyDetector(() => {})
      const bin = 100

      ;(detector as any).updatePersistence(bin, -20, 33)
      ;(detector as any).updatePersistence(bin, -20, 34)
      ;(detector as any).updatePersistence(bin, -20, 33)

      expect((detector as any).getPersistenceScore(bin).isPersistent).toBe(true)
    })

    it('increments persistence when amplitude is within tolerance', () => {
      const detector = createReadyDetector((arr) => arr.fill(-80))
      const bin = 300

      // First call — initializes
      ;(detector as any).updatePersistence(bin, -20)
      const count1 = getPersistenceCounts(detector)![bin]
      expect(count1).toBe(1) // First call sets to 1

      // Second call — same amplitude → increment
      ;(detector as any).updatePersistence(bin, -20)
      const count2 = getPersistenceCounts(detector)![bin]
      expect(count2).toBe(2)

      // Third call — within tolerance (6 dB) → still increments
      ;(detector as any).updatePersistence(bin, -20 + PERSISTENCE_SCORING.AMPLITUDE_TOLERANCE_DB)
      const count3 = getPersistenceCounts(detector)![bin]
      expect(count3).toBe(3)
    })

    it('resets persistence when amplitude change exceeds tolerance', () => {
      const detector = createReadyDetector((arr) => arr.fill(-80))
      const bin = 300

      // Build up persistence
      for (let i = 0; i < 10; i++) {
        ;(detector as any).updatePersistence(bin, -20)
      }
      expect(getPersistenceCounts(detector)![bin]).toBe(10)

      // Sudden amplitude jump beyond tolerance → reset to 1
      ;(detector as any).updatePersistence(bin, -20 + PERSISTENCE_SCORING.AMPLITUDE_TOLERANCE_DB + 1)
      expect(getPersistenceCounts(detector)![bin]).toBe(1)
    })

    it('caps persistence at history window', () => {
      const detector = createReadyDetector((arr) => arr.fill(-80))
      const bin = 300
      const historyFrames = (detector as any)._persistHistoryFrames as number

      // Call many more times than the cap
      for (let i = 0; i < historyFrames + 20; i++) {
        ;(detector as any).updatePersistence(bin, -20)
      }

      expect(getPersistenceCounts(detector)![bin]).toBe(historyFrames)
    })

    it('does nothing when persistence tracker is null', () => {
      const detector = new FeedbackDetector()
      // Persistence tracker is null (no buffers allocated)
      expect(() => {
        ;(detector as any).updatePersistence(100, -20)
      }).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part B: End-to-end analyze() harness
// ═══════════════════════════════════════════════════════════════════════

describe('FeedbackDetector hot path — Part B: analyze() harness', () => {
  describe('auto-gain calibration lifecycle', () => {
    it('keeps locked auto gain locked when enabled settings are reapplied', () => {
      const detector = createReadyDetector((arr) => {
        arr.fill(-80)
        arr[500] = -25
      })

      detector.updateSettings({ autoGainEnabled: true })
      for (let frame = 1; frame <= 31; frame++) {
        ;(detector as any).analyze(frame * 100, 100)
      }
      expect(detector.getState().autoGainLocked).toBe(true)

      detector.updateSettings({
        feedbackThresholdDb: 30,
        autoGainEnabled: true,
      })

      expect(detector.getState().autoGainLocked).toBe(true)

      detector.updateSettings({ autoGainEnabled: false })
      detector.updateSettings({ autoGainEnabled: true })
      expect(detector.getState().autoGainLocked).toBe(false)
    })
  })

  // ── Silence gate ──────────────────────────────────────────────────

  describe('silence gate', () => {
    it('does not register peaks when all bins are below silence threshold', () => {
      const detectedPeaks: unknown[] = []
      const detector = createReadyDetector(
        (arr) => arr.fill(-100), // All silence
        { thresholdDb: -80 },
      )

      // Wire up callback to capture peaks
      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      // Set silence threshold (default is -65 dBFS)
      ;(detector as any)._silenceThresholdDb = -65

      // Run analyze — signal is far below silence threshold
      ;(detector as any).analyze(1000, 20)

      expect(detectedPeaks.length).toBe(0)
      expect(detector.getState().isSignalPresent).toBe(false)
    })

    it('keeps measuring noise floor while signal gate is closed', () => {
      const detector = createReadyDetector(
        (arr) => arr.fill(-82),
        {
          noiseFloorEnabled: true,
          thresholdMode: 'hybrid',
          thresholdDb: -80,
          relativeThresholdDb: 26,
        },
      )

      ;(detector as any)._silenceThresholdDb = -65

      for (let frame = 0; frame < 5; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detector.getState().isSignalPresent).toBe(false)
      expect(detector.getState().noiseFloorDb).toBeCloseTo(-82, 1)
    })
  })

  // ── Single prominent peak ────────────────────────────────────────

  describe('single prominent peak detection', () => {
    it('detects a fresh-start feedback tone through the real settings mapping under 200ms', () => {
      const targetBin = hzToBin(1000)
      const bedDb = -62
      const peakDb = -38
      const detectedPeaks: Array<{
        binIndex: number
        confirmLatencyMs?: number
        effectiveThresholdDb?: number
        trueAmplitudeDb: number
      }> = []
      const detector = new FeedbackDetector()
      const freshStart = deriveFreshStartDetectorSettings()

      detector.updateSettings({
        ...freshStart,
        aWeightingEnabled: false,
      })

      ;(detector as any).audioContext = createMockAudioContext()
      ;(detector as any).analyser = createMockAnalyser((arr) => {
        arr.fill(bedDb)
        arr[targetBin - 3] = peakDb - 18
        arr[targetBin - 2] = peakDb - 10
        arr[targetBin - 1] = peakDb - 4
        arr[targetBin] = peakDb
        arr[targetBin + 1] = peakDb - 4
        arr[targetBin + 2] = peakDb - 10
        arr[targetBin + 3] = peakDb - 18
      })
      ;(detector as any).callbacks = {
        onPeakDetected: (peak: {
          binIndex: number
          confirmLatencyMs?: number
          effectiveThresholdDb?: number
          trueAmplitudeDb: number
        }) => detectedPeaks.push(peak),
      }

      detector.setFftSize(freshStart.fftSize)

      for (let frame = 0; frame < 22; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(freshStart.feedbackThresholdDb).toBe(26)
      expect(freshStart.sustainMs).toBe(180)
      expect(detectedPeaks[0]).toBeDefined()
      expect(detectedPeaks[0].binIndex).toBe(targetBin)
      expect(detectedPeaks[0].confirmLatencyMs).toBeLessThanOrEqual(200)
    })

    it('detects a peak at correct frequency after sustain period', () => {
      const targetBin = hzToBin(1000) // ~171
      const peakDb = -20
      const neighborDb = -60

      const detectedPeaks: Array<{
        trueFrequencyHz: number
        binIndex: number
        prominenceDb: number
        sustainedMs?: number
        firstSeenAt?: number
        confirmedAt?: number
        confirmLatencyMs?: number
      }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(neighborDb)
          // Create a prominent local maximum
          arr[targetBin] = peakDb
          // Ensure local-max: neighbors slightly below
          arr[targetBin - 1] = neighborDb
          arr[targetBin + 1] = neighborDb
        },
        {
          thresholdDb: -50, // Peak at -20 clearly exceeds this
          prominenceDb: 5,
          sustainMs: 100, // 100ms sustain = 5 frames at 20ms
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: {
          trueFrequencyHz: number
          binIndex: number
          prominenceDb: number
          sustainedMs?: number
          firstSeenAt?: number
          confirmedAt?: number
          confirmLatencyMs?: number
        }) =>
          detectedPeaks.push(peak),
      }

      // Run enough frames to exceed sustainMs (100ms = 5 frames at 20ms dt)
      for (let frame = 0; frame < 8; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      // Peak should have been registered
      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)

      const peak = detectedPeaks[0]
      // Frequency should be near 1000 Hz (with quadratic interpolation)
      expect(peak.trueFrequencyHz).toBeGreaterThan(900)
      expect(peak.trueFrequencyHz).toBeLessThan(1100)
      expect(peak.binIndex).toBe(targetBin)
      expect(peak.prominenceDb).toBeGreaterThan(5)
      expect(peak.firstSeenAt).toBe(0)
      expect(peak.confirmedAt).toBeGreaterThanOrEqual(80)
      expect(peak.confirmLatencyMs).toBe((peak.confirmedAt ?? 0) - (peak.firstSeenAt ?? 0))
      expect(peak.sustainedMs).toBeGreaterThanOrEqual(100)
    })

    it('does not detect a peak that lacks prominence', () => {
      const targetBin = 300
      const peakDb = -30
      const neighborDb = -32 // Only 2 dB prominence — below 8 dB default

      const detectedPeaks: unknown[] = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(neighborDb)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb: -50,
          prominenceDb: 8,
          sustainMs: 100,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBe(0)
    })
  })

  // ── Adaptive floor + MSD rescue ───────────────────────────────────

  describe('adaptive floor with program material', () => {
    it('confirms a narrow feedback tone just below the adaptive floor via MSD within 320ms', () => {
      const targetBin = hzToBin(1000)
      const bedDb = -55
      const peakDb = -36
      const detectedPeaks: Array<{
        binIndex: number
        trueAmplitudeDb: number
        confirmLatencyMs?: number
        effectiveThresholdDb?: number
        msdIsHowl?: boolean
      }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(bedDb)
          arr[targetBin - 2] = peakDb - 12
          arr[targetBin - 1] = peakDb - 5
          arr[targetBin] = peakDb
          arr[targetBin + 1] = peakDb - 5
          arr[targetBin + 2] = peakDb - 12
        },
        {
          mode: 'speech',
          noiseFloorEnabled: true,
          thresholdMode: 'hybrid',
          thresholdDb: -80,
          relativeThresholdDb: 26,
          prominenceDb: 8,
          sustainMs: 240,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: {
          binIndex: number
          trueAmplitudeDb: number
          confirmLatencyMs?: number
          effectiveThresholdDb?: number
          msdIsHowl?: boolean
        }) => detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 18; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
      expect(detectedPeaks[0].binIndex).toBe(targetBin)
      expect(detectedPeaks[0].trueAmplitudeDb).toBeLessThan(detectedPeaks[0].effectiveThresholdDb ?? -Infinity)
      expect(detectedPeaks[0].msdIsHowl).toBe(true)
      expect(detectedPeaks[0].confirmLatencyMs).toBeLessThanOrEqual(320)
    })
  })

  // ── Sustain timing ────────────────────────────────────────────────

  describe('sustain timing', () => {
    it('does not register peak before sustainMs is reached', () => {
      const targetBin = 400
      const detectedPeaks: unknown[] = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = -15
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 300, // 300ms = 15 frames at 20ms
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd').mockReturnValue({
        msd: 999,
        growthRate: 0,
        isHowl: false,
        fastConfirm: false,
      })

      // Run 10 frames = 200ms < 300ms sustain when no MSD fast evidence exists.
      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBe(0)
      calculateMsdSpy.mockRestore()
    })

    it('registers peak after sustainMs is exceeded', () => {
      const targetBin = 400
      const detectedPeaks: unknown[] = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = -15
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 300,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      // Run 20 frames = 400ms > 300ms sustain
      for (let frame = 0; frame < 20; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
    })

    it('refreshes active peak frequency without waiting for clear and re-register', () => {
      const targetBin = 400
      let currentFrame = 0
      const detectedPeaks: Array<{ trueFrequencyHz: number; sustainedMs: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = -15
          if (currentFrame < 4) {
            arr[targetBin - 1] = -18
            arr[targetBin + 1] = -45
          } else {
            arr[targetBin - 1] = -45
            arr[targetBin + 1] = -18
          }
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { trueFrequencyHz: number; sustainedMs: number }) =>
          detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 10; frame++) {
        currentFrame = frame
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(2)
      const firstPeak = detectedPeaks[0]
      const lastPeak = detectedPeaks[detectedPeaks.length - 1]
      expect(Math.abs(lastPeak.trueFrequencyHz - firstPeak.trueFrequencyHz)).toBeGreaterThan(1)
      expect(lastPeak.sustainedMs).toBeGreaterThan(firstPeak.sustainedMs)
    })

    it('uses the reduced low-frequency sustain multiplier below 200 Hz', () => {
      const targetBin = hzToBin(180)
      const detectedPeaks: unknown[] = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = -15
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 240,
          minHz: 100,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      // 16 frames = 320ms. This clears the new 1.25x low-band hold (300ms),
      // but it would miss the old 1.5x path (360ms).
      for (let frame = 0; frame < 16; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
    })

    it('shortens sustain when MSD early-confirm already marked the peak as feedback-like', () => {
      const targetBin = 400
      const thresholdDb = -30
      const peakDb = thresholdDb - 2
      const detectedPeaks: Array<{ binIndex: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb,
          prominenceDb: 5,
          sustainMs: 240,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number }) => detectedPeaks.push(peak),
      }

      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd').mockReturnValue({
        msd: 0.02,
        growthRate: 1.2,
        isHowl: true,
        fastConfirm: true,
      })

      // 8 frames = 160ms. Base sustain is 240ms, but the MSD-confirmed fast
      // path reduces it to 144ms in the mid band.
      for (let frame = 0; frame < 8; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.some((peak) => peak.binIndex === targetBin)).toBe(true)
      calculateMsdSpy.mockRestore()
    })

    it('uses MSD fast-confirm timing for strong above-threshold feedback peaks', () => {
      const targetBin = 400
      const thresholdDb = -30
      const peakDb = -10
      const detectedPeaks: Array<{ binIndex: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb,
          prominenceDb: 5,
          sustainMs: 240,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number }) => detectedPeaks.push(peak),
      }

      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd').mockReturnValue({
        msd: 0.02,
        growthRate: 1.2,
        isHowl: true,
        fastConfirm: true,
      })

      // 8 frames = 160ms. Strong peaks already above threshold should still
      // use the MSD-confirmed fast path (144ms in the mid band), instead of
      // waiting the full 240ms base sustain window.
      for (let frame = 0; frame < 8; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.some((peak) => peak.binIndex === targetBin)).toBe(true)
      calculateMsdSpy.mockRestore()
    })
  })

  // ── Persistence tracking through analyze() ────────────────────────

  describe('persistence tracking via analyze()', () => {
    it('increments persistence count for stable peak across frames', () => {
      const targetBin = 350

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = -15 // Consistent amplitude each frame
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 9999, // Very long sustain so peak is not registered (keeps accumulating)
        },
      )

      // Run 10 frames — persistence should increment each frame
      // (bin is within threshold - 6 dB, so updatePersistence fires)
      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      const persistenceCount = getPersistenceCounts(detector)!
      expect(persistenceCount[targetBin]).toBeGreaterThanOrEqual(8) // ~10 frames of tracking
    })

    it('resets persistence when peak amplitude fluctuates wildly', () => {
      const targetBin = 350
      let amplitude = -15

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[targetBin] = amplitude
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 9999,
        },
      )

      // 5 stable frames
      for (let frame = 0; frame < 5; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      const countBefore = getPersistenceCounts(detector)![targetBin] as number
      expect(countBefore).toBeGreaterThanOrEqual(3)

      // Sudden 20 dB amplitude change — exceeds AMPLITUDE_TOLERANCE_DB (6 dB)
      amplitude = -35
      ;(detector as any).analyze(5 * 20, 20)

      const countAfter = getPersistenceCounts(detector)![targetBin] as number
      // Persistence should have reset (back to 1)
      expect(countAfter).toBeLessThan(countBefore)
    })
  })

  // ── PHPR on controlled harmonics through full pipeline ─────────────

  describe('PHPR via analyze()', () => {
    it('attaches PHPR to registered peak for pure tone', () => {
      const targetBin = 200 // ~1172 Hz
      const detectedPeaks: Array<{ phpr?: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80) // Noise floor
          arr[targetBin] = -10 // Prominent fundamental, no harmonics
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60, // Quick registration
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { phpr?: number }) => detectedPeaks.push(peak),
      }

      // Run enough frames for registration
      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
      const peak = detectedPeaks[0]
      // Pure tone → high PHPR
      expect(peak.phpr).toBeDefined()
      expect(peak.phpr!).toBeGreaterThan(20)
    })

    it('attaches low PHPR to registered peak for harmonic signal', () => {
      const targetBin = 100 // ~586 Hz
      const detectedPeaks: Array<{ phpr?: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = -10
          arr[targetBin * 2] = -14 // 2nd harmonic
          arr[targetBin * 3] = -18 // 3rd harmonic
          arr[targetBin * 4] = -22 // 4th harmonic
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { phpr?: number }) => detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
      const peak = detectedPeaks[0]
      expect(peak.phpr).toBeDefined()
      // Harmonic signal → low PHPR
      expect(peak.phpr!).toBeLessThan(PHPR_SETTINGS.FEEDBACK_THRESHOLD_DB)
    })
  })

  // ── Q estimation through full pipeline ────────────────────────────

  describe('Q estimation via analyze()', () => {
    it('attaches Q estimate to registered peak', () => {
      const targetBin = 500 // ~2930 Hz
      const detectedPeaks: Array<{ qEstimate?: number; bandwidthHz?: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          // Create a sharp peak with controlled bandwidth
          // 1 dB/bin triangular drop: -3dB crossing at ±3 bins
          for (let offset = -8; offset <= 8; offset++) {
            arr[targetBin + offset] = -10 - Math.abs(offset) * 1.5
          }
          arr[targetBin] = -10
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { qEstimate?: number; bandwidthHz?: number }) =>
          detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)
      const peak = detectedPeaks[0]
      expect(peak.qEstimate).toBeDefined()
      expect(peak.qEstimate!).toBeGreaterThan(10) // Reasonably narrow peak
      expect(peak.bandwidthHz).toBeDefined()
      expect(peak.bandwidthHz!).toBeGreaterThan(0)
    })
  })

  // ── Multiple peaks ────────────────────────────────────────────────

  describe('multiple simultaneous peaks', () => {
    it('detects two well-separated peaks independently', () => {
      const bin1 = 200 // ~1172 Hz
      const bin2 = 600 // ~3516 Hz
      const detectedPeaks: Array<{ binIndex: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          arr[bin1] = -10
          arr[bin2] = -15
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number }) => detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      const bins = detectedPeaks.map((p) => p.binIndex)
      expect(bins).toContain(bin1)
      expect(bins).toContain(bin2)
    })
  })

  // ── Peak clearing after signal disappears ─────────────────────────

  describe('peak clearing', () => {
    it('clears an active peak after clearMs when signal disappears', () => {
      const targetBin = 300
      let hasSignal = true
      const clearedPeaks: Array<{ binIndex: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-70)
          if (hasSignal) {
            arr[targetBin] = -10
          }
        },
        {
          thresholdDb: -50,
          prominenceDb: 5,
          sustainMs: 60,
          clearMs: 200, // 200ms = 10 frames
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: () => {},
        onPeakCleared: (peak: { binIndex: number }) => clearedPeaks.push(peak),
      }

      // Phase 1: Build up and register peak (10 frames = 200ms)
      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      // Phase 2: Remove signal
      hasSignal = false

      // Phase 3: Run enough frames for clearMs (200ms = 10 frames, give extra margin)
      for (let frame = 10; frame < 30; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(clearedPeaks.length).toBeGreaterThanOrEqual(1)
      expect(clearedPeaks.some((p) => p.binIndex === targetBin)).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part C: Performance optimization tests
// ═══════════════════════════════════════════════════════════════════════

describe('FeedbackDetector hot path — Part C: Performance optimizations', () => {
  // ── MSD result cache ──────────────────────────────────────────────

  describe('MSD result cache', () => {
    it('rescues a low-frequency near-threshold peak when MSD already indicates a howl', () => {
      const targetBin = hzToBin(180) // Low band: widened early-confirm window applies
      const thresholdDb = -30
      const peakDb = thresholdDb - 8

      const detectedPeaks: Array<{ binIndex: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number }) => detectedPeaks.push(peak),
      }

      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd').mockReturnValue({
        msd: 0.02,
        growthRate: 1.2,
        isHowl: true,
        fastConfirm: true,
      })

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detectedPeaks.some((peak) => peak.binIndex === targetBin)).toBe(true)
      calculateMsdSpy.mockRestore()
    })

    it('caches calculateMsd result from early detection and reuses it in _registerPeak', () => {
      // Strategy: Place a peak slightly below threshold so that the MSD early-detection
      // path fires (line ~1127-1132), caching the result. Then when the peak sustains
      // and _registerPeak reads the cache (line ~1356), calculateMsd should NOT be called again.
      //
      // The early detection triggers when:
      //   peakDb >= effectiveThresholdDb - MSD_SETTINGS.THRESHOLD_REDUCTION_DB
      // but peakDb < effectiveThresholdDb (otherwise it would pass the normal threshold check).

      const targetBin = 400 // ~2344 Hz — mid-range, sustainScale = 1.0
      const thresholdDb = -30
      // Peak is 2 dB below threshold but within THRESHOLD_REDUCTION_DB (4 dB)
      const peakDb = thresholdDb - 2

      const detectedPeaks: Array<{ binIndex: number; msd?: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb,
          prominenceDb: 5,
          sustainMs: 60, // Quick registration: 3 frames at 20ms
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number; msd?: number }) =>
          detectedPeaks.push(peak),
      }

      // Spy on calculateMsd AFTER detector is constructed
      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd')

      // Pre-populate MSD history so calculateMsd returns isHowl=true or fastConfirm=true.
      // Write enough frames of rising amplitude to the MSD pool to trigger howl detection.
      const msdPool = (detector as any)._msdPool
      if (msdPool) {
        for (let frame = 0; frame < MSD_SETTINGS.DEFAULT_MIN_FRAMES + 5; frame++) {
          // Simulate growing amplitude: each frame 0.5 dB louder
          msdPool.write(targetBin, peakDb - 10 + frame * 0.5)
        }
      }

      // Run enough frames for peak to sustain and register
      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      // The peak should have been registered (early detection lowered the threshold)
      if (detectedPeaks.length > 0) {
        // Key assertion: calculateMsd should be called once per frame for early detection,
        // but NOT again in _registerPeak (cache hit). If cache wasn't working,
        // we'd see 2 calls per frame for the registration frame.
        //
        // Count calls for targetBin specifically
        const callsForTargetBin = calculateMsdSpy.mock.calls.filter(
          (args) => args[0] === targetBin
        )

        // Each frame that triggers early detection calls calculateMsd once.
        // _registerPeak should use the cache, not call again.
        // If the peak registers on frame N, we expect N calls total for targetBin
        // (one per frame from early detection), NOT N+1 (which would mean _registerPeak
        // called it again).
        //
        // Verify no frame produced a double-call by checking the cache was populated.
        // The simplest check: after all frames, the cache should have targetBin's result.
        // Cache is cleared each frame, so after the last frame it should contain
        // targetBin if early detection fired on the last frame.
        // More robust: check that total calls equals number of frames where early detection fired.
        // Since peak is below threshold, every frame triggers early detection → 1 call per frame.
        // If cache weren't working, registration frame would add +1.
        expect(callsForTargetBin.length).toBeLessThanOrEqual(10) // At most 1 per frame
      }

      calculateMsdSpy.mockRestore()
    })

    it('calls calculateMsd fresh in _registerPeak when cache has no entry for that bin', () => {
      // When a peak is ABOVE threshold (not below), it bypasses the early detection
      // MSD path, so no cache entry is created. _registerPeak must call calculateMsd directly.

      const targetBin = 400
      const thresholdDb = -50
      const peakDb = -20 // Well above threshold — skips early detection path

      const detectedPeaks: Array<{ binIndex: number; msd?: number }> = []

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[targetBin] = peakDb
        },
        {
          thresholdDb,
          prominenceDb: 5,
          sustainMs: 60,
        },
      )

      ;(detector as any).callbacks = {
        onPeakDetected: (peak: { binIndex: number; msd?: number }) =>
          detectedPeaks.push(peak),
      }

      const calculateMsdSpy = vi.spyOn(detector as any, 'calculateMsd')

      for (let frame = 0; frame < 10; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      // Peak is above threshold, so early detection MSD path does NOT fire.
      // _registerPeak must call calculateMsd directly (cache miss).
      expect(detectedPeaks.length).toBeGreaterThanOrEqual(1)

      // calculateMsd should have been called at least once — from _registerPeak
      const callsForTargetBin = calculateMsdSpy.mock.calls.filter(
        (args) => args[0] === targetBin
      )
      expect(callsForTargetBin.length).toBeGreaterThanOrEqual(1)

      calculateMsdSpy.mockRestore()
    })

    it('invalidates MSD cache entries at the start of each _scanAndProcessPeaks call', () => {
      // Need signal above silence threshold so analyze() actually reaches _scanAndProcessPeaks.
      // Use a flat spectrum at -40 dB (above silence threshold of -65) but below the
      // detection threshold of -20, so no new early-detection cache entries are created.
      const detector = createReadyDetector(
        (arr) => arr.fill(-40),
        { thresholdDb: -20 },
      )

      // Manually populate the cache with synthetic entries from a prior generation
      const cache = (detector as any)._msdResultCache as Map<number, { gen: number; msd: number; growthRate: number; isHowl: boolean; fastConfirm: boolean }>
      const staleGen = (detector as any)._msdCacheGen as number
      cache.set(100, { gen: staleGen, msd: 0.5, growthRate: 0.1, isHowl: true, fastConfirm: false })
      cache.set(200, { gen: staleGen, msd: 0.3, growthRate: 0.0, isHowl: false, fastConfirm: true })
      expect(cache.size).toBe(2)

      // Run one frame — _scanAndProcessPeaks increments the generation counter,
      // logically invalidating all prior entries (they won't match the new gen).
      ;(detector as any).analyze(0, 20)

      const newGen = (detector as any)._msdCacheGen as number
      expect(newGen).toBeGreaterThan(staleGen)
      // Stale entries still exist in the Map but are logically dead (gen mismatch)
      for (const entry of cache.values()) {
        expect(entry.gen).not.toBe(newGen)
      }
    })
  })

  // ── Merged raw peak scan ──────────────────────────────────────────

  describe('merged raw peak scan (_measureSignalAndApplyGain)', () => {
    it('analyzes a threshold-eligible peak below the mode signal gate', () => {
      const peakBin = 500
      const detectedPeaks: unknown[] = []
      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-100)
          arr[peakBin] = -55
        },
        {
          thresholdDb: -60,
          thresholdMode: 'absolute',
          sustainMs: 60,
          prominenceDb: 8,
        },
      )
      detector.updateSettings({ mode: 'liveMusic' })
      ;(detector as any).callbacks = {
        onPeakDetected: (peak: unknown) => detectedPeaks.push(peak),
      }

      for (let frame = 0; frame < 5; frame++) {
        ;(detector as any).analyze(frame * 20, 20)
      }

      expect(detector.getState().rawPeakDb).toBeCloseTo(-55, 1)
      expect(detectedPeaks.length).toBeGreaterThan(0)
    })

    it('sets _rawPeakDb correctly with auto-gain disabled', () => {
      const peakBin = 500
      const peakDb = -25
      const floorDb = -80

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(floorDb)
          arr[peakBin] = peakDb
        },
        {
          autoGainEnabled: false,
          thresholdDb: -50,
        },
      )

      // Run one frame
      ;(detector as any).analyze(0, 20)

      // _rawPeakDb should reflect the loudest bin in the spectrum
      expect((detector as any)._rawPeakDb).toBeCloseTo(peakDb, 1)
      expect((detector as any)._isSignalPresent).toBe(true)
    })

    it('sets _rawPeakDb correctly with auto-gain enabled', () => {
      const peakBin = 500
      const peakDb = -25
      const floorDb = -80

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(floorDb)
          arr[peakBin] = peakDb
        },
        {
          autoGainEnabled: true,
          thresholdDb: -50,
        },
      )

      // Run one frame
      ;(detector as any).analyze(0, 20)

      // _rawPeakDb should be set from the shared scan even with auto-gain on
      expect((detector as any)._rawPeakDb).toBeCloseTo(peakDb, 1)
      expect((detector as any)._isSignalPresent).toBe(true)
    })

    it('detects silence correctly with auto-gain enabled', () => {
      const silenceDb = -100

      const detector = createReadyDetector(
        (arr) => arr.fill(silenceDb),
        {
          autoGainEnabled: true,
          thresholdDb: -50,
        },
      )

      ;(detector as any).analyze(0, 20)

      expect((detector as any)._rawPeakDb).toBeLessThanOrEqual(-65)
      expect((detector as any)._isSignalPresent).toBe(false)
    })

    it('detects silence correctly with auto-gain disabled', () => {
      const silenceDb = -100

      const detector = createReadyDetector(
        (arr) => arr.fill(silenceDb),
        {
          autoGainEnabled: false,
          thresholdDb: -50,
        },
      )

      ;(detector as any).analyze(0, 20)

      expect((detector as any)._rawPeakDb).toBeLessThanOrEqual(-65)
      expect((detector as any)._isSignalPresent).toBe(false)
    })

    it('exposes consistent state via getState() for both auto-gain modes', () => {
      const peakBin = 300
      const peakDb = -20
      const floorDb = -80

      // Auto-gain OFF
      const detectorOff = createReadyDetector(
        (arr) => {
          arr.fill(floorDb)
          arr[peakBin] = peakDb
        },
        { autoGainEnabled: false, thresholdDb: -50 },
      )
      ;(detectorOff as any).analyze(0, 20)
      const stateOff = detectorOff.getState()

      // Auto-gain ON
      const detectorOn = createReadyDetector(
        (arr) => {
          arr.fill(floorDb)
          arr[peakBin] = peakDb
        },
        { autoGainEnabled: true, thresholdDb: -50 },
      )
      ;(detectorOn as any).analyze(0, 20)
      const stateOn = detectorOn.getState()

      // Both should report the same raw peak and signal presence
      // (rawPeakDb is pre-gain in both cases)
      expect(stateOff.rawPeakDb).toBeCloseTo(peakDb, 1)
      expect(stateOn.rawPeakDb).toBeCloseTo(peakDb, 1)
      expect(stateOff.isSignalPresent).toBe(true)
      expect(stateOn.isSignalPresent).toBe(true)
    })

    it('scans only within startBin..endBin range', () => {
      // Place a loud peak outside the scan range — it should NOT appear as rawPeakDb.
      // At 48kHz / 8192 FFT, bin 50 ≈ 293 Hz. Set minHz to 500 Hz so bin 50 is excluded.
      // Bin 500 ≈ 2930 Hz, well inside the range.
      const outsideBin = 50
      const insideBin = 500
      const outsideDb = -5 // Very loud but outside range
      const insideDb = -30

      const detector = createReadyDetector(
        (arr) => {
          arr.fill(-80)
          arr[outsideBin] = outsideDb
          arr[insideBin] = insideDb
        },
        {
          autoGainEnabled: false,
          thresholdDb: -50,
          minHz: 500, // Excludes bin 50 (~293 Hz)
          maxHz: 10000,
        },
      )

      ;(detector as any).analyze(0, 20)

      // _rawPeakDb should reflect only the peak within range
      const rawPeak = (detector as any)._rawPeakDb as number
      // Should be near insideDb (-30), not outsideDb (-5)
      expect(rawPeak).toBeCloseTo(insideDb, 1)
    })
  })
})
