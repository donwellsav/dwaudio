/**
 * Canvas Drawing — Idle State
 *
 * Renders the pre-analysis idle canvas with grid, zones, and a flat floor line.
 */

import { CANVAS_SETTINGS, VIZ_COLORS } from '@/lib/dsp/constants'
import { getSensitivityGraphY } from '@/lib/fader/faderMath'

import {
  type CanvasTheme,
  type DbRange,
  DARK_CANVAS_THEME,
  calcPadding,
} from './canvasTypes'
import { drawGrid, drawFreqZones, drawAxisLabels } from './drawGrid'
import { drawIndicatorLines } from './drawOverlays'

interface DrawIdleCanvasOptions {
  showThresholdLine?: boolean
  feedbackThresholdDb?: number
}

export function drawIdleCanvas(
  canvas: HTMLCanvasElement,
  graphFontSize: number,
  rtaDbMin: number | undefined,
  rtaDbMax: number | undefined,
  theme: CanvasTheme = DARK_CANVAS_THEME,
  options: DrawIdleCanvasOptions = {},
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const width = canvas.width / dpr
  const height = canvas.height / dpr
  if (width === 0 || height === 0) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, height)

  const padding = calcPadding(width, height)
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const scaledFontSize = Math.max(9, Math.min(16, Math.round(width * 0.01)))
  const fontSize = Math.round((graphFontSize + scaledFontSize) / 2)

  const range: DbRange = {
    dbMin: rtaDbMin ?? CANVAS_SETTINGS.RTA_DB_MIN,
    dbMax: rtaDbMax ?? CANVAS_SETTINGS.RTA_DB_MAX,
    freqMin: CANVAS_SETTINGS.RTA_FREQ_MIN,
    freqMax: CANVAS_SETTINGS.RTA_FREQ_MAX,
  }

  ctx.save()
  ctx.translate(padding.left, padding.top)

  drawGrid(ctx, plotWidth, plotHeight, range, theme)

  // Educational frequency zone bands — always shown at idle
  drawFreqZones(ctx, plotWidth, plotHeight, range, true, theme)

  const thresholdLineY = options.showThresholdLine && options.feedbackThresholdDb != null
    ? getSensitivityGraphY({ value: options.feedbackThresholdDb, plotHeight })
    : null
  drawIndicatorLines(
    ctx,
    plotWidth,
    plotHeight,
    range,
    null,
    options.showThresholdLine ?? false,
    options.feedbackThresholdDb,
    fontSize,
    false,
    theme,
    thresholdLineY,
  )

  // Zero-signal floor line — flat line at the bottom of the visible range
  const floorY = plotHeight
  ctx.strokeStyle = VIZ_COLORS.SPECTRUM
  ctx.globalAlpha = 0.18
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, floorY)
  ctx.lineTo(plotWidth, floorY)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.restore()

  drawAxisLabels(ctx, padding, plotWidth, plotHeight, range, fontSize, width, height, theme)
}
