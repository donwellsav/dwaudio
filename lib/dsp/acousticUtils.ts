/**
 * Acoustic Utilities — local-only detector helpers.
 *
 * This barrel keeps only the deterministic helpers still used by the feedback
 * classifier. Room modeling, dimension estimation, and RT60 adjustment were
 * removed with the setup surfaces.
 */

import { FREQUENCY_BANDS } from './constants'

export function getFrequencyBand(frequencyHz: number): {
  band: 'LOW' | 'MID' | 'HIGH'
  prominenceMultiplier: number
  sustainMultiplier: number
  qThresholdMultiplier: number
  description: string
} {
  if (frequencyHz < FREQUENCY_BANDS.LOW.maxHz) {
    return {
      band: 'LOW',
      ...FREQUENCY_BANDS.LOW,
    }
  }
  if (frequencyHz < FREQUENCY_BANDS.MID.maxHz) {
    return {
      band: 'MID',
      ...FREQUENCY_BANDS.MID,
    }
  }
  return {
    band: 'HIGH',
    ...FREQUENCY_BANDS.HIGH,
  }
}

// Modal analysis: Q overlap and classification
export {
  calculateModalOverlap,
  classifyModalOverlap,
} from './acoustic/modalAnalysis'

// Vibrato / whistle detection
export { analyzeVibrato } from './acoustic/vibratoDetection'

// Cumulative growth tracking
export { analyzeCumulativeGrowth } from './acoustic/cumulativeGrowth'

// Confidence calibration
export { calculateCalibratedConfidence } from './acoustic/confidenceCalibration'
