/**
 * Layered Settings Type Hierarchy — v2
 *
 * Replaces the flat DetectorSettings editing model with a layered ownership
 * contract. Each value has exactly one owner. DetectorSettings becomes a
 * derived runtime object computed by deriveDetectorSettings().
 *
 * Ownership layers:
 *   1. ModeBaseline      — tuned detector policy per mode
 *   2. EnvironmentSelection — local mains-hum gate state
 *   3. LiveOverrides     — operator adjustments during a show
 *   4. DisplayPrefs      — rendering / visibility / ergonomics
 *   5. DiagnosticsProfile — opt-in expert DSP controls
 *
 * @see lib/settings/deriveSettings.ts for the derivation function
 */

import type { Algorithm, OperationMode } from '@/types/advisory'

// ─── Mode Baseline ────────────────────────────────────────────────────────────

/** Reuse the existing OperationMode union as ModeId */
export type ModeId = OperationMode

/**
 * Frozen detector policy for a given mode. Extracted from OPERATION_MODES
 * in constants.ts. These values are never directly authored by UI controls —
 * they are the starting point for derivation.
 */
export interface ModeBaseline {
  readonly modeId: ModeId
  readonly label: string
  readonly description: string
  // Detection thresholds
  readonly feedbackThresholdDb: number
  readonly ringThresholdDb: number
  readonly growthRateThreshold: number
  // FFT
  readonly fftSize: 4096 | 8192 | 16384
  // Frequency range
  readonly minFrequency: number
  readonly maxFrequency: number
  // Timing
  readonly sustainMs: number
  readonly clearMs: number
  // Report gate
  readonly confidenceThreshold: number
  readonly prominenceDb: number
  // Defaults
  readonly eqPreset: 'surgical' | 'heavy'
  readonly aWeightingEnabled: boolean
  readonly defaultInputGainDb: number
  /** Only broadcast overrides this; others inherit the shared -18 dBFS target. */
  readonly defaultAutoGainTargetDb?: number
  readonly ignoreWhistle: boolean
  /** Per-mode track inactivity timeout. Used when diagnostics.trackTimeoutMs is 'mode-default'. */
  readonly defaultTrackTimeoutMs: number
}

// ─── Environment ──────────────────────────────────────────────────────────────

export interface EnvironmentSelection {
  /** Whether mains hum detection gate is active. Disable in hum-free venues. */
  mainsHumEnabled: boolean
  /** Mains frequency: 'auto' detects 50/60 Hz; explicit overrides auto-detection. */
  mainsHumFundamental: 'auto' | 50 | 60
}

// ─── Live Operator Overrides ──────────────────────────────────────────────────

/** Focus range preset IDs */
export type FocusRangePresetId = 'vocal' | 'monitor' | 'full' | 'sub'

/** Discriminated union for focus range selection */
export type FocusRange =
  | { kind: 'mode-default' }
  | { kind: 'preset'; id: FocusRangePresetId }
  | { kind: 'custom'; minHz: number; maxHz: number }

/**
 * What an engineer might change during a show or soundcheck without
 * redefining the rig. These sit on top of mode + environment.
 */
export interface LiveOverrides {
  /** Added to baseline + environment threshold. Positive = more conservative. */
  sensitivityOffsetDb: number
  inputGainDb: number
  autoGainEnabled: boolean
  autoGainTargetDb: number
  focusRange: FocusRange
  /** 'mode-default' uses the baseline's eqPreset */
  eqStyle: 'surgical' | 'heavy' | 'mode-default'
}

// ─── Display Preferences ──────────────────────────────────────────────────────

/**
 * All rendering, visibility, and ergonomics state.
 * Never flows to the DSP worker. Never part of a rig preset.
 */
