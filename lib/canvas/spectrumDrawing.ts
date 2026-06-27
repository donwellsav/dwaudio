/**
 * Spectrum Canvas Drawing Functions — Barrel Re-export
 *
 * All drawing logic lives in `lib/canvas/drawing/` sub-modules.
 * This file re-exports everything so existing import paths are preserved.
 */

// ─── Types & Constants ─────────────────────────────────────────────────────────
export type { CanvasTheme, DbRange } from './drawing/canvasTypes'
export {
  DARK_CANVAS_THEME, LIGHT_CANVAS_THEME,
  DB_MAJOR, DB_MINOR, DB_ALL, FREQ_LABELS,
  PEAK_HOLD_DECAY_DB_PER_SEC, PEAK_HOLD_MAX_DT_SEC,
  calcPadding,
  cachedMeasureText,
} from './drawing/canvasTypes'

// ─── Grid & Background ────────────────────────────────────────────────────────
export { drawGrid, drawFreqZones, drawAxisLabels } from './drawing/drawGrid'

// ─── Spectrum Rendering ────────────────────────────────────────────────────────
export { drawSpectrum, drawFreqRangeOverlay } from './drawing/drawSpectrum'

// ─── Detection Overlays ────────────────────────────────────────────────────────
export { drawNotchOverlays, drawMarkers, drawIndicatorLines } from './drawing/drawOverlays'

// ─── Level Meters ──────────────────────────────────────────────────────────────
export { drawLevelMeter, drawLevelGlow } from './drawing/drawMeters'

// ─── Idle State ───────────────────────────────────────────────────────────────
export { drawIdleCanvas } from './drawing/drawIdleCanvas'
