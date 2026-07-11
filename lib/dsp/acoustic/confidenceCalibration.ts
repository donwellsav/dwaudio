/**
 * Confidence Calibration
 *
 * Describes the final classifier posterior without adding feature evidence.
 */

// ============================================================================
// CONFIDENCE CALIBRATION
// ============================================================================

/**
 * Calculate calibrated confidence score
 * Reports the strongest final class score as confidence.
 *
 * @param pFeedback - Raw feedback probability
 * @param pWhistle - Raw whistle probability
 * @param pInstrument - Raw instrument probability
 * @returns Calibrated confidence (0-1)
 */
export function calculateCalibratedConfidence(
  pFeedback: number,
  pWhistle: number,
  pInstrument: number,
): {
  confidence: number
  adjustedPFeedback: number
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
} {
  const confidence = Math.max(pFeedback, pWhistle, pInstrument)

  // Determine confidence label
  let confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  if (confidence >= 0.85) {
    confidenceLabel = 'VERY_HIGH'
  } else if (confidence >= 0.70) {
    confidenceLabel = 'HIGH'
  } else if (confidence >= 0.55) {
    confidenceLabel = 'MEDIUM'
  } else {
    confidenceLabel = 'LOW'
  }

  return {
    confidence,
    adjustedPFeedback: pFeedback,
    confidenceLabel,
  }
}
