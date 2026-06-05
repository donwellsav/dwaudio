import { ISO_31_BANDS, VIZ_COLORS } from '@/lib/dsp/constants'
import {
  geqBg,
  geqCenter,
  GEQ_AXIS_LABEL_LIGHT,
  geqGrid,
} from '@/lib/canvas/canvasTokens'
import type { BandRecommendation } from '@/lib/canvas/geqBarViewShared'
import { GEQ_BAND_LABELS } from '@/lib/canvas/geqBarViewShared'

export interface GEQCanvasMetrics {
  width: number
  height: number
  padding: {
    top: number
    right: number
    bottom: number
    left: number
  }
  plotWidth: number
  plotHeight: number
  centerY: number
  barSpacing: number
  barWidth: number
  maxCut: number
  numBands: number
  fontSize: number
  issueFontSize: number
}

export function createGEQCanvasMetrics(
  width: number,
  height: number,
  graphFontSize: number,
): GEQCanvasMetrics {
  const padding = {
    top: Math.round(height * 0.04),
    right: Math.round(width * 0.015),
    bottom: Math.round(height * 0.18),
    left: Math.round(width * 0.065),
  }
  const scaledFontSize = Math.max(8, Math.min(14, Math.round(width * 0.01)))
  const fontSize = Math.round((graphFontSize + scaledFontSize) / 2)
  const issueFontSize = Math.max(fontSize + 4, 14)
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const numBands = ISO_31_BANDS.length
  const barSpacing = plotWidth / numBands
  const barWidth = barSpacing * 0.7
  const maxCut = -18
  const centerY = plotHeight / 2

  return {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    centerY,
    barSpacing,
    barWidth,
    maxCut,
    numBands,
    fontSize,
    issueFontSize,
  }
}

