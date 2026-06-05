/**
 * Shared canvas color tokens and helpers.
 *
 * Canvas rendering cannot use CSS `var()` directly — these constants
 * centralize the hardcoded hex values that were previously scattered
 * across SingleFader, InputMeterSlider, and GEQBarView.
 */

// ── Meter background ─────────────────────────────────────────────────────────

/** Meter/fader track background */
export const METER_BG_DARK = '#0e1012'
export const METER_BG_LIGHT = '#e8eaee'

export function meterBg(isDark: boolean): string {
  return isDark ? METER_BG_DARK : METER_BG_LIGHT
}

// ── Meter gradient color stops ───────────────────────────────────────────────

/** LED-style meter gradient: blue → yellow → red (signal level) */
export const METER_STOPS: [number, string][] = [
  [0, '#4B92FF'],
  [0.6, '#4B92FF'],
  [0.8, '#eab308'],
  [0.95, '#ef4444'],
  [1, '#ef4444'],
]

/**
 * Applies the standard meter gradient stops to a CanvasGradient.
 * Call with a gradient created in the desired direction (vertical or horizontal).
 */
export function applyMeterStops(gradient: CanvasGradient): CanvasGradient {
  for (const [offset, color] of METER_STOPS) {
    gradient.addColorStop(offset, color)
  }
  return gradient
}

// ── GEQ canvas colors ────────────────────────────────────────────────────────

export const GEQ_BG_DARK = '#08101a'
export const GEQ_BG_LIGHT = '#f0f1f4'
export const GEQ_GRID_DARK = '#1e2533'
export const GEQ_GRID_LIGHT = '#d0d4da'
export const GEQ_CENTER_DARK = '#27303f'
export const GEQ_CENTER_LIGHT = '#c0c5cc'
export const GEQ_BAR_OUTLINE = '#121416'
export const GEQ_AXIS_LABEL_LIGHT = '#5a6478'

export function geqBg(isDark: boolean): string {
  return isDark ? GEQ_BG_DARK : GEQ_BG_LIGHT
}
export function geqGrid(isDark: boolean): string {
  return isDark ? GEQ_GRID_DARK : GEQ_GRID_LIGHT
}
export function geqCenter(isDark: boolean): string {
  return isDark ? GEQ_CENTER_DARK : GEQ_CENTER_LIGHT
}

// ── Canvas overlay colors (drag hints, tooltips) ─────────────────────────────

export const OVERLAY_TEXT = '#e5e5e5'
export const OVERLAY_ACCENT = '#60a5fa'  // blue-400

// ── Severity colors (for inline styles where CSS vars aren't available) ───────

export const RUNAWAY_COLOR = '#ef4444'  // red-500 — matches VIZ_COLORS.RUNAWAY
export const GROWING_COLOR = '#fb923c'  // orange-400 — matches VIZ_COLORS.GROWING

// ── Confidence ring colors ───────────────────────────────────────────────────

/** Confidence level → ring color for issue card SVG */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return '#34d399'  // emerald-400
  if (confidence >= 0.70) return '#60a5fa'  // blue-400
  if (confidence >= 0.45) return '#fbbf24'  // amber-400
  return '#6b7280'                          // gray-500
}
