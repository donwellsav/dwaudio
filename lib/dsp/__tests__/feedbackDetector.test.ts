/**
 * FeedbackDetector unit tests
 *
 * Tests the pure-math portions of the detector: bin↔frequency conversion,
 * constructor defaults, getState snapshot, and config propagation.
 * Web Audio integration (start/stop/analyze) requires browser APIs
 * and is verified via manual browser testing.
 */

import { describe, it, expect } from 'vitest'
import { FeedbackDetector } from '../feedbackDetector'
import { DEFAULT_CONFIG } from '@/types/advisory'
import { PERSISTENCE_SCORING } from '../constants'

describe('FeedbackDetector', () => {
  // ── Constructor ──────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses DEFAULT_CONFIG when no config provided', () => {
      const detector = new FeedbackDetector()
      const state = detector.getState()
      expect(state.fftSize).toBe(DEFAULT_CONFIG.fftSize)
      expect(state.isRunning).toBe(false)
    })

    it('merges partial config with defaults', () => {
      const detector = new FeedbackDetector({ fftSize: 4096 })
      const state = detector.getState()
      expect(state.fftSize).toBe(4096)
    })
  })

  // ── Bin ↔ Frequency conversion ──────────────────────────────────
  // These are pure-math functions: freq = (bin * sampleRate) / fftSize
  // Without AudioContext, sampleRate defaults to 48000

  describe('binToFrequency', () => {
    it('converts bin 0 to 0 Hz (DC)', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      expect(detector.binToFrequency(0)).toBe(0)
    })

    it('converts bin to correct frequency at default 48kHz', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      // bin 1 = 48000/8192 ≈ 5.859 Hz
      const freq = detector.binToFrequency(1)
      expect(freq).toBeCloseTo(48000 / 8192, 2)
    })

    it('converts Nyquist bin correctly', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      const nyquistBin = 8192 / 2
      // Nyquist = sampleRate / 2 = 24000 Hz
      expect(detector.binToFrequency(nyquistBin)).toBeCloseTo(24000, 0)
    })

    it('works with different FFT sizes', () => {
      const detector = new FeedbackDetector({ fftSize: 4096 })
      // bin 100 at 4096 FFT, 48kHz: 100 * 48000 / 4096 ≈ 1171.875 Hz
      expect(detector.binToFrequency(100)).toBeCloseTo(1171.875, 1)
    })
  })

  describe('frequencyToBin', () => {
    it('converts 0 Hz to bin 0', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      expect(detector.frequencyToBin(0)).toBe(0)
    })

    it('round-trips with binToFrequency', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      const originalBin = 170
      const freq = detector.binToFrequency(originalBin)
      const recoveredBin = detector.frequencyToBin(freq)
      expect(recoveredBin).toBe(originalBin)
    })

    it('rounds to nearest bin for non-exact frequencies', () => {
      const detector = new FeedbackDetector({ fftSize: 8192 })
      // 1000 Hz → bin = round(1000 * 8192 / 48000) = round(170.67) = 171
      expect(detector.frequencyToBin(1000)).toBe(171)
    })
  })

  // ── getState snapshot ────────────────────────────────────────────

  describe('getState', () => {
    it('returns all required fields', () => {
      const detector = new FeedbackDetector()
      const state = detector.getState()

      expect(state).toHaveProperty('isRunning')
      expect(state).toHaveProperty('noiseFloorDb')
      expect(state).toHaveProperty('effectiveThresholdDb')
      expect(state).toHaveProperty('sampleRate')
      expect(state).toHaveProperty('fftSize')
      expect(state).toHaveProperty('autoGainEnabled')
      expect(state).toHaveProperty('autoGainDb')
      expect(state).toHaveProperty('autoGainLocked')
    })

    it('isRunning defaults to false', () => {
      const detector = new FeedbackDetector()
      expect(detector.getState().isRunning).toBe(false)
    })

    it('defaults sampleRate to 48000 without AudioContext', () => {
      const detector = new FeedbackDetector()
      expect(detector.getState().sampleRate).toBe(48000)
      expect(detector.getSampleRate()).toBe(48000)
    })
  })

  // ── updateConfig ────────────────────────────────────────────────

  describe('updateConfig', () => {
    it('updates fftSize', () => {
      const detector = new FeedbackDetector({ fftSize: 4096 })
      detector.updateConfig({ fftSize: 8192 })
      expect(detector.getState().fftSize).toBe(8192)
    })

    it('updates threshold and reflects in effectiveThresholdDb', () => {
      const detector = new FeedbackDetector()
      detector.updateConfig({ thresholdDb: 25 })
      const state = detector.getState()
      expect(state.effectiveThresholdDb).toBeLessThanOrEqual(25)
    })

    it('partial config preserves other settings', () => {
      const detector = new FeedbackDetector({ fftSize: 4096 })
      detector.updateConfig({ thresholdDb: 20 })
      expect(detector.getState().fftSize).toBe(4096)
    })
  })

  // ── Noise floor tracking ──────────────────────────────────────────

  describe('noise floor', () => {
    it('starts as null (no data yet)', () => {
      const detector = new FeedbackDetector()
      const state = detector.getState()
      // noiseFloorDb is null until audio is analyzed
      expect(state.noiseFloorDb).toBeNull()
    })
  })

  // ── Auto-gain state ────────────────────────────────────────────────

  describe('auto-gain state', () => {
    it('defaults to disabled with initial gain', () => {
      const detector = new FeedbackDetector()
      const state = detector.getState()
      expect(state.autoGainEnabled).toBe(false)
      expect(typeof state.autoGainDb).toBe('number')
      expect(state.autoGainLocked).toBe(false)
    })
  })

  // ── setAlgorithmState ────────────────────────────────────────────

  describe('setAlgorithmState', () => {
    it('updates algorithm state fields', () => {
      const detector = new FeedbackDetector()
      detector.setAlgorithmState({
        algorithmMode: 'custom',
        contentType: 'speech',
        isCompressed: false,
      })

      const state = detector.getState()
      expect(state.algorithmMode).toBe('custom')
      expect(state.contentType).toBe('speech')
      expect(state.isCompressed).toBe(false)
    })

    it('partial updates preserve existing algorithm state', () => {
      const detector = new FeedbackDetector()
      detector.setAlgorithmState({ algorithmMode: 'custom' })
      detector.setAlgorithmState({ contentType: 'music' })

      const state = detector.getState()
      expect(state.algorithmMode).toBe('custom')
      expect(state.contentType).toBe('music')
    })
  })

  // ── Frame-rate-independent persistence scoring ─────

  describe('persistence scoring — frame-rate independence', () => {
    /** Helper: get persistence thresholds from getState() */
    function getThresholds(intervalMs: number) {
      const detector = new FeedbackDetector({ analysisIntervalMs: intervalMs })
      const state = detector.getState()
      return state.persistenceThresholds!
    }

    describe('frame threshold computation', () => {
      it('at 50fps (20ms) matches original hardcoded values', () => {
        const t = getThresholds(20)
        // Original constants were: MIN=5, HIGH=15, VERY_HIGH=30, LOW=3, HISTORY=32
        expect(t.minFrames).toBe(5)
        expect(t.highFrames).toBe(15)
        expect(t.veryHighFrames).toBe(30)
        expect(t.lowFrames).toBe(3)
        expect(t.historyFrames).toBe(32)
      })

      it('at 30fps (33.3ms) computes correct frame counts', () => {
        const t = getThresholds(33.3)
        // ceil(100/33.3)=ceil(3.003)=4, ceil(300/33.3)=ceil(9.009)=10,
        // ceil(600/33.3)=ceil(18.018)=19, ceil(60/33.3)=ceil(1.8)=2
        expect(t.minFrames).toBe(Math.ceil(PERSISTENCE_SCORING.MIN_PERSISTENCE_MS / 33.3))
        expect(t.highFrames).toBe(Math.ceil(PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS / 33.3))
        expect(t.veryHighFrames).toBe(Math.ceil(PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_MS / 33.3))
        expect(t.lowFrames).toBe(Math.ceil(PERSISTENCE_SCORING.LOW_PERSISTENCE_MS / 33.3))
      })

      it('at 60fps (16.67ms) computes correct frame counts', () => {
        const t = getThresholds(16.67)
        // ceil(100/16.67)=ceil(5.999)=6, ceil(300/16.67)=ceil(17.996)=18,
        // ceil(600/16.67)=ceil(35.993)=36, ceil(60/16.67)=ceil(3.6)=4
        expect(t.minFrames).toBe(Math.ceil(PERSISTENCE_SCORING.MIN_PERSISTENCE_MS / 16.67))
        expect(t.highFrames).toBe(Math.ceil(PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS / 16.67))
        expect(t.veryHighFrames).toBe(Math.ceil(PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_MS / 16.67))
        expect(t.lowFrames).toBe(Math.ceil(PERSISTENCE_SCORING.LOW_PERSISTENCE_MS / 16.67))
      })

      it('at 25fps (40ms mobile) computes correct frame counts', () => {
        const t = getThresholds(40)
        // ceil(100/40)=3, ceil(300/40)=8, ceil(600/40)=15, ceil(60/40)=2
        expect(t.minFrames).toBe(3)
        expect(t.highFrames).toBe(8)
        expect(t.veryHighFrames).toBe(15)
        expect(t.lowFrames).toBe(2)
        expect(t.historyFrames).toBe(16)
      })
    })

    describe('time equivalence across frame rates', () => {
      it('MIN threshold represents ~100ms regardless of frame rate', () => {
        // At 20ms/frame: 5 frames = 100ms
        // At 40ms/frame: 3 frames = 120ms (ceil rounds up, so ≥ 100ms)
        // At 16.67ms/frame: 6 frames = 100ms
        for (const interval of [16.67, 20, 33.3, 40]) {
          const t = getThresholds(interval)
          const actualMs = t.minFrames * interval
          expect(actualMs).toBeGreaterThanOrEqual(PERSISTENCE_SCORING.MIN_PERSISTENCE_MS)
          // Should not exceed 1 frame's worth of rounding
          expect(actualMs).toBeLessThan(PERSISTENCE_SCORING.MIN_PERSISTENCE_MS + interval)
        }
      })

      it('HIGH threshold represents ~300ms regardless of frame rate', () => {
        for (const interval of [16.67, 20, 33.3, 40]) {
          const t = getThresholds(interval)
          const actualMs = t.highFrames * interval
          expect(actualMs).toBeGreaterThanOrEqual(PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS)
          expect(actualMs).toBeLessThan(PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS + interval)
        }
      })

      it('VERY_HIGH threshold represents ~600ms regardless of frame rate', () => {
        for (const interval of [16.67, 20, 33.3, 40]) {
          const t = getThresholds(interval)
          const actualMs = t.veryHighFrames * interval
          expect(actualMs).toBeGreaterThanOrEqual(PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_MS)
          expect(actualMs).toBeLessThan(PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_MS + interval)
        }
      })
    })

    describe('updateConfig recomputes thresholds', () => {
      it('changing analysisIntervalMs updates persistence thresholds', () => {
        const detector = new FeedbackDetector({ analysisIntervalMs: 20 })
        expect(detector.getState().persistenceThresholds!.minFrames).toBe(5)

        detector.updateConfig({ analysisIntervalMs: 40 })
        expect(detector.getState().persistenceThresholds!.minFrames).toBe(3)
      })
    })

    describe('getState exposes persistenceThresholds', () => {
      it('includes persistenceThresholds in state snapshot', () => {
        const detector = new FeedbackDetector()
        const state = detector.getState()
        expect(state.persistenceThresholds).toBeDefined()
        expect(state.persistenceThresholds).toHaveProperty('minFrames')
        expect(state.persistenceThresholds).toHaveProperty('highFrames')
        expect(state.persistenceThresholds).toHaveProperty('veryHighFrames')
        expect(state.persistenceThresholds).toHaveProperty('lowFrames')
        expect(state.persistenceThresholds).toHaveProperty('historyFrames')
      })
    })
  })

})
