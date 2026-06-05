/**
 * Pure utility functions extracted from FeedbackDetector
 *
 * These functions were inline private methods in feedbackDetector.ts.
 * They are pure computations (or near-pure with explicit state params)
 * that don't need access to the FeedbackDetector class instance.
 *
 * Extracted to:
 * - Enable unit testing without instantiating the full detector
 * - Reduce feedbackDetector.ts from 1559 to ~1400 lines
 * - Make the computation logic reusable outside the class
 */

import { MSD_SETTINGS, HARMONIC_SETTINGS } from './constants'
import type { AnalysisConfig } from '@/types/advisory'

// ─── Threshold Computation ──────────────────────────────────────────────────

/**
 * Compute the effective detection threshold from config and noise floor.
 *
 * Three modes:
 * - absolute: fixed dB floor (safety net)
 * - relative: noise floor + headroom (adapts to environment)
 * - hybrid: max(absolute, relative) — the default
 *
 * @param config - Analysis config with threshold settings
 * @param noiseFloorDb - Current noise floor estimate (null if not yet measured)
 * @returns Effective threshold in dB
 */
const MODE_RELATIVE_HEADROOM_SCALE: Readonly<Record<string, number>> = {
  speech: 0.8,
  worship: 0.65,
  liveMusic: 0.55,
  theater: 0.75,
  monitors: 0.8,
  broadcast: 0.8,
  outdoor: 0.6,
}

const MIN_RELATIVE_HEADROOM_DB = 10
const MAX_RELATIVE_HEADROOM_DB = 24

export function normalizeRelativeThresholdDb(relativeThresholdDb: number, mode?: string): number {
  const scale = mode ? (MODE_RELATIVE_HEADROOM_SCALE[mode] ?? 0.7) : 0.7
  const normalized = relativeThresholdDb * scale
  return Math.max(MIN_RELATIVE_HEADROOM_DB, Math.min(MAX_RELATIVE_HEADROOM_DB, normalized))
}

export function computeEffectiveThreshold(
  config: Pick<AnalysisConfig, 'thresholdDb' | 'noiseFloorEnabled' | 'relativeThresholdDb' | 'thresholdMode' | 'mode'>,
  noiseFloorDb: number | null,
): number {
  const absT = config.thresholdDb

  if (!config.noiseFloorEnabled || noiseFloorDb === null) {
    return absT
  }

  const relT = noiseFloorDb + normalizeRelativeThresholdDb(config.relativeThresholdDb, config.mode)
  switch (config.thresholdMode) {
    case 'absolute': return absT
    case 'relative': return relT
    case 'hybrid': return Math.max(absT, relT)
    default: return Math.max(absT, relT)
  }
}

// ─── MSD Min Frames ─────────────────────────────────────────────────────────

/**
 * Map operation mode to MSD minimum frames.
 *
 * Ensures the main-thread min frames stay ≤ the worker's content-adaptive
 * min frames, so the main thread never requires MORE history than the worker.
 *
 * @param mode - Operation mode from config
 * @returns Minimum frames for MSD calculation
 */
export function getMsdMinFramesForMode(mode: string): number {
  if (mode === 'speech' || mode === 'broadcast') {
    return MSD_SETTINGS.MIN_FRAMES_SPEECH  // 7
  }
  if (mode === 'liveMusic' || mode === 'worship' || mode === 'outdoor') {
    return MSD_SETTINGS.MIN_FRAMES_MUSIC   // 13
  }
  return MSD_SETTINGS.DEFAULT_MIN_FRAMES   // 12
}

// ─── MSD Classification ─────────────────────────────────────────────────────

export interface MsdClassification {
  msd: number
  growthRate: number
  isHowl: boolean
  fastConfirm: boolean
}

const LOW_FREQUENCY_CONFIRM_SCALE = 1.25
const HIGH_FREQUENCY_CONFIRM_SCALE = 0.6
const HOWL_CONFIRM_MULTIPLIER = 0.8
const FAST_CONFIRM_MULTIPLIER = 0.6
const LOW_FREQUENCY_MIN_CONFIRM_MS = 180
const MID_FREQUENCY_MIN_CONFIRM_MS = 120
const HIGH_FREQUENCY_MIN_CONFIRM_MS = 100

/**
 * Classify an MSD result: howl detection + fast-confirm logic.
 *
 * Separated from FeedbackDetector.calculateMsd() so the classification
 * logic can be tested independently of the pool and noise floor state.
 *
 * @param rawMsd - Raw MSD value from MSDPool.getMSD()
 * @param rawGrowthRate - Growth rate from MSDPool
 * @param fastConfirmCount - Current consecutive low-MSD frame count for this bin
 * @returns Classification result + updated fast-confirm count
 */
