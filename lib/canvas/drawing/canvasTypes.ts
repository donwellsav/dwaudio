/**
 * Canvas Drawing — Shared Types & Constants
 *
 * Types, theme palettes, and utility constants consumed by all drawing sub-modules.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Theme-aware color palette for canvas drawing. Avoids per-frame getComputedStyle(). */
export interface CanvasTheme {
  background: string
  vignette: string
  gridMinor: string
  gridMajor: string
  gridFreq: string
  zoneLabel: string
  axisLabel: string
  axisLabelShadow: string
  peakHold: string
  freqRangeOverlay: string
  freqRangeLine: string
  frozenBadgeBg: string
  frozenBadgeBorder: string
  frozenBadgeText: string
  /** Level-meter gradient stops (bottom → top = quiet → hot). */
  meterBlue: string
  meterGreen: string
  meterAmber: string
  meterRed: string
  /** Unfilled portion of the meter (above the current level). */
  meterBg: string
  /** Peak-hold indicator line. */
  meterPeakHold: string
  /** Early-warning predicted-frequency marker (dashed line + triangle). */
  earlyWarningMarker: string
  /** Hover tooltip pill background (RTA cursor readout). */
  tooltipBg: string
  /** Hover tooltip pill background when an advisory is nearby (slightly opaquer). */
  tooltipBgAdvisory: string
  /** Hover tooltip text color. */
  tooltipText: string
  /** Hover crosshair color when no advisory nearby (RGBA string). */
  crosshairIdle: string
}

export const DARK_CANVAS_THEME: CanvasTheme = {
  background: '#08101a',
  vignette: 'rgba(0, 0, 0, 0.22)',
  gridMinor: '#1a2030',
  gridMajor: '#27303f',
  gridFreq: '#1e2533',
  zoneLabel: 'rgba(160, 170, 190, 0.35)',
  axisLabel: '#8891a0',
  axisLabelShadow: 'rgba(0,0,0,0.7)',
  peakHold: 'rgba(200, 210, 225, 0.25)',
  freqRangeOverlay: 'rgba(0, 0, 0, 0.45)',
  freqRangeLine: '#4B92FF',
  frozenBadgeBg: 'rgba(75, 146, 255, 0.2)',
  frozenBadgeBorder: 'rgba(75, 146, 255, 0.5)',
  frozenBadgeText: '#60a5fa',
  meterBlue: 'rgba(75, 146, 255, 0.7)',
  meterGreen: 'rgba(74, 222, 128, 0.85)',
  meterAmber: 'rgba(245, 158, 11, 0.85)',
  meterRed: 'rgba(239, 68, 68, 0.9)',
  meterBg: 'rgba(128, 128, 128, 0.08)',
  meterPeakHold: 'rgba(255, 255, 255, 0.7)',
  earlyWarningMarker: '#f59e0b',
  tooltipBg: 'rgba(0, 0, 0, 0.8)',
  tooltipBgAdvisory: 'rgba(0, 0, 0, 0.88)',
  tooltipText: '#e5e5e5',
  crosshairIdle: 'rgba(255, 255, 255, 0.15)',
}

export const LIGHT_CANVAS_THEME: CanvasTheme = {
  background: '#f0f1f4',
  vignette: 'rgba(0, 0, 0, 0.06)',
  gridMinor: '#d8dbe0',
  gridMajor: '#c0c5cc',
  gridFreq: '#d0d4da',
  zoneLabel: 'rgba(80, 90, 110, 0.45)',
  axisLabel: '#5a6478',
  axisLabelShadow: 'rgba(255,255,255,0.5)',
  peakHold: 'rgba(50, 60, 80, 0.30)',
  freqRangeOverlay: 'rgba(255, 255, 255, 0.45)',
  freqRangeLine: '#2563eb',
  frozenBadgeBg: 'rgba(37, 99, 235, 0.15)',
  frozenBadgeBorder: 'rgba(37, 99, 235, 0.55)',
  frozenBadgeText: '#1d4ed8',
  meterBlue: 'rgba(37, 99, 235, 0.75)',
  meterGreen: 'rgba(22, 163, 74, 0.85)',
  meterAmber: 'rgba(217, 119, 6, 0.85)',
  meterRed: 'rgba(220, 38, 38, 0.9)',
  meterBg: 'rgba(128, 128, 128, 0.14)',
  meterPeakHold: 'rgba(0, 0, 0, 0.55)',
  earlyWarningMarker: '#b45309',
  tooltipBg: 'rgba(248, 250, 252, 0.94)',
  tooltipBgAdvisory: 'rgba(248, 250, 252, 0.97)',
  tooltipText: '#0f172a',
  crosshairIdle: 'rgba(15, 23, 42, 0.30)',
}

export interface DbRange {
  dbMin: number
  dbMax: number
  freqMin: number
  freqMax: number
}

// ─── Constants ──────────────────────────────────────────────────────────────────

export const DB_MAJOR = [-90, -60, -30, 0]
export const DB_MINOR = [-80, -70, -50, -40, -20, -10]
export const DB_ALL = [...DB_MAJOR, ...DB_MINOR].sort((a, b) => a - b)

export const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

/**
 * Peak hold decay rate in dB per second (frame-rate-independent).
 * At the canvas target of ~25 fps this yields ~0.5 dB/frame, matching pre-v0.8.0 visuals.
 * Using elapsed time instead of a fixed per-frame constant ensures consistent decay
 * across varying frame rates (throttled tabs, high-refresh monitors, etc.).
 */
export const PEAK_HOLD_DECAY_DB_PER_SEC = 12.5

/**
 * Maximum delta-time (seconds) used for peak hold decay calculation.
 * Clamps large gaps (e.g. returning from a backgrounded tab) so peaks
 * don't instantly vanish in a single frame.
 */
export const PEAK_HOLD_MAX_DT_SEC = 0.25

/** @deprecated Use PEAK_HOLD_DECAY_DB_PER_SEC with time-based decay instead. */
export const PEAK_HOLD_DECAY_DB = 0.5

// ─── Utility Functions ──────────────────────────────────────────────────────────

export function calcPadding(width: number, height: number) {
  return {
    top: Math.round(height * 0.05),
    right: Math.round(width * 0.02),
    bottom: Math.round(height * 0.09),
    left: Math.round(width * 0.065),
  }
}

// ── measureText cache — avoids expensive text rendering engine queries (14+ calls/frame → ~0) ──
// Keyed by "font|text" since measurement depends on both. Max ~100 entries (bounded by unique labels).
const _measureCache = new Map<string, TextMetrics>()
let _measureCacheFont = ''

/**
 * Cached measureText — exported for sibling drawing modules (not re-exported from barrel).
 * Avoids expensive text rendering engine queries by caching measurements per font+text.
 */
export function cachedMeasureText(ctx: CanvasRenderingContext2D, text: string): TextMetrics {
  // Clear cache when font changes (theme switch, font size change)
  const font = ctx.font
  if (font !== _measureCacheFont) {
    _measureCache.clear()
    _measureCacheFont = font
  }
  let m = _measureCache.get(text)
  if (!m) {
    m = ctx.measureText(text)
    _measureCache.set(text, m)
  }
  return m
}
