/**
 * MSDPool — Pooled Sparse MSD (Magnitude Slope Deviation) History Buffer
 *
 * Consolidates the dual MSD implementations (feedbackDetector.ts + msdAnalysis.ts)
 * into a single class used by both the main thread and the web worker.
 *
 * Tracks per-bin magnitude histories using a fixed-size slot pool with LRU eviction.
 * Memory: poolSize × historySize × 4 bytes (default: 256 × 64 × 4 = 64 KB).
 *
 * Normalized MSD variant of the DAFx-16 summing method:
 *   MSD = mean(|G''(k,n)|²) for n in [2, frameCount)
 *   where G''(k,n) = G(k,n) − 2·G(k,n−1) + G(k,n−2)   (3-point second derivative)
 *
 * The paper sums these terms; this implementation takes their mean so the
 * score remains comparable as history length grows. Its threshold is local
 * calibration and must not be treated as the paper's published threshold.
 * Low MSD ≈ feedback (constant magnitude trajectory).
 * High MSD ≈ music/speech (variable magnitude trajectory).
 *
 * @see lib/dsp/constants.ts — MSD_SETTINGS for pool size, history size, thresholds
 * @see tests/__tests__/msdConsistency.test.ts — numerical equivalence tests
 */

import { MSD_SETTINGS } from './constants'

// ── Result type ──────────────────────────────────────────────────────────────

export interface MSDRawResult {
  /** Mean-squared second derivative (dB²/frame²). Lower = more feedback-like. -1 = insufficient frames. */
  msd: number
  /** Average first derivative (dB/frame). Positive = growing, negative = decaying. */
  growthRate: number
  /** Number of magnitude frames accumulated for this bin. */
  frameCount: number
}

/** Sentinel returned when a bin has no slot or insufficient frames. */
const NO_RESULT: Readonly<MSDRawResult> = Object.freeze({ msd: -1, growthRate: 0, frameCount: 0 })

// ── MSDPool class ────────────────────────────────────────────────────────────

export class MSDPool {
  // Contiguous ring buffer: poolSize × historySize floats
  private readonly _pool: Float32Array
  // Per-slot write index (ring buffer position, 0 to historySize−1)
  private readonly _writeIndex: Uint8Array
  // Per-slot frame count (capped at historySize)
  private readonly _frameCount: Uint16Array
  // Per-slot last-update timestamp (monotonic counter for LRU eviction)
  private readonly _age: Uint32Array
  // bin → slot mapping
  private readonly _binToSlot: Map<number, number>
  // slot → bin reverse mapping for O(1) eviction lookup (avoids Map iteration)
  private readonly _slotToBin: Int32Array
  // Available slot indices (LIFO stack)
  private _freeSlots: number[]
  // Global monotonic counter for LRU timestamps
  private _clock: number
  // Preallocated scratch buffer for ordered index computation (avoids per-call allocation)
  private readonly _scratch: Int32Array

  private readonly _poolSize: number
  private readonly _historySize: number
  // Bitmask for ring buffer wrap: historySize − 1 (requires power-of-2 historySize)
  private readonly _mask: number

  /**
   * @param poolSize   Number of concurrent bin slots (default: 256)
   * @param historySize Ring buffer depth per slot (default: 64, must be power of 2)
   */
  constructor(
    poolSize: number = MSD_SETTINGS.POOL_SIZE,
    historySize: number = MSD_SETTINGS.HISTORY_SIZE,
  ) {
    if ((historySize & (historySize - 1)) !== 0) {
      throw new Error(`MSDPool: historySize must be power of 2, got ${historySize}`)
    }

    this._poolSize = poolSize
    this._historySize = historySize
    this._mask = historySize - 1

    this._pool = new Float32Array(poolSize * historySize)
    this._writeIndex = new Uint8Array(poolSize)
    this._frameCount = new Uint16Array(poolSize)
    this._age = new Uint32Array(poolSize)
    this._binToSlot = new Map()
    this._slotToBin = new Int32Array(poolSize).fill(-1)
    this._freeSlots = Array.from({ length: poolSize }, (_, i) => i)
    this._clock = 0
    this._scratch = new Int32Array(historySize)
  }

  // ── Write ────────────────────────────────────────────────────────────────