export interface DisplayPrefs {
  maxDisplayedIssues: number
  graphFontSize: number
  showTooltips: boolean
  showAlgorithmScores: boolean
  showPeqDetails: boolean
  showFreqZones: boolean
  spectrumWarmMode: boolean
  /** Display-only spectrum view. Raw is best for ring hunting; perceptual applies 1/3-octave smoothing. */
  spectrumSmoothingMode: 'raw' | 'perceptual'
  rtaDbMin: number
  rtaDbMax: number
  spectrumLineWidth: number
  showThresholdLine: boolean
  canvasTargetFps: number
  faderMode: 'gain' | 'sensitivity' // DEPRECATED — kept for mobile toggle during dual-fader migration
  faderLinkMode: 'unlinked' | 'linked' | 'linked-reversed'
  faderLinkRatio: number        // 0.5–2.0, sensitivity-to-gain visual ratio
  faderLinkCenterGainDb: number // Home position for gain fader (default 0)
  faderLinkCenterSensDb: number // Home position for sensitivity fader (default 26)
  /** Enable signal-responsive background tint (severity → console color shift) */
  signalTintEnabled: boolean
}

// ─── Diagnostics / Expert Policy ──────────────────────────────────────────────

/**
 * Opt-in low-level DSP controls for troubleshooting and benchmarking.
 * Override fields take precedence over mode baseline when present.
 */
export interface DiagnosticsProfile {
  adaptivePhaseSkip?: boolean
  algorithmMode: 'auto' | 'custom'
  enabledAlgorithms: Algorithm[]
  thresholdMode: 'absolute' | 'relative' | 'hybrid'
  noiseFloorAttackMs: number
  noiseFloorReleaseMs: number
  maxTracks: number
  trackTimeoutMs: number | 'mode-default'
  harmonicToleranceCents: number
  peakMergeCents: number
  // Optional overrides — when present, take precedence over mode baseline
  confidenceThresholdOverride?: number
  growthRateThresholdOverride?: number
  smoothingTimeConstantOverride?: number
  sustainMsOverride?: number
  clearMsOverride?: number
  prominenceDbOverride?: number
  aWeightingOverride?: boolean
  ignoreWhistleOverride?: boolean
  fftSizeOverride?: 4096 | 8192 | 16384
  ringThresholdDbOverride?: number
  // Gate multiplier overrides — expert-only, no UI. When set, override the
  // hardcoded gate constants in fusion/classifier. Values are multipliers (0–1).
  formantGateOverride?: number    // default 0.65 (classifier.ts formant gate)
  chromaticGateOverride?: number  // default 0.60 (classifier.ts chromatic quantization gate)
  combSweepOverride?: number      // default 0.25 (algorithmFusion.ts comb stability gate)
  ihrGateOverride?: number        // default 0.65 (algorithmFusion.ts IHR gate)
  ptmrGateOverride?: number       // default 0.80 (algorithmFusion.ts PTMR gate)
  mainsHumGateOverride?: number   // default 0.40 (classifier.ts mains hum gate)
}

// ─── Rig Preset ───────────────────────────────────────────────────────────────

/**
 * A structured rig preset that captures mode + live defaults.
 * Schema-versioned for future migration support.
 * Display prefs and diagnostics are excluded by design.
 */
export interface RigPresetV1 {
  schemaVersion: 1
  id: string
  name: string
  modeId: ModeId
  liveDefaults: LiveOverrides
  diagnosticsProfileId?: string
  createdAt: string
  updatedAt: string
}

// ─── Session State ────────────────────────────────────────────────────────────

/**
 * The full layered state that persists across page loads.
 * This is what auto-saves — NOT a DetectorSettings bag.
 */
export interface DwaSessionState {
  modeId: ModeId
  environment: EnvironmentSelection
  liveOverrides: LiveOverrides
  diagnostics: DiagnosticsProfile
}

// ─── Startup Preference ───────────────────────────────────────────────────────

/**
 * Optional preset to load on launch. Separate from session state.
 */
export interface StartupPreference {
  presetId?: string
}
