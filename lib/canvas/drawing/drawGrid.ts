/**
 * Canvas Drawing — Grid & Background Layers
 *
 * Static background: grid lines, frequency zones, axis labels.
 */

import { freqToLogPosition } from '@/lib/utils/mathHelpers'

import {
  type CanvasTheme,
  type DbRange,
  DARK_CANVAS_THEME,
  DB_MAJOR,
  DB_MINOR,
  DB_ALL,
  FREQ_LABELS,
} from './canvasTypes'

// ── Grid Path2D cache — geometry rebuilt only when range or dimensions change ──
let _gridMinorPath: Path2D | null = null
let _gridMajorPath: Path2D | null = null
let _gridFreqPath: Path2D | null = null
let _gridCacheKey = ''

// ── Gradient cache — rebuilt only on canvas resize ──
let _backlightGradDark: CanvasGradient | null = null
let _backlightGradLight: CanvasGradient | null = null
let _gradCacheKey = ''

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  theme: CanvasTheme = DARK_CANVAS_THEME,
) {
  // Background
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, plotWidth, plotHeight)

  // Radial vignette + instrument backlight — cached, rebuilt only on resize
  const isDark = theme === DARK_CANVAS_THEME
  const gKey = `${plotWidth}|${plotHeight}`
  if (gKey !== _gradCacheKey) {
    // Color stops added per-frame below (theme may change without resize)
    _backlightGradDark = ctx.createRadialGradient(
      plotWidth * 0.5, plotHeight * 0.3, 0,
      plotWidth * 0.5, plotHeight * 0.5, plotWidth * 0.52,
    )
    _backlightGradDark.addColorStop(0, 'rgba(20, 45, 90, 0.28)')
    _backlightGradDark.addColorStop(1, 'rgba(0, 0, 0, 0)')
    _backlightGradLight = ctx.createRadialGradient(
      plotWidth * 0.5, plotHeight * 0.3, 0,
      plotWidth * 0.5, plotHeight * 0.5, plotWidth * 0.52,
    )
    _backlightGradLight.addColorStop(0, 'rgba(180, 140, 60, 0.18)')
    _backlightGradLight.addColorStop(1, 'rgba(0, 0, 0, 0)')
    _gradCacheKey = gKey
  }
  // Vignette — color stops must be reset each frame since theme can change
  // CanvasGradient color stops are append-only, so we must rebuild on theme change.
  // But vignette geometry only depends on dimensions, so we cache the geometry key.
  const vg = ctx.createRadialGradient(
    plotWidth / 2, plotHeight / 2, plotWidth * 0.25,
    plotWidth / 2, plotHeight / 2, plotWidth * 0.75,
  )
  vg.addColorStop(0, 'transparent')
  vg.addColorStop(1, theme.vignette)
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, plotWidth, plotHeight)

  // Instrument backlight — use cached gradient (theme-specific, geometry-cached)
  ctx.fillStyle = isDark ? _backlightGradDark! : _backlightGradLight!
  ctx.fillRect(0, 0, plotWidth, plotHeight)

  // Rebuild cached grid paths only when geometry inputs change
  const key = `${plotWidth}|${plotHeight}|${range.dbMin}|${range.dbMax}|${range.freqMin}|${range.freqMax}`
  if (key !== _gridCacheKey) {
    const dbSpan = range.dbMax - range.dbMin

    _gridMinorPath = new Path2D()
    for (const db of DB_MINOR) {
      const y = ((range.dbMax - db) / dbSpan) * plotHeight
      _gridMinorPath.moveTo(0, y)
      _gridMinorPath.lineTo(plotWidth, y)
    }

    _gridMajorPath = new Path2D()
    for (const db of DB_MAJOR) {
      const y = ((range.dbMax - db) / dbSpan) * plotHeight
      _gridMajorPath.moveTo(0, y)
      _gridMajorPath.lineTo(plotWidth, y)
    }

    _gridFreqPath = new Path2D()
    for (const freq of FREQ_LABELS) {
      const x = freqToLogPosition(freq, range.freqMin, range.freqMax) * plotWidth
      _gridFreqPath.moveTo(x, 0)
      _gridFreqPath.lineTo(x, plotHeight)
    }

    _gridCacheKey = key
  }

  // Stroke cached paths with current theme colors
  ctx.strokeStyle = theme.gridMinor
  ctx.lineWidth = 0.5
  ctx.stroke(_gridMinorPath!)

  ctx.strokeStyle = theme.gridMajor
  ctx.lineWidth = 1
  ctx.stroke(_gridMajorPath!)

  ctx.strokeStyle = theme.gridFreq
  ctx.lineWidth = 0.5
  ctx.stroke(_gridFreqPath!)
}

