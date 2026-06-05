/**
 * Precomputed dB → linear power lookup table
 *
 * Replaces Math.pow(10, db/10) in hot loops with ~3× faster LUT access.
 * Range: [-100, +30] dB at 0.1 dB steps = 1301 entries × 4 bytes = 5.2KB.
 * Extended from [-100, 0] to handle A-weighting offsets
 * (+12dB) extremes without clamp-induced quantization error.
 *
 * Shared by both main thread (feedbackDetector.ts) and worker thread
 * (workerFft.ts). Safe because the worker bundle includes this module
 * directly — no cross-thread import.
 *
 * Index formula: lutIdx = ((db + 100) * 10 + 0.5) | 0
 *
 * @see DAFx-16 (Aalto, 2016) — MSD algorithm uses this for magnitude conversion
 */

export const EXP_LUT = /* @__PURE__ */ (() => {
  const table = new Float32Array(1301)
  for (let i = 0; i <= 1300; i++) {
    table[i] = Math.pow(10, (i / 10 - 100) / 10)
  }
  return table
})()

/** Convert dB to linear power via LUT. ~3× faster than Math.pow(10, db/10). */
export function dbToLinearLut(db: number): number {
  const idx = ((db + 100) * 10 + 0.5) | 0
  return EXP_LUT[idx < 0 ? 0 : idx > 1300 ? 1300 : idx]
}