export function classifyMsdResult(
  rawMsd: number,
  rawGrowthRate: number,
  fastConfirmCount: number,
): { classification: MsdClassification; newFastConfirmCount: number } {
  const isHowl = rawMsd < MSD_SETTINGS.HOWL_THRESHOLD

  let fastConfirm = false
  let newCount = fastConfirmCount
  if (rawMsd < MSD_SETTINGS.FAST_CONFIRM_THRESHOLD) {
    newCount = fastConfirmCount + 1
    if (newCount >= MSD_SETTINGS.FAST_CONFIRM_FRAMES) {
      fastConfirm = true
    }
  } else {
    newCount = 0
  }

  return {
    classification: { msd: rawMsd, growthRate: rawGrowthRate, isHowl, fastConfirm },
    newFastConfirmCount: newCount,
  }
}

// ─── Harmonic Detection ─────────────────────────────────────────────────────

/**
 * Detect harmonic relationships between a new peak and existing active peaks.
 *
 * Two checks:
 * A) Overtone: Is the new peak the 2nd–8th harmonic of any active root?
 * B) Sub-harmonic: Is the new peak the fundamental of an already-active partial?
 *
 * Uses cents-based tolerance (musically uniform) instead of flat percentage.
 *
 * @param trueFrequencyHz - Frequency of the new peak
 * @param activeBins - Array of active bin indices
 * @param activeHz - Array mapping bin index → frequency in Hz
 * @param activeCount - Number of currently active bins
 * @param toleranceCents - Cents tolerance for harmonic matching (default from HARMONIC_SETTINGS)
 * @returns harmonicRootHz (null if this IS the root) and isSubHarmonicRoot flag
 */
export function detectHarmonicRelationship(
  trueFrequencyHz: number,
  activeBins: Uint32Array,
  activeHz: Float32Array,
  activeCount: number,
  toleranceCents: number = HARMONIC_SETTINGS.TOLERANCE_CENTS,
): { harmonicRootHz: number | null; isSubHarmonicRoot: boolean } {
  const maxHarmonic = HARMONIC_SETTINGS.MAX_HARMONIC
  let harmonicRootHz: number | null = null
  let isSubHarmonicRoot = false

  // A: Overtone check — is this peak an overtone (2nd–8th) of any active root?
  for (let j = 0; j < activeCount; j++) {
    const rootBin = activeBins[j]
    const rootHz = activeHz[rootBin]
    if (rootHz <= 0 || rootHz >= trueFrequencyHz) continue

    const ratio = trueFrequencyHz / rootHz
    const k = Math.round(ratio)
    if (k < 2 || k > maxHarmonic) continue

    const expectedHz = rootHz * k
    const cents = Math.abs(1200 * Math.log2(trueFrequencyHz / expectedHz))
    if (cents <= toleranceCents) {
      if (harmonicRootHz === null || rootHz < harmonicRootHz) {
        harmonicRootHz = rootHz
      }
    }
  }

  // B: Sub-harmonic check — is this peak the FUNDAMENTAL of an active partial?
  if (HARMONIC_SETTINGS.CHECK_SUB_HARMONICS && harmonicRootHz === null) {
    for (let j = 0; j < activeCount; j++) {
      const partialBin = activeBins[j]
      const partialHz = activeHz[partialBin]
      if (partialHz <= 0 || partialHz <= trueFrequencyHz) continue

      const ratio = partialHz / trueFrequencyHz
      const k = Math.round(ratio)
      if (k < 2 || k > maxHarmonic) continue

      const expectedPartialHz = trueFrequencyHz * k
      const cents = Math.abs(1200 * Math.log2(partialHz / expectedPartialHz))
      if (cents <= toleranceCents) {
        harmonicRootHz = null
        isSubHarmonicRoot = true
        break
      }
    }
  }

  return { harmonicRootHz, isSubHarmonicRoot }
}

function getFrequencyConfirmScale(frequencyHz: number): number {
  if (frequencyHz < 200) return LOW_FREQUENCY_CONFIRM_SCALE
  if (frequencyHz > 4000) return HIGH_FREQUENCY_CONFIRM_SCALE
  return 1
}

function getMinimumConfirmMs(frequencyHz: number): number {
  if (frequencyHz < 200) return LOW_FREQUENCY_MIN_CONFIRM_MS
  if (frequencyHz > 4000) return HIGH_FREQUENCY_MIN_CONFIRM_MS
  return MID_FREQUENCY_MIN_CONFIRM_MS
}

/**
 * Compute the detector hold window for a peak candidate.
 *
 * Low frequencies still wait longer than the mid band, but not as long as the
 * old 1.5x penalty. If MSD has already identified the candidate as feedback-like
 * in the current frame, shorten the hold window while keeping a minimum floor.
 */
export function computeAdaptiveSustainMs(
  sustainMs: number,
  frequencyHz: number,
  msdHint?: Pick<MsdClassification, 'isHowl' | 'fastConfirm'> | null,
): number {
  const baseConfirmMs = sustainMs * getFrequencyConfirmScale(frequencyHz)
  const minConfirmMs = getMinimumConfirmMs(frequencyHz)

  if (msdHint?.fastConfirm) {
    return Math.max(minConfirmMs, baseConfirmMs * FAST_CONFIRM_MULTIPLIER)
  }

  if (msdHint?.isHowl) {
    return Math.max(minConfirmMs, baseConfirmMs * HOWL_CONFIRM_MULTIPLIER)
  }

  return baseConfirmMs
}