/** Frequency zone band boundaries — colors are theme-dependent */
const FREQ_ZONE_BANDS = [
  { label: 'SUB',      minHz: 20,   maxHz: 120,   rgb: '139, 92, 246'  },  // violet
  { label: 'LOW MID',  minHz: 120,  maxHz: 500,   rgb: '96, 165, 250'  },  // blue
  { label: 'MID',      minHz: 500,  maxHz: 2000,  rgb: '75, 146, 255'  },  // primary blue
  { label: 'PRESENCE', minHz: 2000, maxHz: 6000,  rgb: '250, 204, 21'  },  // yellow
  { label: 'AIR',      minHz: 6000, maxHz: 20000, rgb: '96, 165, 250'  },  // light blue
] as const

// Zone fill opacity per band — dark mode is stronger (dark bg absorbs color)
const ZONE_ALPHA_DARK  = [0.20, 0.17, 0.15, 0.14, 0.14]
const ZONE_ALPHA_LIGHT = [0.08, 0.07, 0.07, 0.06, 0.06]

// #5 Zone fade-in state — module-level for zero-alloc per-frame tracking
let _zoneFadeStart = 0
let _zoneWasVisible = false

/**
 * Draw labeled frequency zone bands behind the spectrum.
 * Tinted rectangles with labels at top to help engineers orient.
 * Theme-aware: stronger fills on dark backgrounds, subtler on light.
 * Fades in over 300ms when toggled on (#5).
 * @param showZones - when false, this function is a no-op
 */
export function drawFreqZones(
  ctx: CanvasRenderingContext2D,
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  showZones: boolean,
  theme: CanvasTheme = DARK_CANVAS_THEME,
) {
  if (!showZones) { _zoneWasVisible = false; return }
  // Track fade-in start time
  if (!_zoneWasVisible) { _zoneFadeStart = performance.now(); _zoneWasVisible = true }
  const fadeProgress = Math.min(1, (performance.now() - _zoneFadeStart) / 300)

  const isDark = theme === DARK_CANVAS_THEME
  const alphas = isDark ? ZONE_ALPHA_DARK : ZONE_ALPHA_LIGHT

  for (let z = 0; z < FREQ_ZONE_BANDS.length; z++) {
    const zone = FREQ_ZONE_BANDS[z]
    const x1 = freqToLogPosition(Math.max(zone.minHz, range.freqMin), range.freqMin, range.freqMax) * plotWidth
    const x2 = freqToLogPosition(Math.min(zone.maxHz, range.freqMax), range.freqMin, range.freqMax) * plotWidth
    if (x2 <= x1) continue // zone outside visible range

    // Tinted background band (faded in via fadeProgress)
    ctx.fillStyle = `rgba(${zone.rgb}, ${alphas[z] * fadeProgress})`
    ctx.fillRect(x1, 0, x2 - x1, plotHeight)

    // Fix 12 (AI Fight Club): save/restore to prevent alpha leakage on exception
    ctx.save()
    ctx.strokeStyle = theme.zoneLabel
    ctx.globalAlpha = 0.25 * fadeProgress
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(x1, 0)
    ctx.lineTo(x1, plotHeight)
    ctx.stroke()
    ctx.restore()

    // Label at top center of zone
    const centerX = (x1 + x2) / 2
    const labelWidth = x2 - x1
    if (labelWidth > 30) { // only draw label if zone is wide enough
      ctx.save()
      ctx.globalAlpha = fadeProgress
      ctx.font = '10px var(--font-sans, sans-serif)'
      ctx.fillStyle = theme.zoneLabel
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(zone.label, centerX, 4)
      ctx.restore()
    }
  }

  // Reset text state to avoid leaking font/alignment to subsequent draw calls
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}


export function drawAxisLabels(
  ctx: CanvasRenderingContext2D,
  padding: { top: number; left: number; right: number; bottom: number },
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  fontSize: number,
  _width: number,
  _height: number,
  theme: CanvasTheme = DARK_CANVAS_THEME,
) {
  ctx.font = `${fontSize}px monospace`
  ctx.textBaseline = 'middle'

  // Text shadow for readability
  ctx.shadowColor = theme.axisLabelShadow
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = theme.axisLabel

  // Y-axis (dB) — thin out labels when plot is short (#4)
  ctx.textAlign = 'right'
  const dbLabels = plotHeight < 200 ? DB_MAJOR : DB_ALL
  for (const db of dbLabels) {
    const y = padding.top + ((range.dbMax - db) / (range.dbMax - range.dbMin)) * plotHeight
    ctx.fillText(`${db}`, padding.left - 5, y)
  }

  // X-axis (Hz) with tick marks (#6)
  ctx.textAlign = 'center'
  const xLabelY = padding.top + plotHeight + padding.bottom * 0.55
  ctx.strokeStyle = theme.gridMinor
  ctx.lineWidth = 0.75
  for (const freq of FREQ_LABELS) {
    const x = padding.left + freqToLogPosition(freq, range.freqMin, range.freqMax) * plotWidth
    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`
    ctx.fillText(label, x, xLabelY)
    // Tick mark connecting axis to plot
    ctx.beginPath()
    ctx.moveTo(x, padding.top + plotHeight)
    ctx.lineTo(x, padding.top + plotHeight + 4)
    ctx.stroke()
  }

  // Reset shadow
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}
