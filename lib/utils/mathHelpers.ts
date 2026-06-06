// DoneWell Audio Math Utilities - Zero-allocation helpers for DSP

import { LN10_OVER_10 } from '@/lib/dsp/constants'

/**
 * Convert dB to linear power using precomputed constant
 * power = 10^(dB/10) = exp(dB * ln(10)/10)
 */
export function dBToPower(db: number): number {
  return Math.exp(db * LN10_OVER_10)
}

/**
 * Convert linear power to dB
 * dB = 10 * log10(power)
 */
export function powerToDb(power: number): number {
  if (power <= 0) return -Infinity
  return 10 * Math.log10(power)
}

/**
 * Convert dB to amplitude (voltage)
 * amplitude = 10^(dB/20)
 */
export function dBToAmplitude(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * Convert amplitude to dB
 * dB = 20 * log10(amplitude)
 */
export function amplitudeToDb(amplitude: number): number {
  if (amplitude <= 0) return -Infinity
  return 20 * Math.log10(amplitude)
}

/**
 * In-place quickselect for finding k-th smallest element
 * Modifies the input array - use for noise floor median calculation
 * Returns the k-th smallest value (0-indexed)
 */
export function quickselect(arr: Float32Array, k: number): number {
  if (arr.length === 0) return NaN
  let left = 0
  let right = arr.length - 1

  while (right > left) {
    // Median-of-three pivot selection
    const mid = (left + right) >> 1
    const a = arr[left]
    const b = arr[mid]
    const c = arr[right]

    let pivotIndex: number
    if (a < b) {
      if (b < c) pivotIndex = mid
      else pivotIndex = a < c ? right : left
    } else {
      if (a < c) pivotIndex = left
      else pivotIndex = b < c ? right : mid
    }

    const pivotNewIndex = partition(arr, left, right, pivotIndex)

    if (k === pivotNewIndex) return arr[k]
    if (k < pivotNewIndex) right = pivotNewIndex - 1
    else left = pivotNewIndex + 1
  }

  return arr[left]
}

function partition(arr: Float32Array, left: number, right: number, pivotIndex: number): number {
  const pivotValue = arr[pivotIndex]

  // Swap pivot to end
  let tmp = arr[pivotIndex]
  arr[pivotIndex] = arr[right]
  arr[right] = tmp

  let storeIndex = left

  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      tmp = arr[storeIndex]
      arr[storeIndex] = arr[i]
      arr[i] = tmp
      storeIndex++
    }
  }

  // Move pivot to final place
  tmp = arr[right]
  arr[right] = arr[storeIndex]
  arr[storeIndex] = tmp

  return storeIndex
}

/**
 * Zero-allocation in-place median using quickselect
 * Note: Modifies array order
 */
export function medianInPlace(arr: Float32Array): number {
  const len = arr.length
  if (len === 0) return -Infinity
  const mid = len >> 1

  if (len & 1) {
    // Odd length
    return quickselect(arr, mid)
  }

  // Even length: average of two middle elements
  const a = quickselect(arr, mid - 1)
  const b = quickselect(arr, mid)
  return 0.5 * (a + b)
}

// ── Float64Array Variants ───────────────────────────────────────────────────

/**
 * In-place quickselect for Float64Array — k-th smallest element.
 * Same algorithm as Float32Array variant; duplicated to avoid union overhead
 * on the hot path (~500 calls/sec in compression detection).
 */
export function quickselect64(arr: Float64Array, k: number): number {
  if (arr.length === 0) return NaN
  let left = 0
  let right = arr.length - 1

  while (right > left) {
    const mid = (left + right) >> 1
    const a = arr[left]
    const b = arr[mid]
    const c = arr[right]

    let pivotIndex: number
    if (a < b) {
      if (b < c) pivotIndex = mid
      else pivotIndex = a < c ? right : left
    } else {
      if (a < c) pivotIndex = left
      else pivotIndex = b < c ? right : mid
    }

    const pivotNewIndex = partition64(arr, left, right, pivotIndex)

    if (k === pivotNewIndex) return arr[k]
    if (k < pivotNewIndex) right = pivotNewIndex - 1
    else left = pivotNewIndex + 1
  }

  return arr[left]
}

function partition64(arr: Float64Array, left: number, right: number, pivotIndex: number): number {
  const pivotValue = arr[pivotIndex]

  let tmp = arr[pivotIndex]
  arr[pivotIndex] = arr[right]
  arr[right] = tmp

  let storeIndex = left

  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      tmp = arr[storeIndex]
      arr[storeIndex] = arr[i]
      arr[i] = tmp
      storeIndex++
    }
  }

  tmp = arr[right]
  arr[right] = arr[storeIndex]
  arr[storeIndex] = tmp

  return storeIndex
}

/**
 * Zero-allocation in-place median for Float64Array using quickselect.
 * Note: Modifies array order.
 */
export function medianInPlace64(arr: Float64Array): number {
  const len = arr.length
  if (len === 0) return -Infinity
  const mid = len >> 1

  if (len & 1) {
    return quickselect64(arr, mid)
  }

  const a = quickselect64(arr, mid - 1)
  const b = quickselect64(arr, mid)
  return 0.5 * (a + b)
}

