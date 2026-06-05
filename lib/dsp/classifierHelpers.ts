// DoneWell Audio Classifier Helpers
// Extracted helper functions and constants used by classifier.ts

import { MAINS_HUM_GATE } from './constants'
import type { Track, TrackSummary, TrackedPeak } from '@/types/advisory'

// ── Constants ──────────────────────────────────────────────────────────────

export const MODE_PRESENCE_BONUS = 0.12

/**
 * Chromatic quantization gate — suppresses Auto-Tune false positives.
 * Pitch-corrected audio snaps frequencies to the 12-TET semitone grid,
 * producing artificially high phase coherence that mimics feedback.
 * When a peak sits within ±5 cents of a semitone AND phase coherence
 * exceeds 0.80, the phase boost is scaled by 0.60 (40% reduction).
 * Ref: Bristow-Johnson (2001), "The Equivalence of Various Methods of
 * Computing Biquad Coefficients for Audio Parametric Equalizers".
 */
export const CHROMATIC_SNAP_CENTS = 5
export const CHROMATIC_PHASE_THRESHOLD = 0.80
export const CHROMATIC_PHASE_REDUCTION = 0.60

export const FORMANT_BANDS = [
  { min: 300, max: 900 },   // F1
  { min: 800, max: 2500 },  // F2
  { min: 2200, max: 3500 }, // F3
] as const

// ── Type union for track input ─────────────────────────────────────────────
export type TrackInput = Track | TrackSummary | TrackedPeak

type HistoryLikeEntry = {
  time: number
  frequency?: number
  freqHz?: number
}

// ── Helper Functions ───────────────────────────────────────────────────────

// Helper to normalize input to common interface
export function normalizeTrackInput(input: TrackInput) {
  // Check if it's a TrackedPeak (has 'frequency' field) or Track (has 'trueFrequencyHz')
  if ('trueFrequencyHz' in input) {
    return {
      frequencyHz: input.trueFrequencyHz,
      amplitudeDb: input.trueAmplitudeDb,
      onsetDb: input.onsetDb,
      onsetTime: input.onsetTime,
      velocityDbPerSec: input.velocityDbPerSec,
      stabilityCentsStd: input.features.stabilityCentsStd,
      harmonicityScore: input.features.harmonicityScore,
      modulationScore: input.features.modulationScore,
      noiseSidebandScore: input.features.noiseSidebandScore,
      maxVelocityDbPerSec: input.features.maxVelocityDbPerSec,
      minQ: input.features.minQ,
      persistenceMs: input.features.persistenceMs,
      prominenceDb: input.prominenceDb,
      phpr: input.phpr,
    }
  }
  // TrackedPeak
  return {
    frequencyHz: input.frequency,
    amplitudeDb: input.amplitude,
    onsetDb: ('history' in input ? input.history[0]?.amplitude : undefined) ?? input.onsetAmplitudeDb ?? input.amplitude,
    onsetTime: input.onsetTime,
    velocityDbPerSec: input.features.velocityDbPerSec,
    stabilityCentsStd: input.features.stabilityCentsStd,
    harmonicityScore: input.features.harmonicityScore,
    modulationScore: input.features.modulationScore,
    noiseSidebandScore: 0, // TrackedPeak doesn't have this
    maxVelocityDbPerSec: Math.abs(input.features.velocityDbPerSec),
    minQ: input.qEstimate,
    persistenceMs: input.lastUpdateTime - input.onsetTime,
    prominenceDb: input.prominenceDb,
    phpr: undefined, // TrackedPeak doesn't carry PHPR
  }
}

/**
 * Count how many distinct formant bands contain at least one frequency.
 * Returns the number of unique bands (0–3) that have a matching peak.
 * Ref: Fant (1960), "Acoustic Theory of Speech Production".
 */
export function countFormantBands(frequencies: number[]): number {
  let mask = 0

  for (let i = 0; i < frequencies.length; i++) {
    const frequency = frequencies[i]
    if (frequency >= FORMANT_BANDS[0].min && frequency <= FORMANT_BANDS[0].max) mask |= 1
    if (frequency >= FORMANT_BANDS[1].min && frequency <= FORMANT_BANDS[1].max) mask |= 2
    if (frequency >= FORMANT_BANDS[2].min && frequency <= FORMANT_BANDS[2].max) mask |= 4
    if (mask === 0b111) break
  }

  let count = 0
  if (mask & 1) count++
  if (mask & 2) count++
  if (mask & 4) count++
  return count
}

/**
 * Count active peaks within a frequency window without allocating an intermediate array.
 */
export function countNearbyFrequencies(
  frequencies: number[],
  centerHz: number,
  radiusHz: number
): number {
  let count = 0

  for (let i = 0; i < frequencies.length; i++) {
    const frequency = frequencies[i]
    const distanceHz = Math.abs(frequency - centerHz)
    if (distanceHz > 0.001 && distanceHz <= radiusHz) {
      count++
    }
  }

  return count
}

/**
 * Read only the recent frequency history needed for vibrato confirmation.
 * This keeps the classifier from mapping the full track history on every peak.
 */
