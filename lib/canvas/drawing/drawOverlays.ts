/**
 * Canvas Drawing — Detection Overlays
 *
 * Notch-width bands, advisory peak markers, threshold/noise-floor indicator lines.
 */

import { freqToLogPosition, clamp } from '@/lib/utils/mathHelpers'
import { getSeverityColor } from '@/lib/utils/advisoryDisplay'
import { getSeverityUrgency } from '@/lib/dsp/severityUtils'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import { VIZ_COLORS } from '@/lib/dsp/constants'
import type { SpectrumData, Advisory } from '@/types/advisory'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'

import {
  type CanvasTheme,
  type DbRange,
  DARK_CANVAS_THEME,
  cachedMeasureText,
} from './canvasTypes'

export function drawIndicatorLines(
  ctx: CanvasRenderingContext2D,
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  spectrum: SpectrumData | null,
  showThresholdLine: boolean,
  feedbackThresholdDb: number | undefined,
  fontSize: number,
  showDragHint: boolean = false,
  theme: CanvasTheme = DARK_CANVAS_THEME,
  thresholdLineY: number | null = null,
) {
  // Noise floor
  if (spectrum?.noiseFloorDb !== null && spectrum?.noiseFloorDb !== undefined) {
    const floorY = ((range.dbMax - spectrum.noiseFloorDb) / (range.dbMax - range.dbMin)) * plotHeight

    // Semi-transparent fill below noise floor (subtle region indicator)
    ctx.fillStyle = `${VIZ_COLORS.NOISE_FLOOR}0D` // ~5% opacity
    ctx.fillRect(0, floorY, plotWidth, plotHeight - floorY)

    // Fix 12 (AI Fight Club): save/restore to prevent alpha/dash leakage on exception
    ctx.save()
    ctx.strokeStyle = VIZ_COLORS.NOISE_FLOOR
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, floorY)
    ctx.lineTo(plotWidth, floorY)
    ctx.stroke()

    // Right-aligned label
    ctx.font = `${Math.max(8, fontSize - 2)}px monospace`
    ctx.fillStyle = VIZ_COLORS.NOISE_FLOOR
    ctx.globalAlpha = 0.85
    ctx.textAlign = 'right'
    ctx.fillText('Floor', plotWidth - 4, floorY - 4)
    ctx.restore()
  }

  // Sensitivity threshold
  const threshY = thresholdLineY ?? (
    spectrum?.effectiveThresholdDb != null
      ? ((range.dbMax - spectrum.effectiveThresholdDb) / (range.dbMax - range.dbMin)) * plotHeight
      : null
  )

  if (showThresholdLine && threshY != null) {
    ctx.strokeStyle = VIZ_COLORS.THRESHOLD
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(0, threshY)
    ctx.lineTo(plotWidth, threshY)
    ctx.stroke()
    ctx.setLineDash([])
    // Grab handle — rounded rect on right side, indicates draggable
    // Enlarged for better discoverability (12×36px — exceeds 44px touch target with grab radius)
    const handleW = 12
    const handleH = 36
    const handleX = plotWidth - handleW - 2
    const handleY = threshY - handleH / 2

    // Subtle glow behind handle for first-time users (pulsing via showDragHint)
    if (showDragHint) {
      ctx.fillStyle = VIZ_COLORS.THRESHOLD
      ctx.globalAlpha = 0.15
      const glowPath = new Path2D()
      glowPath.roundRect(handleX - 4, handleY - 4, handleW + 8, handleH + 8, 6)
      ctx.fill(glowPath)
    }

    ctx.fillStyle = VIZ_COLORS.THRESHOLD
    ctx.globalAlpha = 0.75
    const handlePath = new Path2D()
    handlePath.roundRect(handleX, handleY, handleW, handleH, 4)
    ctx.fill(handlePath)
    // Inner notch lines (3 horizontal lines to indicate drag affordance)
    // Light theme needs stronger opacity to contrast against lighter handle fill
    ctx.strokeStyle = theme === DARK_CANVAS_THEME ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.6)'
    ctx.lineWidth = 1
    ctx.globalAlpha = 1
    for (let i = -1; i <= 1; i++) {
      const ny = threshY + i * 6
      ctx.beginPath()
      ctx.moveTo(handleX + 3, ny)
      ctx.lineTo(handleX + handleW - 3, ny)
      ctx.stroke()
    }

    // Right-aligned label (positioned left of handle)
    const threshLabel = `Sens +${feedbackThresholdDb ?? 0}dB`
    ctx.font = `${Math.max(8, fontSize - 2)}px monospace`
    ctx.fillStyle = VIZ_COLORS.THRESHOLD
    ctx.textAlign = 'right'
    ctx.globalAlpha = 0.7
    ctx.fillText(threshLabel, handleX - 6, threshY - 4)

    // First-drag hint — shows until user drags the threshold for the first time
    if (showDragHint) {
      ctx.font = `bold ${Math.max(10, fontSize)}px monospace`
      ctx.fillStyle = VIZ_COLORS.THRESHOLD
      ctx.globalAlpha = 0.65
      ctx.textAlign = 'right'
      ctx.fillText('↕ Drag to adjust sensitivity', handleX - 6, threshY + 14)
    }

    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
  }
}