/**
 * Build prefix sum array for O(1) range queries
 * Output array has length n+1, with prefix[0] = 0
 */
export function buildPrefixSum(input: Float32Array, output: Float64Array): void {
  output[0] = 0
  for (let i = 0; i < input.length; i++) {
    output[i + 1] = output[i] + input[i]
  }
}

/**
 * Query sum of range [start, end) from prefix array
 */
export function rangeSum(prefix: Float64Array, start: number, end: number): number {
  return prefix[end] - prefix[start]
}

/**
 * Calculate standard deviation (single pass, online algorithm)
 */
export function standardDeviation(values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  if (n === 1) return 0

  let mean = 0
  let m2 = 0

  for (let i = 0; i < n; i++) {
    const delta = values[i] - mean
    mean += delta / (i + 1)
    const delta2 = values[i] - mean
    m2 += delta * delta2
  }

  return Math.sqrt(m2 / (n - 1))
}

/**
 * Exponential moving average update
 * alpha = 1 - exp(-dt/tau) for time-based smoothing
 */
export function emaUpdate(current: number, target: number, alpha: number): number {
  return current + alpha * (target - current)
}

/**
 * Calculate EMA alpha from time constant and delta time
 */
export function emaAlpha(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-dtMs / tauMs)
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Map value from one range to another
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

/**
 * Convert frequency to log scale position (for RTA display)
 * Returns 0-1 range for freqMin to freqMax
 */
export function freqToLogPosition(freq: number, freqMin: number, freqMax: number): number {
  const logMin = Math.log10(freqMin)
  const logMax = Math.log10(freqMax)
  const logFreq = Math.log10(freq)
  return (logFreq - logMin) / (logMax - logMin)
}

/**
 * Fast variant for hot loops — caller pre-computes logMin and invLogRange once,
 * reducing Math.log10 calls from 3 per bin to 1 per bin.
 *
 * Usage:
 *   const logMin = Math.log10(freqMin)
 *   const invLogRange = 1 / (Math.log10(freqMax) - logMin)
 *   // in loop:
 *   const x = freqToLogPositionFast(freq, logMin, invLogRange)
 */
export function freqToLogPositionFast(freq: number, logMin: number, invLogRange: number): number {
  return (Math.log10(freq) - logMin) * invLogRange
}

/**
 * Convert log scale position to frequency
 */
export function logPositionToFreq(position: number, freqMin: number, freqMax: number): number {
  const logMin = Math.log10(freqMin)
  const logMax = Math.log10(freqMax)
  const logFreq = logMin + position * (logMax - logMin)
  return Math.pow(10, logFreq)
}

/**
 * Round frequency to nearest "nice" value for slider/drag interaction.
 * Steps increase with frequency to match human perception.
 */
export function roundFreqToNice(hz: number): number {
  if (hz < 100) return Math.round(hz / 5) * 5
  if (hz < 1000) return Math.round(hz / 10) * 10
  if (hz < 10000) return Math.round(hz / 100) * 100
  return Math.round(hz / 500) * 500
}

/**
 * Quadratic (parabolic) interpolation for true peak finding
 * Given three samples at indices (i-1, i, i+1) with values (a, b, c)
 * where b is the peak, returns the fractional offset (-0.5 to 0.5)
 * and interpolated peak value
 */
export function quadraticInterpolation(
  a: number,
  b: number,
  c: number
): { delta: number; peak: number } {
  const denom = a - 2 * b + c
  
  if (denom === 0) {
    return { delta: 0, peak: b }
  }

  let delta = 0.5 * (a - c) / denom
  
  // Clamp to valid range
  if (delta > 0.5) delta = 0.5
  else if (delta < -0.5) delta = -0.5
  if (!Number.isFinite(delta)) delta = 0

  let peak = b - 0.25 * (a - c) * delta
  if (!Number.isFinite(peak)) peak = b

  return { delta, peak }
}

/**
 * Check if a number is a valid power of two in FFT size range
 */
export function isValidFftSize(n: number): boolean {
  return Number.isInteger(n) && n >= 32 && n <= 32768 && (n & (n - 1)) === 0
}

/**
 * Find nearest power of two (for FFT sizing)
 */
export function nearestPowerOfTwo(n: number): number {
  return Math.pow(2, Math.round(Math.log2(n)))
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint32Array(2)
    cryptoApi.getRandomValues(bytes)
    return `${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Calculate autocorrelation at a given lag (for vibrato detection)
 * Normalized to -1 to 1 range
 */
export function autocorrelation(signal: number[], lag: number): number {
  const n = signal.length
  if (!Number.isInteger(lag) || lag < 0 || lag >= n) return 0

  let sum = 0
  let sumSq1 = 0
  let sumSq2 = 0

  for (let i = 0; i < n - lag; i++) {
    sum += signal[i] * signal[i + lag]
    sumSq1 += signal[i] * signal[i]
    sumSq2 += signal[i + lag] * signal[i + lag]
  }

  const denom = Math.sqrt(sumSq1 * sumSq2)
  return denom > 0 ? sum / denom : 0
}
