/**
 * Persistence Scoring — Per-Bin Amplitude History Tracking
 *
 * Tracks how long a spectral peak persists at similar amplitude across
 * consecutive analysis frames. Persistent peaks are more likely to be
 * feedback; transient peaks are more likely to be music/speech.
 *
 * Orthogonal to peak detection — reads bin amplitude, writes to its own
 * per-bin arrays, returns a score. No coupling to hold/dead timers or MSD.
 *
 * Extracted from FeedbackDetector for maintainability and testability.
 */

import { PERSISTENCE_SCORING, MODE_PERSISTENCE_HIGH_MS } from './constants'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersistenceScore {
  frames: number
  boost: number
  penalty: number
  isPersistent: boolean
  isHighlyPersistent: boolean
  isVeryHighlyPersistent: boolean
}

// ── Tracker ─────────────────────────────────────────────────────────────────

export class PersistenceTracker {
  private _count: Uint16Array
  private _lastDb: Float32Array
  private _elapsedMs: Float32Array
  private _historyFrames = 0
  private _highMs: number = PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS
  private _veryHighMs: number = PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_MS

  constructor(binCount: number, intervalMs = 20, mode = 'speech') {
    this._count = new Uint16Array(binCount)
    this._lastDb = new Float32Array(binCount)
    this._elapsedMs = new Float32Array(binCount)
    this._lastDb.fill(-200)
    // Initialize frame thresholds with sensible defaults
    this.recomputeFrameThresholds(intervalMs, mode)
  }

  /**
   * Recompute frame thresholds from analysis interval and mode.
   * Must be called when analysisIntervalMs or mode changes.
   */
  recomputeFrameThresholds(intervalMs: number, mode: string): void {
    const highMs = MODE_PERSISTENCE_HIGH_MS[mode] ?? PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS
    const veryHighMs = highMs * 2
    this._highMs = highMs
    this._veryHighMs = veryHighMs

    this._historyFrames = Math.ceil(PERSISTENCE_SCORING.HISTORY_MS / intervalMs)
  }

  /**
   * Update persistence count for a frequency bin.
   * Tracks consecutive frames where amplitude stays within tolerance.
   */
  update(binIndex: number, amplitudeDb: number, elapsedMs: number = 20): void {
    const lastDb = this._lastDb[binIndex]
    const dbDiff = Math.abs(amplitudeDb - lastDb)
    const safeElapsedMs = Math.max(0, elapsedMs)

    if (dbDiff <= PERSISTENCE_SCORING.AMPLITUDE_TOLERANCE_DB && lastDb > -150) {
      this._count[binIndex] = Math.min(
        this._count[binIndex] + 1,
        this._historyFrames,
      )
      this._elapsedMs[binIndex] = Math.min(
        this._elapsedMs[binIndex] + safeElapsedMs,
        Math.max(PERSISTENCE_SCORING.HISTORY_MS, this._veryHighMs),
      )
    } else {
      this._count[binIndex] = 1
      this._elapsedMs[binIndex] = safeElapsedMs
    }

    this._lastDb[binIndex] = amplitudeDb
  }

  /**
   * Get persistence score for a frequency bin.
   * Returns boost/penalty based on how many frames the peak has persisted.
   */
  getScore(binIndex: number): PersistenceScore {
    const frames = this._count[binIndex]
    const elapsedMs = this._elapsedMs[binIndex]
    let boost = 0
    let penalty = 0

    if (elapsedMs >= this._veryHighMs) {
      boost = PERSISTENCE_SCORING.VERY_HIGH_PERSISTENCE_BOOST
    } else if (elapsedMs >= this._highMs) {
      boost = PERSISTENCE_SCORING.HIGH_PERSISTENCE_BOOST
    } else if (elapsedMs >= PERSISTENCE_SCORING.MIN_PERSISTENCE_MS) {
      boost = PERSISTENCE_SCORING.MIN_PERSISTENCE_BOOST
    } else if (elapsedMs < PERSISTENCE_SCORING.LOW_PERSISTENCE_MS) {
      penalty = PERSISTENCE_SCORING.LOW_PERSISTENCE_PENALTY
    }

    return {
      frames,
      boost,
      penalty,
      isPersistent: elapsedMs >= PERSISTENCE_SCORING.MIN_PERSISTENCE_MS,
      isHighlyPersistent: elapsedMs >= this._highMs,
      isVeryHighlyPersistent: elapsedMs >= this._veryHighMs,
    }
  }

  /** Direct access to count buffer (for test compatibility). */
  get counts(): Uint16Array { return this._count }

  /** Direct access to lastDb buffer (for test compatibility). */
  get lastDbs(): Float32Array { return this._lastDb }

  /** Clear a specific bin's persistence (e.g. on peak clearance). */
  clearBin(binIndex: number): void {
    this._count[binIndex] = 0
    this._lastDb[binIndex] = -200
    this._elapsedMs[binIndex] = 0
  }

  /** Reset all bins. */
  reset(): void {
    this._count.fill(0)
    this._lastDb.fill(-200)
    this._elapsedMs.fill(0)
  }
}
