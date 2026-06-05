/**
 * UI & Display Constants
 *
 * Mobile performance settings, canvas rendering,
 * EQ recommendation presets, ERB scaling, and visualization colors.
 */

// Mobile performance: recommended analysisIntervalMs for resource-constrained devices.
// 40ms (25fps) halves CPU cost with imperceptible detection latency increase
// (feedback builds over 200ms+, human reaction time ~150ms).
export const MOBILE_ANALYSIS_INTERVAL_MS = 40
/** Max advisories shown on mobile (cards, RTA markers, GEQ bars). */
export const MOBILE_MAX_DISPLAYED_ISSUES = 5

// Canvas rendering settings
export const CANVAS_SETTINGS = {
  RTA_DB_MIN: -100,
  RTA_DB_MAX: 0,
  RTA_FREQ_MIN: 20,
  RTA_FREQ_MAX: 20000,
  WATERFALL_HISTORY_FRAMES: 256,
  GEQ_BAR_WIDTH_RATIO: 0.8, // Bar width as ratio of band spacing
} as const

// EQ recommendation presets
export const EQ_PRESETS = {
  surgical: {
    defaultQ: 5,
    runawayQ: 8,
    maxCut: -18,
    moderateCut: -9,
    lightCut: -4,
  },
  heavy: {
    defaultQ: 2,
    runawayQ: 3,
    maxCut: -12,
    moderateCut: -6,
    lightCut: -3,
  },
} as const

// ERB (Equivalent Rectangular Bandwidth) settings for frequency-dependent EQ depth
// Based on Glasberg & Moore (1990): ERB(f) = 24.7 * (4.37 * f/1000 + 1)
// Notches narrower than one ERB are psychoacoustically transparent
export const ERB_SETTINGS = {
  /** Below this frequency, reduce cut depth to protect warmth */
  LOW_FREQ_HZ: 500,
  /** Above this frequency, allow deeper cuts (notch more transparent) */
  HIGH_FREQ_HZ: 2000,
  /** Max depth reduction factor for low frequencies (0.7 = 30% shallower) */
  LOW_FREQ_SCALE: 0.7,
  /** Max depth increase factor for high frequencies (1.2 = 20% deeper) */
  HIGH_FREQ_SCALE: 1.2,
} as const

// Color palette for visualizations
export const VIZ_COLORS = {
  RUNAWAY: '#ef4444', // red-500
  GROWING: '#fb923c', // orange-400 (WCAG AA ≥4.5:1 on dark)
  RESONANCE: '#facc15', // yellow-400 (WCAG AA ≥4.6:1 on dark)
  POSSIBLE_RING: '#c084fc', // purple-400 (WCAG AA ≥4.5:1 on dark)
  WHISTLE: '#06b6d4', // cyan-500
  INSTRUMENT: '#4ade80', // green-400 (WCAG AA ≥4.8:1 on dark)
  NOISE_FLOOR: '#4a5060', // dimmed gray — pro tools keep data lines dominant
  THRESHOLD: '#4B92FF', // LED blue
  SPECTRUM: '#4B92FF', // LED blue
  PEAK_MARKER: '#f59e0b', // amber-500
  // Advanced algorithm colors
  MSD_HIGH: '#22c55e', // green-500 (likely feedback)
  MSD_LOW: '#6b7280', // gray-500 (not feedback)
  PHASE_COHERENT: '#4B92FF', // LED blue (high coherence)
  PHASE_RANDOM: '#9ca3af', // gray-400 (low coherence)
  COMPRESSION: '#f59e0b', // amber-500 (compression detected)
  COMB_PATTERN: '#8b5cf6', // violet-500 (comb pattern)
  AXIS_LABEL: '#8891a0', // dimmed — pro tools keep grid labels subtle, data pops
} as const

/** Light-mode visualization colors — darker tones for WCAG AA contrast on light backgrounds.
 *
 * Consumed via `{ ...VIZ_COLORS, ...VIZ_COLORS_LIGHT }` in advisoryDisplay.ts and eqAdvisor.ts
 * so LIGHT acts as a sparse override of DARK. Missing keys fall through to DARK values.
 * Keep this table symmetric with VIZ_COLORS so future callers get correct light-theme values.
 */
export const VIZ_COLORS_LIGHT = {
  // Severity tokens (originally defined). Ratios recomputed Batch 25 — prior comments overstated.
  RUNAWAY: '#dc2626',       // red-600 (4.82:1 on white)
  GROWING: '#c2410c',       // orange-700 (5.20:1 on white; was #ea580c at 3.55:1, failed AA)
  RESONANCE: '#a16207',     // yellow-700 (4.88:1 on white)
  POSSIBLE_RING: '#9333ea', // purple-600 (5.36:1 on white)
  WHISTLE: '#0e7490',       // cyan-700 (5.28:1 on white; was #0891b2 at 3.62:1, failed AA)
  INSTRUMENT: '#15803d',    // green-700 (5.00:1 on white; was #16a34a at 3.26:1, failed AA)
  // Infrastructure tokens (added to complete the symmetry)
  NOISE_FLOOR: '#64748b',   // slate-500 — dimmed gray that reads on light
  THRESHOLD: '#2563eb',     // blue-600 — matches light-theme --ring
  SPECTRUM: '#2563eb',      // blue-600 — same as THRESHOLD
  PEAK_MARKER: '#b45309',   // amber-700 — matches Batch 21 earlyWarningMarker
  // Advanced algorithm colors
  MSD_HIGH: '#16a34a',      // green-600
  MSD_LOW: '#6b7280',       // gray-500 (works on both themes)
  PHASE_COHERENT: '#2563eb', // blue-600
  PHASE_RANDOM: '#64748b',  // slate-500
  COMPRESSION: '#b45309',   // amber-700
  COMB_PATTERN: '#7c3aed',  // violet-600
  AXIS_LABEL: '#5a6478',    // matches LIGHT_CANVAS_THEME.axisLabel
} as const
