/**
 * Preset Constants — Operation Modes and canonical default snapshot
 *
 * 7 operation mode presets (speech, worship, liveMusic, theater, monitors,
 * broadcast, outdoor), the DEFAULT_SETTINGS compatibility export,
 * and frequency range presets.
 *
 * @see DBX AFS whitepaper — mode-specific detection strategies
 */

import type { DetectorSettings } from '@/types/advisory'
import { DEFAULT_DETECTOR_SETTINGS } from '@/lib/settings/defaultDetectorSettings'

// ── Mode Preset Interface ───────────────────────────────────────────────────

export interface ModePreset {
  label: string
  description: string
  // Detection thresholds
  feedbackThresholdDb: number
  ringThresholdDb: number
  growthRateThreshold: number
  // Analysis parameters
  fftSize: 4096 | 8192 | 16384
  minFrequency: number
  maxFrequency: number
  // Timing
  sustainMs: number
  clearMs: number
  // Sensitivity
  confidenceThreshold: number
  prominenceDb: number
  // Display/EQ
  eqPreset: 'surgical' | 'heavy'
  aWeightingEnabled: boolean
  inputGainDb: number
  autoGainTargetDb?: number // Optional — falls back to the shared default target when absent
  ignoreWhistle: boolean
}

// ── Operation Modes ─────────────────────────────────────────────────────────

export const OPERATION_MODES: Record<string, ModePreset> = {
  speech: {
    label: 'Speech',
    description: 'Corporate & Conference',
    feedbackThresholdDb: 20,
    ringThresholdDb: 5,
    growthRateThreshold: 1.0,
    fftSize: 8192,
    minFrequency: 150,
    maxFrequency: 10000,
    sustainMs: 180,
    clearMs: 400,
    confidenceThreshold: 0.35,
    prominenceDb: 8,
    eqPreset: 'surgical',
    aWeightingEnabled: true,
    inputGainDb: 0,
    ignoreWhistle: false,
  },

  worship: {
    label: 'Worship',
    description: 'House of Worship',
    feedbackThresholdDb: 35,
    ringThresholdDb: 5,
    growthRateThreshold: 2.0,
    fftSize: 8192,
    minFrequency: 100,
    maxFrequency: 12000,
    sustainMs: 200,
    clearMs: 500,
    confidenceThreshold: 0.45,
    prominenceDb: 12,
    eqPreset: 'surgical',
    aWeightingEnabled: false,
    inputGainDb: 2,
    ignoreWhistle: false,
  },

  liveMusic: {
    label: 'Live Music',
    description: 'Concerts & Events',
    feedbackThresholdDb: 42,
    ringThresholdDb: 8,
    growthRateThreshold: 4.0,
    fftSize: 4096,
    minFrequency: 60,
    maxFrequency: 16000,
    sustainMs: 240,
    clearMs: 600,
    confidenceThreshold: 0.55,
    prominenceDb: 14,
    eqPreset: 'heavy',
    aWeightingEnabled: false,
    inputGainDb: 0,
    ignoreWhistle: false,
  },

  theater: {
    label: 'Theater',
    description: 'Drama & Musicals',
    feedbackThresholdDb: 28,
    ringThresholdDb: 4,
    growthRateThreshold: 1.5,
    fftSize: 8192,
    minFrequency: 150,
    maxFrequency: 10000,
    sustainMs: 180,
    clearMs: 400,
    confidenceThreshold: 0.40,
    prominenceDb: 10,
    eqPreset: 'surgical',
    aWeightingEnabled: true,
    inputGainDb: 4,
    ignoreWhistle: false,
  },

  monitors: {
    label: 'Monitors',
    description: 'Stage Wedges',
    feedbackThresholdDb: 15,
    ringThresholdDb: 3,
    growthRateThreshold: 0.8,
    fftSize: 4096,
    minFrequency: 200,
    maxFrequency: 6000,
    sustainMs: 140,
    clearMs: 300,
    confidenceThreshold: 0.35,
    prominenceDb: 8,
    eqPreset: 'surgical',
    aWeightingEnabled: false,
    inputGainDb: 0,
    ignoreWhistle: false,
  },

  broadcast: {
    label: 'Broadcast',
    description: 'Studio & Podcast',
    feedbackThresholdDb: 22,
    ringThresholdDb: 3,
    growthRateThreshold: 1.0,
    fftSize: 8192,
    minFrequency: 80,
    maxFrequency: 12000,
    sustainMs: 180,
    clearMs: 350,
    confidenceThreshold: 0.30,
    prominenceDb: 8,
    eqPreset: 'surgical',
    aWeightingEnabled: true,
    inputGainDb: 0,
    autoGainTargetDb: -24,
    ignoreWhistle: false,
  },

  outdoor: {
    label: 'Outdoor',
    description: 'Open Air & Festivals',
    feedbackThresholdDb: 38,
    ringThresholdDb: 6,
    growthRateThreshold: 2.5,
    fftSize: 4096,
    minFrequency: 100,
    maxFrequency: 12000,
    sustainMs: 200,
    clearMs: 450,
    confidenceThreshold: 0.45,
    prominenceDb: 12,
    eqPreset: 'heavy',
    aWeightingEnabled: true,
    inputGainDb: 0,
    ignoreWhistle: false,
  },
} as const

// ── Default Settings ────────────────────────────────────────────────────────

// Speech-mode compatibility snapshot derived from the layered defaults.
// Keep the exported symbol for legacy runtime consumers and tests.
export const DEFAULT_SETTINGS: DetectorSettings = DEFAULT_DETECTOR_SETTINGS

// Frequency range presets — quick switching for different use cases
export const FREQ_RANGE_PRESETS = [
  { label: 'Vocal',   shortRange: '200–8k',  minFrequency: 200,  maxFrequency: 8000  },
  { label: 'Monitor', shortRange: '300–3k',  minFrequency: 300,  maxFrequency: 3000  },
  { label: 'Full',    shortRange: '20–20k',  minFrequency: 20,   maxFrequency: 20000 },
  { label: 'Sub',     shortRange: '20–250',  minFrequency: 20,   maxFrequency: 250   },
] as const