function drawGEQGrid(
  ctx: CanvasRenderingContext2D,
  metrics: GEQCanvasMetrics,
  isDark: boolean,
) {
  ctx.fillStyle = geqBg(isDark)
  ctx.fillRect(0, 0, metrics.plotWidth, metrics.plotHeight)

  const vignette = ctx.createRadialGradient(
    metrics.plotWidth / 2,
    metrics.plotHeight / 2,
    metrics.plotWidth * 0.25,
    metrics.plotWidth / 2,
    metrics.plotHeight / 2,
    metrics.plotWidth * 0.75,
  )
  vignette.addColorStop(0, 'transparent')
  vignette.addColorStop(1, isDark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.06)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, metrics.plotWidth, metrics.plotHeight)

  ctx.strokeStyle = geqGrid(isDark)
  ctx.lineWidth = 0.5
  ctx.setLineDash([2, 2])
  for (const db of [-12, -6, 6, 12]) {
    const y = metrics.centerY - (db / 18) * (metrics.plotHeight / 2)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(metrics.plotWidth, y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  ctx.strokeStyle = geqCenter(isDark)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, metrics.centerY)
  ctx.lineTo(metrics.plotWidth, metrics.centerY)
  ctx.stroke()
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  metrics: GEQCanvasMetrics,
  bandRecommendations: ReadonlyMap<number, BandRecommendation>,
) {
  const frequencyLabels: Array<{
    x: number
    y: number
    label: string
    color: string
    severity: number
  }> = []

  for (let bandIndex = 0; bandIndex < metrics.numBands; bandIndex++) {
    const x = bandIndex * metrics.barSpacing + (metrics.barSpacing - metrics.barWidth) / 2
    const recommendation = bandRecommendations.get(bandIndex)

    if (recommendation && recommendation.suggestedDb < 0) {
      const barHeight = Math.abs(recommendation.suggestedDb / metrics.maxCut) * (metrics.plotHeight / 2)
      const y = metrics.centerY

      ctx.strokeStyle = recommendation.color
      ctx.globalAlpha = 0.15
      ctx.lineWidth = 4
      ctx.strokeRect(x - 1, y - 1, metrics.barWidth + 2, barHeight + 2)

      ctx.fillStyle = recommendation.color
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.roundRect(x, y, metrics.barWidth, barHeight, 2)
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.fillRect(x + 1, y + 1, 1, barHeight - 2)

      ctx.strokeStyle = recommendation.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(x, y, metrics.barWidth, barHeight, 2)
      ctx.stroke()

      ctx.fillStyle = recommendation.color
      ctx.font = `bold ${metrics.issueFontSize}px monospace`
      ctx.textAlign = 'center'
      ctx.fillText(`${recommendation.suggestedDb}`, x + metrics.barWidth / 2, y + barHeight + metrics.issueFontSize + 4)

      frequencyLabels.push({
        x: x + metrics.barWidth / 2,
        y: y - 8,
        label: GEQ_BAND_LABELS[bandIndex],
        color: recommendation.color,
        severity: Math.abs(recommendation.suggestedDb),
      })

      if (recommendation.clusterCount > 1) {
        ctx.font = `bold ${metrics.issueFontSize - 2}px monospace`
        ctx.fillStyle = VIZ_COLORS.SPECTRUM
        ctx.textAlign = 'left'
        ctx.fillText(`+${recommendation.clusterCount - 1}`, x + metrics.barWidth + 4, y + 10)
      }
      continue
    }
  }

  if (frequencyLabels.length === 0) {
    return
  }

  ctx.font = `bold ${metrics.issueFontSize}px monospace`
  ctx.textAlign = 'center'

  const charWidth = metrics.issueFontSize * 0.6
  const minSpacing = charWidth * 3
  const sorted = frequencyLabels.slice().sort((a, b) => a.x - b.x)
  const visible = new Array<boolean>(sorted.length).fill(true)

  for (let i = 0; i < sorted.length; i++) {
    if (!visible[i]) {
      continue
    }

    const labelA = sorted[i]
    const halfWidthA = (labelA.label.length * charWidth) / 2

    for (let j = i + 1; j < sorted.length; j++) {
      if (!visible[j]) {
        continue
      }

      const labelB = sorted[j]
      const halfWidthB = (labelB.label.length * charWidth) / 2
      const gap = labelB.x - labelA.x

      if (gap >= halfWidthA + halfWidthB + minSpacing * 0.3) {
        break
      }

      if (labelA.severity >= labelB.severity) {
        visible[j] = false
      } else {
        visible[i] = false
        break
      }
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    if (!visible[i]) {
      continue
    }
    ctx.fillStyle = sorted[i].color
    ctx.fillText(sorted[i].label, sorted[i].x, sorted[i].y)
  }
}

function drawGEQAxisLabels(
  ctx: CanvasRenderingContext2D,
  metrics: GEQCanvasMetrics,
  isDark: boolean,
) {
  const labelFontSize = Math.min(Math.max(Math.floor(metrics.barSpacing * 0.85), 9), 13)
  ctx.fillStyle = isDark ? VIZ_COLORS.AXIS_LABEL : GEQ_AXIS_LABEL_LIGHT
  ctx.font = `${labelFontSize}px monospace`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'
  ctx.shadowBlur = 3

  for (let bandIndex = 0; bandIndex < metrics.numBands; bandIndex++) {
    const x = metrics.padding.left + bandIndex * metrics.barSpacing + metrics.barSpacing / 2
    ctx.save()
    ctx.translate(x, metrics.height - metrics.padding.bottom + 4)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(GEQ_BAND_LABELS[bandIndex], 0, 0)
    ctx.restore()
  }

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = isDark ? VIZ_COLORS.AXIS_LABEL : GEQ_AXIS_LABEL_LIGHT
  ctx.font = `${metrics.fontSize}px monospace`
  ctx.fillText('0', metrics.padding.left - 5, metrics.padding.top + metrics.centerY)
  ctx.fillText('-12', metrics.padding.left - 5, metrics.padding.top + metrics.centerY + (12 / 18) * (metrics.plotHeight / 2))
  ctx.fillText('+12', metrics.padding.left - 5, metrics.padding.top + metrics.centerY - (12 / 18) * (metrics.plotHeight / 2))

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}

export function drawGEQBarView(
  ctx: CanvasRenderingContext2D,
  metrics: GEQCanvasMetrics,
  bandRecommendations: ReadonlyMap<number, BandRecommendation>,
  isDark: boolean,
): void {
  ctx.save()
  ctx.translate(metrics.padding.left, metrics.padding.top)

  drawGEQGrid(ctx, metrics, isDark)
  drawBars(ctx, metrics, bandRecommendations)

  ctx.restore()

  drawGEQAxisLabels(ctx, metrics, isDark)
}
