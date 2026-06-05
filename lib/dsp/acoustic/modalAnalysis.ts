/**
 * Q Overlap Analysis
 *
 * Classifies measured peak sharpness for the deterministic feedback classifier.
 * Room-density and RT60 adjustments were removed from the local-only fork.
 */

import { MODAL_OVERLAP } from '../constants'

/**
 * Calculate modal overlap factor from Q value
 *
 * From textbook Section 1.2.6.7, Equation 1.109: M = f * η * n
 * Where: η = loss factor, n = modal density
 *
 * For a single resonance with measured Q:
 * - The loss factor η relates to Q via: η ≈ 1/Q (for lightly damped systems)
 * - Reference: textbook discusses η = Δf_3dB / (π * f) and Q = f / Δf_3dB
 *
 * For feedback detection, we use a normalized modal overlap indicator:
 * M_indicator = 1/Q (dimensionless ratio indicating resonance sharpness)
 *
 * Interpretation (based on textbook Fig 1.23):
 * - M << 1 (< 0.03, i.e. Q > 33): Sharp isolated peak with deep troughs
 *   → More likely to be feedback (sustained single frequency)
 * - M ≈ 0.1 (Q ≈ 10): Moderate resonance
 *   → Could be feedback or room resonance
 * - M >> 0.1 (Q < 10): Broad peak, overlapping response
 *   → Less likely to be feedback (more noise-like)
 *
 * @param qFactor - Q factor of the resonance (Q = f / Δf_3dB)
 * @returns Modal overlap indicator (1/Q)
 */
export function calculateModalOverlap(qFactor: number): number {
  if (qFactor <= 0) return Infinity
  // M_indicator = 1/Q = Δf_3dB / f
  return 1 / qFactor
}

/**
 * Classify modal overlap indicator as isolated, coupled, or diffuse
 *
 * With M = 1/Q:
 * - Low M (high Q) = sharp isolated peak = likely feedback
 * - High M (low Q) = broad peak = less likely feedback
 */
export function classifyModalOverlap(modalOverlap: number): {
  classification: 'ISOLATED' | 'COUPLED' | 'DIFFUSE'
  feedbackProbabilityBoost: number
  description: string
} {
  // Note: With M = 1/Q, ISOLATED has the LOWEST M value (highest Q)
  if (modalOverlap < MODAL_OVERLAP.ISOLATED) {
    return {
      classification: 'ISOLATED',
      feedbackProbabilityBoost: 0.15, // Boost feedback probability for sharp peaks
      description: 'Sharp isolated peak (Q > 33) - high feedback risk',
    }
  } else if (modalOverlap < MODAL_OVERLAP.COUPLED) {
    return {
      classification: 'COUPLED',
      feedbackProbabilityBoost: 0.05, // Slight boost
      description: 'Moderate resonance (Q 10-33) - possible feedback',
    }
  } else if (modalOverlap < MODAL_OVERLAP.DIFFUSE) {
    return {
      classification: 'COUPLED',
      feedbackProbabilityBoost: 0, // Neutral
      description: 'Broader resonance (Q 3-10) - lower feedback risk',
    }
  } else {
    return {
      classification: 'DIFFUSE',
      feedbackProbabilityBoost: -0.10, // Reduce feedback probability
      description: 'Broad peak (Q < 3) - unlikely feedback',
    }
  }
}