  /**
   * Write a magnitude sample for a single bin.
   * Allocates a slot if the bin has no history yet (LRU eviction if pool is full).
   */
  write(binIndex: number, magnitudeDb: number): void {
    this._clock++

    let slot = this._binToSlot.get(binIndex)
    if (slot === undefined) {
      slot = this._allocateSlot(binIndex)
    }

    const offset = slot * this._historySize
    const idx = this._writeIndex[slot]

    // Store magnitude in ring buffer
    this._pool[offset + idx] = magnitudeDb

    // Advance write pointer (wrap via bitmask — historySize is power of 2)
    this._writeIndex[slot] = (idx + 1) & this._mask

    // Increment frame count (capped at historySize)
    if (this._frameCount[slot] < this._historySize) {
      this._frameCount[slot]++
    }

    // Update LRU timestamp
    this._age[slot] = this._clock
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Compute MSD and growth rate for a bin.
   *
   * @param binIndex  FFT bin index
   * @param minFrames Minimum frames required before computing (content-adaptive)
   * @returns MSDRawResult with msd, growthRate, frameCount. msd = -1 if insufficient data.
   */
  getMSD(binIndex: number, minFrames: number): MSDRawResult {
    // Slot lookup — no slot means no history for this bin
    const slot = this._binToSlot.get(binIndex)
    if (slot === undefined) return NO_RESULT

    const frameCount = this._frameCount[slot]
    if (frameCount < minFrames) return NO_RESULT

    const poolOffset = slot * this._historySize
    const currentIdx = this._writeIndex[slot]

    // ─── Phase 1: Precompute ordered indices into scratch buffer ───
    // Eliminates per-element modulo in the hot loop
    const ordered = this._scratch
    for (let i = 0; i < frameCount; i++) {
      ordered[i] = (currentIdx - frameCount + i + this._historySize) & this._mask
    }

    // ─── Phase 2: First derivative (growth rate) ───
    let sumFirstDeriv = 0
    let prevVal = this._pool[poolOffset + ordered[0]]
    for (let i = 1; i < frameCount; i++) {
      const val = this._pool[poolOffset + ordered[i]]
      sumFirstDeriv += val - prevVal
      prevVal = val
    }
    const numFirstDeriv = frameCount - 1
    const growthRate = numFirstDeriv > 0 ? sumFirstDeriv / numFirstDeriv : 0

    // ─── Phase 3: Second derivative (the MSD formula) ───
    // 3-point stencil: d² = d1[i] − d1[i−1] = y[i] − 2y[i−1] + y[i−2]
    let sumSquaredSecondDeriv = 0
    let prevD1 = this._pool[poolOffset + ordered[1]] - this._pool[poolOffset + ordered[0]]
    for (let i = 2; i < frameCount; i++) {
      const d1 = this._pool[poolOffset + ordered[i]] - this._pool[poolOffset + ordered[i - 1]]
      const d2 = d1 - prevD1
      sumSquaredSecondDeriv += d2 * d2
      prevD1 = d1
    }

    const numSecondDeriv = frameCount - 2
    const msd = numSecondDeriv > 0 ? sumSquaredSecondDeriv / numSecondDeriv : 0

    return { msd, growthRate, frameCount }
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /** Get frame count for a bin (0 if no slot allocated). */
  getFrameCount(binIndex: number): number {
    const slot = this._binToSlot.get(binIndex)
    return slot !== undefined ? this._frameCount[slot] : 0
  }

  /** Check if a bin has an allocated slot. */
  has(binIndex: number): boolean {
    return this._binToSlot.has(binIndex)
  }

  /** Number of currently allocated (active) slots. */
  get activeSlotCount(): number {
    return this._binToSlot.size
  }

  /** Maximum frame count across all active slots. */
  get maxFrameCount(): number {
    let max = 0
    for (const slot of this._binToSlot.values()) {
      if (this._frameCount[slot] > max) max = this._frameCount[slot]
    }
    return max
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Release a bin's slot back to the pool.
   * Call when a peak clears to free the slot for reuse.
   */
  release(binIndex: number): void {
    const slot = this._binToSlot.get(binIndex)
    if (slot === undefined) return

    // Zero out the slot's history
    const offset = slot * this._historySize
    this._pool.fill(0, offset, offset + this._historySize)
    this._writeIndex[slot] = 0
    this._frameCount[slot] = 0

    // Remove mapping and return slot to free list
    this._binToSlot.delete(binIndex)
    this._freeSlots.push(slot)
  }

  /** Reset all slots, free all mappings. */
  reset(): void {
    this._pool.fill(0)
    this._writeIndex.fill(0)
    this._frameCount.fill(0)
    this._age.fill(0)
    this._binToSlot.clear()
    this._slotToBin.fill(-1)
    this._freeSlots = Array.from({ length: this._poolSize }, (_, i) => i)
    this._clock = 0
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Allocate a pool slot for a bin. If pool is full, evict LRU (oldest) slot.
   * O(poolSize) scan for eviction — runs only when all 256 slots are occupied.
   */
  private _allocateSlot(binIndex: number): number {
    let slot: number

    if (this._freeSlots.length > 0) {
      // O(1): pop from free list
      slot = this._freeSlots.pop()!
    } else {
      // O(poolSize): LRU eviction — find slot with oldest timestamp
      let oldestAge = Infinity
      let oldestSlot = 0
      for (let i = 0; i < this._poolSize; i++) {
        if (this._age[i] < oldestAge) {
          oldestAge = this._age[i]
          oldestSlot = i
        }
      }
      slot = oldestSlot

      // O(1) evicted bin lookup via reverse mapping (replaces Map iteration)
      const evictedBin = this._slotToBin[slot]
      if (evictedBin >= 0) {
        this._binToSlot.delete(evictedBin)
      }
    }

    // Initialize slot
    const offset = slot * this._historySize
    this._pool.fill(0, offset, offset + this._historySize)
    this._writeIndex[slot] = 0
    this._frameCount[slot] = 0
    this._binToSlot.set(binIndex, slot)
    this._slotToBin[slot] = binIndex

    return slot
  }
}