/**
 * Draw semi-transparent notch-width overlays behind advisory markers.
 *
 * For clustered advisories, the band spans clusterMinHz–clusterMaxHz
 * (matching the widened PEQ Q). For single peaks, the band is derived
 * from the PEQ Q recommendation: bandwidth = centerHz / Q.
 *
 * Drawn before drawMarkers() so peak dots/lines render on top.
 */
export function drawNotchOverlays(
  ctx: CanvasRenderingContext2D,
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  advisories: Advisory[],
  clearedIds: Set<string> | undefined,
  theme: CanvasTheme = DARK_CANVAS_THEME,
): Set<string> {
  void theme
  const notchedIds = new Set<string>()
  const visible = advisories
    .filter(a => !clearedIds?.has(a.id))
    .slice(-7) // Same cap as drawMarkers

  // Build pixel-space bars, then merge overlapping/adjacent ones into solid blocks
  const bars: { x1: number; x2: number; color: string; ids: string[] }[] = []

  for (const advisory of visible) {
    const centerHz = advisory.trueFrequencyHz
    const peqQ = advisory.advisory?.peq?.q ?? advisory.qEstimate

    // Determine band edges: cluster bounds or Q-derived bandwidth
    let minHz: number
    let maxHz: number
    if (advisory.clusterMinHz && advisory.clusterMaxHz && advisory.clusterMinHz < advisory.clusterMaxHz) {
      // Cluster: add 25% visual margin beyond the notch edges
      const span = advisory.clusterMaxHz - advisory.clusterMinHz
      const margin = span * 0.25
      minHz = advisory.clusterMinHz - margin
      maxHz = advisory.clusterMaxHz + margin
    } else {
      // Single peak: derive from PEQ Q
      const halfBw = centerHz / (2 * peqQ)
      minHz = centerHz - halfBw
      maxHz = centerHz + halfBw
    }

    // Clamp to visible range and convert to pixels
    const x1 = freqToLogPosition(Math.max(minHz, range.freqMin), range.freqMin, range.freqMax) * plotWidth
    const x2 = freqToLogPosition(Math.min(maxHz, range.freqMax), range.freqMin, range.freqMax) * plotWidth
    if (x2 - x1 < 1) continue

    const color = getSeverityColor(advisory.severity)
    bars.push({ x1, x2: Math.max(x2, x1 + 8), color, ids: [advisory.id] })
  }

  // Sort by x1, then merge nearby bars into single solid blocks
  // 3% of plot width (~27px on 900px) catches advisories in the same problem zone
  const mergeGap = plotWidth * 0.03
  bars.sort((a, b) => a.x1 - b.x1)
  const merged: typeof bars = []
  for (const bar of bars) {
    const prev = merged[merged.length - 1]
    if (prev && bar.x1 <= prev.x2 + mergeGap) {
      // Merge: extend previous bar, keep highest-severity color
      prev.x2 = Math.max(prev.x2, bar.x2)
      prev.ids.push(...bar.ids)
    } else {
      merged.push({ ...bar })
    }
  }

  // Draw merged bars as single solid blocks
  for (const bar of merged) {
    ctx.fillStyle = bar.color
    ctx.globalAlpha = 0.15
    ctx.fillRect(bar.x1, 0, bar.x2 - bar.x1, plotHeight)
    for (const id of bar.ids) notchedIds.add(id)
  }

  ctx.globalAlpha = 1
  return notchedIds
}