export function getRecentFrequencyHistory(
  input: TrackInput,
  minSamples: number = 10,
  maxSamples: number = 20
): Array<{ time: number; frequency: number }> | null {
  if (!('history' in input) || !Array.isArray(input.history)) {
    return null
  }

  const history = input.history as HistoryLikeEntry[]
  const length = history.length
  if (length < minSamples) {
    return null
  }

  const startIndex = Math.max(0, length - maxSamples)
  const recentHistory = new Array<{ time: number; frequency: number }>(length - startIndex)

  for (let i = startIndex, j = 0; i < length; i++, j++) {
    const entry = history[i]
    recentHistory[j] = {
      time: entry.time,
      frequency: entry.frequency ?? entry.freqHz ?? 0,
    }
  }

  return recentHistory
}

/**
 * Check if a frequency is quantized to the 12-TET semitone grid.
 * Returns true when the frequency is within ±CHROMATIC_SNAP_CENTS of
 * the nearest equal-tempered semitone (A4 = 440 Hz reference).
 * Pitch-corrected audio (Auto-Tune, Melodyne) snaps to this grid.
 */
export function isChromaticallyQuantized(frequencyHz: number): boolean {
  if (frequencyHz <= 0) return false
  // Semitones from A4: n = 12 * log2(f / 440)
  const semitones = 12 * Math.log2(frequencyHz / 440)
  // Distance to nearest semitone in cents (1 semitone = 100 cents)
  const centsOffset = Math.abs((semitones - Math.round(semitones)) * 100)
  return centsOffset <= CHROMATIC_SNAP_CENTS
}

/**
 * Detect if a frequency belongs to the AC mains electrical harmonic series.
 * Auto-detects 50 Hz (EU/Asia) vs 60 Hz (NA) by checking which fundamental
 * produces more matching harmonics among the active peaks.
 *
 * HVAC compressors, lighting dimmers, and transformers generate exact integer
 * multiples of the mains frequency (50n or 60n Hz). These persistent, narrow,
 * high-Q, phase-locked tones are indistinguishable from feedback to all six
 * detection algorithms. This gate requires corroborating evidence: the peak
 * must be on a mains harmonic AND 2+ other active peaks must match the same
 * series AND phase coherence must be high (AC-locked signal).
 *
 * @param frequencyHz - The peak frequency to evaluate
 * @param activeFrequencies - All currently active peak frequencies
 * @param phaseCoherence - Phase coherence score for this peak (0–1)
 * @returns Detection result with matched fundamental and corroboration count
 */
export function detectMainsHum(
  frequencyHz: number,
  activeFrequencies: number[],
  phaseCoherence: number,
  fundamentalSetting: 'auto' | 50 | 60 = 'auto'
): { isHum: boolean; fundamental: number; matchCount: number } {
  const noMatch = { isHum: false, fundamental: 0, matchCount: 0 }

  // Phase coherence must be high — mains hum is AC-locked
  if (phaseCoherence < MAINS_HUM_GATE.PHASE_COHERENCE_THRESHOLD) return noMatch

  const tol = MAINS_HUM_GATE.TOLERANCE_HZ
  let bestFundamental = 0
  let bestCount = 0

  // When user specifies 50 or 60 Hz, only check that fundamental.
  // 'auto' checks both and picks the one with more corroboration.
  const fundamentals = fundamentalSetting === 'auto'
    ? MAINS_HUM_GATE.FUNDAMENTALS
    : [fundamentalSetting]

  let minSeriesHz = Infinity
  let maxSeriesHz = 0
  for (let i = 0; i < fundamentals.length; i++) {
    const fundamental = fundamentals[i]
    if (fundamental < minSeriesHz) minSeriesHz = fundamental
    const seriesMax = fundamental * MAINS_HUM_GATE.MAX_HARMONIC
    if (seriesMax > maxSeriesHz) maxSeriesHz = seriesMax
  }
  if (frequencyHz < minSeriesHz - tol || frequencyHz > maxSeriesHz + tol) {
    return noMatch
  }

  for (const fund of fundamentals) {
    // Check if the current peak is on this mains series
    let onSeries = false
    for (let n = 1; n <= MAINS_HUM_GATE.MAX_HARMONIC; n++) {
      if (Math.abs(frequencyHz - fund * n) <= tol) { onSeries = true; break }
    }
    if (!onSeries) continue

    // Count corroborating peaks (other active peaks also on this series)
    let corroborating = 0
    for (const af of activeFrequencies) {
      if (Math.abs(af - frequencyHz) < 1) continue // skip self
      for (let n = 1; n <= MAINS_HUM_GATE.MAX_HARMONIC; n++) {
        if (Math.abs(af - fund * n) <= tol) { corroborating++; break }
      }
    }

    if (corroborating > bestCount) {
      bestCount = corroborating
      bestFundamental = fund
    }
  }

  return {
    isHum: bestCount >= MAINS_HUM_GATE.MIN_CORROBORATING_PEAKS,
    fundamental: bestFundamental,
    matchCount: bestCount,
  }
}