export function drawMarkers(
  ctx: CanvasRenderingContext2D,
  plotWidth: number,
  plotHeight: number,
  range: DbRange,
  earlyWarning: EarlyWarning | null | undefined,
  advisories: Advisory[],
  clearedIds: Set<string> | undefined,
  peakMarkerRadius: number,
  fontSize: number,
  theme: CanvasTheme = DARK_CANVAS_THEME,
  notchedIds?: Set<string>,
  /** When set, suppress frequency labels within this distance (px) of cursor */
  hoverSuppressX?: number | null,
) {
  const isDark = theme === DARK_CANVAS_THEME
  // Early warning predictions
  if (earlyWarning && earlyWarning.predictedFrequencies.length > 0) {
    const warningColor = theme.earlyWarningMarker
    ctx.strokeStyle = warningColor
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.globalAlpha = 0.6

    for (const freq of earlyWarning.predictedFrequencies) {
      if (freq < range.freqMin || freq > range.freqMax) continue
      const x = freqToLogPosition(freq, range.freqMin, range.freqMax) * plotWidth

      // Vertical dashed line
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, plotHeight)
      ctx.stroke()

      // Warning triangle at top
      ctx.fillStyle = warningColor
      ctx.beginPath()
      ctx.moveTo(x, 8)
      ctx.lineTo(x - 5, 0)
      ctx.lineTo(x + 5, 0)
      ctx.closePath()
      ctx.fill()
    }

    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // Advisory peak markers (persist until cleared, cap at 7)
  const visibleAdvisories = advisories
    .filter(a => !clearedIds?.has(a.id))
    .slice(-7)

  // Pre-compute label positions and determine which labels to show when overlapping.
  // Higher-severity (more problematic) advisories win; ties broken by confidence.
  const labelFont = `${fontSize + 3}px monospace`
  ctx.font = labelFont
  // Collision padding: pillPadX(7) + border(1) + shadow(1) + visual gap(7) = 16
  const labelPadding = 16
  const labelShowFlags: boolean[] = new Array(visibleAdvisories.length).fill(false)

  // Build priority-sorted indices (most problematic first)
  const indices = visibleAdvisories.map((_, i) => i)
  indices.sort((a, b) => {
    const urgA = getSeverityUrgency(visibleAdvisories[a].severity)
    const urgB = getSeverityUrgency(visibleAdvisories[b].severity)
    if (urgB !== urgA) return urgB - urgA
    return visibleAdvisories[b].confidence - visibleAdvisories[a].confidence
  })

  // Pre-compute x-center for each advisory
  const labelXCenters: number[] = visibleAdvisories.map(advisory =>
    freqToLogPosition(advisory.trueFrequencyHz, range.freqMin, range.freqMax) * plotWidth
  )

  // Compute label x-ranges (center ± half-width + padding)
  const labelXRanges: Array<{ left: number; right: number }> = visibleAdvisories.map((advisory, i) => {
    const halfWidth = cachedMeasureText(ctx, formatFrequency(advisory.trueFrequencyHz)).width / 2 + labelPadding
    return { left: labelXCenters[i] - halfWidth, right: labelXCenters[i] + halfWidth }
  })

  // Greedily accept labels in priority order, reject overlaps
  const accepted: number[] = []
  for (const idx of indices) {
    const range_i = labelXRanges[idx]
    const overlaps = accepted.some(a => {
      const range_a = labelXRanges[a]
      return range_i.left < range_a.right && range_i.right > range_a.left
    })
    if (!overlaps) {
      labelShowFlags[idx] = true
      accepted.push(idx)
    }
  }

  // Merge nearby suppressed labels into range pills for accepted labels.
  // Each accepted label absorbs suppressed neighbors within merge distance,
  // producing a range label like "820–950Hz" or "1.2–1.5kHz ×3".
  const mergeDistance = labelPadding * 3
  const mergedLabelText = new Map<number, string>()
  const mergedLabelRange = new Map<number, { minHz: number; maxHz: number }>()
  const claimed = new Set<number>() // prevent double-claiming suppressed labels

  for (const acceptedIdx of accepted) {
    const group = [acceptedIdx]
    for (let j = 0; j < visibleAdvisories.length; j++) {
      if (labelShowFlags[j] || j === acceptedIdx || claimed.has(j)) continue
      const dist = Math.abs(labelXCenters[j] - labelXCenters[acceptedIdx])
      if (dist < mergeDistance) {
        group.push(j)
        claimed.add(j)
      }
    }
    if (group.length > 1) {
      const freqs = group.map(i => visibleAdvisories[i].trueFrequencyHz)
      const minF = Math.min(...freqs)
      const maxF = Math.max(...freqs)
      const countSuffix = group.length >= 3 ? ` ×${group.length}` : ''
      mergedLabelText.set(acceptedIdx, `${formatFrequency(minF)}–${formatFrequency(maxF)}${countSuffix}`)
      mergedLabelRange.set(acceptedIdx, { minHz: minF, maxHz: maxF })
    }
  }

  for (let i = 0; i < visibleAdvisories.length; i++) {
    const advisory = visibleAdvisories[i]
    const freq = advisory.trueFrequencyHz
    const db = advisory.trueAmplitudeDb
    const x = freqToLogPosition(freq, range.freqMin, range.freqMax) * plotWidth
    const y = ((range.dbMax - clamp(db, range.dbMin, range.dbMax)) / (range.dbMax - range.dbMin)) * plotHeight
    const color = getSeverityColor(advisory.severity)

    // Vertical line — skip when notch overlay already marks this frequency
    if (!notchedIds?.has(advisory.id)) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.42
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, plotHeight)
      ctx.stroke()
    }

    // Peak halo — soft glow ring behind dot
    ctx.fillStyle = color
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    ctx.arc(x, y, peakMarkerRadius * 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // Peak dot
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, peakMarkerRadius, 0, Math.PI * 2)
    ctx.fill()

    // Frequency label — only show if not occluded by a higher-priority label
    // Also suppress when hover tooltip is nearby (avoids overlapping text clutter)
    // Check against the label's full x-range, not just center, so pills left of the cursor also hide
    const labelRange = labelXRanges[i]
    const suppressedByHover = hoverSuppressX != null && hoverSuppressX >= labelRange.left - 20 && hoverSuppressX <= labelRange.right + 20
    if (labelShowFlags[i] && !suppressedByHover) {
      const labelText = mergedLabelText.get(i) ?? formatFrequency(freq)

      // Merged range highlight band — severity-tinted full-height fill
      const mergeRange = mergedLabelRange.get(i)
      if (mergeRange) {
        const rx1 = freqToLogPosition(mergeRange.minHz, range.freqMin, range.freqMax) * plotWidth
        const rx2 = freqToLogPosition(mergeRange.maxHz, range.freqMin, range.freqMax) * plotWidth
        ctx.fillStyle = color
        ctx.globalAlpha = isDark ? 0.08 : 0.10
        ctx.fillRect(rx1, 0, rx2 - rx1, plotHeight)
        ctx.globalAlpha = 1
      }

      ctx.font = labelFont
      ctx.textAlign = 'center'
      const labelY = y - 10

      // Pro audio callout badge — frosted glass with severity accent
      // Uses measureText bounding box to perfectly center text inside pill
      const metrics = cachedMeasureText(ctx, labelText)
      const ascent = metrics.actualBoundingBoxAscent
      const descent = metrics.actualBoundingBoxDescent
      const pillPadX = 7
      const pillPadY = 4
      const pillW = metrics.width + pillPadX * 2
      const pillH = ascent + descent + pillPadY * 2
      const pillX = x - pillW / 2
      // labelY is the text baseline — pill top sits ascent + padding above it
      const pillY = labelY - ascent - pillPadY
      const pillR = 4

      // 1. Drop shadow for depth
      ctx.fillStyle = isDark
        ? 'rgba(0, 0, 0, 0.35)'
        : 'rgba(0, 0, 0, 0.10)'
      ctx.beginPath()
      ctx.roundRect(pillX + 1, pillY + 2, pillW, pillH, pillR)
      ctx.fill()

      // 2. Frosted glass fill
      ctx.fillStyle = isDark
        ? 'rgba(12, 14, 18, 0.88)'
        : 'rgba(255, 255, 255, 0.93)'
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, pillW, pillH, pillR)
      ctx.fill()

      // 3. Severity-tinted border (single path, no re-stroke)
      ctx.strokeStyle = color
      ctx.globalAlpha = isDark ? 0.35 : 0.50
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1

      // 4. Severity accent strip at bottom (instrument LED bar)
      const accentH = 1.5
      ctx.fillStyle = color
      ctx.globalAlpha = isDark ? 0.50 : 0.60
      ctx.beginPath()
      ctx.roundRect(pillX + 2, pillY + pillH - accentH - 1, pillW - 4, accentH, 1)
      ctx.fill()
      ctx.globalAlpha = 1

      // 5. Label text — crisp against glass with subtle shadow
      ctx.shadowColor = isDark
        ? 'rgba(0, 0, 0, 0.70)'
        : 'rgba(255, 255, 255, 0.85)'
      ctx.shadowBlur = isDark ? 1 : 2
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = isDark ? 1 : 0
      ctx.fillStyle = color
      ctx.fillText(labelText, x, labelY)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
    }
  }
}
