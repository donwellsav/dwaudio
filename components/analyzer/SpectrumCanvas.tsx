'use client'

import React, { useRef, useEffect, useCallback, useState, memo, useId } from 'react'
import { useTheme } from 'next-themes'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { logPositionToFreq, clamp } from '@/lib/utils/mathHelpers'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import { CANVAS_SETTINGS } from '@/lib/dsp/constants'
import { getSensitivityGraphY } from '@/lib/fader/faderMath'
import { smoothSpectrumForDisplay, type DisplaySpectrumSmoothingScratch } from '@/lib/canvas/drawing/spectrumSmoothing'
import { thresholdDraggedStorage } from '@/lib/storage/dwaStorage'
import { OVERLAY_ACCENT, GROWING_COLOR } from '@/lib/canvas/canvasTokens'
import { getSeverityColor } from '@/lib/utils/advisoryDisplay'
import { logError } from '@/lib/utils/logger'
import type { SpectrumData, Advisory, SpectrumSmoothingMode } from '@/types/advisory'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'
import { formatSpectrumStatusDescription } from '@/components/analyzer/spectrumCanvasStatus'
import {
  type DbRange, type CanvasTheme, calcPadding, drawGrid, drawFreqZones, drawIndicatorLines, drawSpectrum,
  drawFreqRangeOverlay, drawNotchOverlays, drawMarkers, drawAxisLabels, drawIdleCanvas,
  drawLevelMeter, drawLevelGlow, cachedMeasureText,
  DARK_CANVAS_THEME, LIGHT_CANVAS_THEME,
} from '@/lib/canvas/spectrumDrawing'
import { useSpectrumCanvasInteractions } from '@/hooks/useSpectrumCanvasInteractions'
import { SpectrumCanvasOverlay } from './SpectrumCanvasOverlay'

// ─── Component ─────────────────────────────────────────────────────────────────

/** Visual display settings — typically derived from DetectorSettings.display */
export interface SpectrumDisplayConfig {
  graphFontSize?: number
  rtaDbMin?: number
  rtaDbMax?: number
  spectrumLineWidth?: number
  canvasTargetFps?: number
  showFreqZones?: boolean
  showThresholdLine?: boolean
  spectrumWarmMode?: boolean
  spectrumSmoothingMode?: SpectrumSmoothingMode
}

/** Frequency range and threshold settings */
export interface SpectrumRangeConfig {
  minFrequency?: number
  maxFrequency?: number
  feedbackThresholdDb?: number
}

/** Engine lifecycle state — running/starting/error/onStart */
export interface SpectrumLifecycle {
  isRunning: boolean
  isStarting?: boolean
  error?: string | null
  onStart?: () => void
}

interface SpectrumCanvasProps {
  spectrumRef: React.RefObject<SpectrumData | null>
  advisories: Advisory[]  // Keep as prop — changes infrequently, drives markers
  /** Engine lifecycle state */
  lifecycle: SpectrumLifecycle
  earlyWarning?: EarlyWarning | null
  clearedIds?: Set<string>
  isFrozen?: boolean
  /** Grouped visual display settings */
  display?: SpectrumDisplayConfig
  /** Grouped frequency range / threshold settings */
  range?: SpectrumRangeConfig
  onFreqRangeChange?: (min: number, max: number) => void
  onThresholdChange?: (db: number) => void
  overlay?: React.ReactNode
}

export const SpectrumCanvas = memo(function SpectrumCanvas({ spectrumRef, advisories, lifecycle, earlyWarning, clearedIds, isFrozen = false, display = {}, range = {}, onFreqRangeChange, onThresholdChange, overlay }: SpectrumCanvasProps) {
  const { isRunning, isStarting = false, error, onStart } = lifecycle
  const { graphFontSize = 11, rtaDbMin: rtaDbMinProp, rtaDbMax: rtaDbMaxProp, spectrumLineWidth: spectrumLineWidthProp, canvasTargetFps, showFreqZones = false, showThresholdLine = false, spectrumWarmMode = false, spectrumSmoothingMode = 'raw' } = display
  const { minFrequency = 20, maxFrequency = 20000, feedbackThresholdDb } = range
  const rtaDbMin = rtaDbMinProp ?? CANVAS_SETTINGS.RTA_DB_MIN
  const rtaDbMax = rtaDbMaxProp ?? CANVAS_SETTINGS.RTA_DB_MAX
  const descId = useId()
  const { resolvedTheme } = useTheme()
  const canvasThemeRef = useRef<CanvasTheme>(DARK_CANVAS_THEME)
  canvasThemeRef.current = resolvedTheme === 'dark' ? DARK_CANVAS_THEME : LIGHT_CANVAS_THEME
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dimensionsRef = useRef({ width: 0, height: 0 })
  const advisoriesRef = useRef(advisories)
  advisoriesRef.current = advisories
  const clearedIdsRef = useRef(clearedIds)
  clearedIdsRef.current = clearedIds

  // Freq range ref for 60fps reads during drag (avoids React re-renders)
  const freqRangeRef = useRef({ min: minFrequency, max: maxFrequency })
  useEffect(() => {
    freqRangeRef.current = { min: minFrequency, max: maxFrequency }
  }, [minFrequency, maxFrequency])


  // Drag state — freq range (horizontal) + threshold (vertical)
  const dragRef = useRef<'min' | 'max' | null>(null)
  const threshDragRef = useRef<{ active: boolean; startY: number; startDb: number }>({ active: false, startY: 0, startDb: 0 })
  const showDragHintRef = useRef(!thresholdDraggedStorage.isSet())
  const paddingRef = useRef({ left: 0, top: 0, plotWidth: 0, plotHeight: 0 })
  const onFreqRangeChangeRef = useRef(onFreqRangeChange)
  onFreqRangeChangeRef.current = onFreqRangeChange
  const onThresholdChangeRef = useRef(onThresholdChange)
  onThresholdChangeRef.current = onThresholdChange
  const feedbackThresholdDbRef = useRef(feedbackThresholdDb ?? 25)
  feedbackThresholdDbRef.current = feedbackThresholdDb ?? 25
  const effectiveThreshYRef = useRef<number | null>(null)

  // Freeze: snapshot spectrum data so canvas holds a moment while analysis continues
  const isFrozenRef = useRef(false)
  const frozenSpectrumRef = useRef<SpectrumData | null>(null)

  useEffect(() => {
    isFrozenRef.current = isFrozen
    if (isFrozen && spectrumRef.current) {
      // Deep-copy Float32Arrays — analyzer overwrites the same buffer each frame
      frozenSpectrumRef.current = {
        ...spectrumRef.current,
        freqDb: new Float32Array(spectrumRef.current.freqDb),
        power: new Float32Array(spectrumRef.current.power),
      }
    } else {
      frozenSpectrumRef.current = null
    }
    dirtyRef.current = true
  }, [isFrozen, spectrumRef])

  // Cached per-frame objects — avoid recreating every frame
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const gradientRef = useRef<CanvasGradient | null>(null)
  const gradientHeightRef = useRef(0)
  const peakHoldRef = useRef<Float32Array | null>(null)
  const smoothingScratchRef = useRef<DisplaySpectrumSmoothingScratch | null>(null)

  // Hover tooltip: track mouse position for freq+dB readout (null = not hovering)
  const hoverPosRef = useRef<{ x: number; y: number } | null>(null)

  // Dirty-bit: skip canvas redraw when nothing has changed
  const lastSpectrumRef = useRef<SpectrumData | null>(null)
  const dirtyRef = useRef(true) // Start dirty to ensure first frame draws

  // Track whether analysis has ever started; once true the idle start overlay is gone for good.
  const [hasEverStarted, setHasEverStarted] = useState(false)
  useEffect(() => {
    if (isRunning) setHasEverStarted(true)
  }, [isRunning])

  const showIdleStartOverlay = !hasEverStarted

  const syncIdleCanvas = useCallback((canvas: HTMLCanvasElement, width = dimensionsRef.current.width, height = dimensionsRef.current.height) => {
    if (width === 0 || height === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    drawIdleCanvas(canvas, graphFontSize, rtaDbMin, rtaDbMax, canvasThemeRef.current, {
      showThresholdLine,
      feedbackThresholdDb,
    })

    const padding = calcPadding(width, height)
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom
    paddingRef.current = { left: padding.left, top: padding.top, plotWidth, plotHeight }
    effectiveThreshYRef.current = showThresholdLine && feedbackThresholdDb != null
      ? getSensitivityGraphY({ value: feedbackThresholdDb, plotHeight })
      : null
  }, [feedbackThresholdDb, graphFontSize, rtaDbMax, rtaDbMin, showThresholdLine])

  const handleKeyDown = useSpectrumCanvasInteractions({
    canvasRef,
    onFreqRangeChange,
    onThresholdChange,
    dragRef,
    threshDragRef,
    showDragHintRef,
    paddingRef,
    freqRangeRef,
    onFreqRangeChangeRef,
    onThresholdChangeRef,
    feedbackThresholdDbRef,
    effectiveThreshYRef,
    hoverPosRef,
    dirtyRef,
  })

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      try {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          dimensionsRef.current = { width, height }

          const dpr = window.devicePixelRatio || 1
          dprRef.current = dpr

          // Invalidate cached objects on resize
          ctxRef.current = null
          gradientRef.current = null
          dirtyRef.current = true

          const canvas = canvasRef.current
          if (canvas && !hasEverStarted) {
            // Pre-analysis: draw directly because the live RAF loop has not started yet.
            syncIdleCanvas(canvas, width, height)
          }
          // During analysis: the render callback syncs canvas dimensions
          // atomically with the redraw, preventing flash from observer clearing
        }
      } catch (err) {
        logError('[SpectrumCanvas] resize error:', err)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [hasEverStarted, syncIdleCanvas])

  // Redraw when theme changes — idle canvas before start, dirty flag while running.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!hasEverStarted) {
      syncIdleCanvas(canvas)
    } else {
      gradientRef.current = null
      dirtyRef.current = true
    }
  }, [resolvedTheme, hasEverStarted, syncIdleCanvas])

  const render = useCallback((deltaTimeMs: number) => {
    // Convert RAF delta (ms) to seconds for frame-rate-independent peak hold decay
    const dtSeconds = deltaTimeMs > 0 ? deltaTimeMs / 1000 : 0.04 // fallback ~25fps
    const spectrum = isFrozenRef.current ? frozenSpectrumRef.current : spectrumRef.current

    // Dirty check: skip frame if nothing changed since last draw
    const spectrumChanged = spectrum !== lastSpectrumRef.current
    if (!spectrumChanged && !dirtyRef.current) return
    lastSpectrumRef.current = spectrum
    dirtyRef.current = false

    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = dprRef.current
    const { width, height } = dimensionsRef.current
    if (width === 0 || height === 0) return

    // Sync canvas buffer to container dimensions inside the RAF callback
    // so that buffer clear (from setting .width) + redraw are atomic — no flash
    const targetW = Math.floor(width * dpr)
    const targetH = Math.floor(height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctxRef.current = null
      gradientRef.current = null
    }

    if (!ctxRef.current) ctxRef.current = canvas.getContext('2d')
    const ctx = ctxRef.current
    if (!ctx) return

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const padding = calcPadding(width, height)
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom

    // Scale font size proportionally to canvas width, clamped to readable range
    const scaledFontSize = Math.max(10, Math.min(16, Math.round(width * 0.015)))
    const fontSize = Math.round((graphFontSize + scaledFontSize) / 2)
    const peakMarkerRadius = Math.max(4, Math.round(width * 0.005))

    const range: DbRange = {
      dbMin: rtaDbMin,
      dbMax: rtaDbMax,
      freqMin: CANVAS_SETTINGS.RTA_FREQ_MIN,
      freqMax: CANVAS_SETTINGS.RTA_FREQ_MAX,
    }

    // ── Draw phases ──────────────────────────────────────────────
    ctx.save()
    ctx.translate(padding.left, padding.top)

    drawGrid(ctx, plotWidth, plotHeight, range, canvasThemeRef.current)
    drawLevelGlow(ctx, plotWidth, plotHeight, spectrum, canvasThemeRef.current === DARK_CANVAS_THEME)
    drawFreqZones(ctx, plotWidth, plotHeight, range, showFreqZones, canvasThemeRef.current)
    const sensitivityThresholdY = showThresholdLine && feedbackThresholdDb != null
      ? getSensitivityGraphY({ value: feedbackThresholdDb, plotHeight })
      : null
    drawIndicatorLines(ctx, plotWidth, plotHeight, range, spectrum, showThresholdLine, feedbackThresholdDb, fontSize, showDragHintRef.current, canvasThemeRef.current, sensitivityThresholdY)

    // Track threshold line Y for drag detection (in canvas coords relative to plot area).
    effectiveThreshYRef.current = sensitivityThresholdY

    const displayFreqDb = spectrum && spectrumSmoothingMode === 'perceptual'
      ? smoothSpectrumForDisplay(spectrum.freqDb, spectrum.sampleRate, spectrum.fftSize, smoothingScratchRef)
      : spectrum?.freqDb ?? null

    drawSpectrum(ctx, plotWidth, plotHeight, range, spectrum, displayFreqDb, gradientRef, gradientHeightRef, spectrumLineWidthProp ?? 0.5, peakHoldRef, spectrumWarmMode, canvasThemeRef.current, dtSeconds)
    drawLevelMeter(ctx, plotHeight, range, spectrum, canvasThemeRef.current, dtSeconds)

    // Store padding for pointer event calculations
    paddingRef.current = { left: padding.left, top: padding.top, plotWidth, plotHeight }

    drawFreqRangeOverlay(ctx, plotWidth, plotHeight, range, freqRangeRef.current, canvasThemeRef.current)
    const notchedIds = drawNotchOverlays(ctx, plotWidth, plotHeight, range, advisoriesRef.current, clearedIdsRef.current, canvasThemeRef.current)
    drawMarkers(ctx, plotWidth, plotHeight, range, earlyWarning, advisoriesRef.current, clearedIdsRef.current, peakMarkerRadius, fontSize, canvasThemeRef.current, notchedIds, hoverPosRef.current?.x ?? null)

    // Frozen badge — top-right of plot area
    if (isFrozenRef.current) {
      const theme = canvasThemeRef.current
      const badgeText = 'FROZEN'
      ctx.font = `bold ${fontSize}px monospace`
      const tw = ctx.measureText(badgeText).width
      const bx = plotWidth - tw - 16
      const by = 6
      const px = 6, py = 3

      ctx.fillStyle = theme.frozenBadgeBg
      ctx.beginPath()
      ctx.roundRect(bx - px, by, tw + px * 2, fontSize + py * 2, 3)
      ctx.fill()
      ctx.strokeStyle = theme.frozenBadgeBorder
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = theme.frozenBadgeText
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(badgeText, bx, by + py)
    }

    // Hover tooltip — freq + dB readout, with advisory detail when near a marker
    const hover = hoverPosRef.current
    if (hover && !dragRef.current) {
      const hPos = clamp(hover.x / plotWidth, 0, 1)
      const hoverFreq = logPositionToFreq(hPos, range.freqMin, range.freqMax)
      const hoverDb = range.dbMax - (hover.y / plotHeight) * (range.dbMax - range.dbMin)

      // Find nearest advisory within 100 cents of cursor frequency
      const CENTS_THRESHOLD = 100
      let nearestAdvisory: Advisory | null = null
      let nearestCents = Infinity
      const cleared = clearedIdsRef.current
      for (const a of advisoriesRef.current) {
        if (cleared?.has(a.id) || a.trueFrequencyHz == null) continue
        const cents = Math.abs(1200 * Math.log2(a.trueFrequencyHz / hoverFreq))
        if (cents < CENTS_THRESHOLD && cents < nearestCents) {
          nearestCents = cents
          nearestAdvisory = a
        }
      }

      // Build tooltip lines
      const tipFont = `bold ${fontSize - 1}px monospace`
      ctx.font = tipFont
      const tipPad = 6
      const lineH = fontSize + 2
      const lines: { text: string; color: string }[] = []

      const theme = canvasThemeRef.current
      if (nearestAdvisory) {
        // Advisory-rich tooltip
        const a = nearestAdvisory
        lines.push({ text: formatFrequency(a.trueFrequencyHz), color: theme.tooltipText })
        lines.push({ text: `${a.severity}  ${a.confidence != null ? Math.round(a.confidence * 100) + '%' : ''}`, color: getSeverityColor(a.severity) })
        if (a.advisory?.peq) {
          const peq = a.advisory.peq
          lines.push({ text: `Cut ${peq.gainDb}dB  Q:${peq.q.toFixed(1)}`, color: OVERLAY_ACCENT })
        }
        if (a.velocityDbPerSec != null && a.velocityDbPerSec > 0) {
          lines.push({ text: `+${a.velocityDbPerSec.toFixed(0)} dB/s`, color: GROWING_COLOR })
        }
      } else {
        // Basic freq + dB readout
        lines.push({ text: `${formatFrequency(hoverFreq)}  ${Math.round(hoverDb)} dB`, color: theme.tooltipText })
      }

      const maxLineW = Math.max(...lines.map(l => cachedMeasureText(ctx, l.text).width))
      const tipW = maxLineW + tipPad * 2
      const tipH = lines.length * lineH + tipPad * 2

      // Position tooltip near cursor, flip if near edges
      let tipX = hover.x + 12
      let tipY = hover.y - tipH - 4
      if (tipX + tipW > plotWidth) tipX = hover.x - tipW - 12
      if (tipY < 0) tipY = hover.y + 16

      // Background pill (theme-aware; dark mode uses near-black, light mode uses near-white)
      ctx.fillStyle = nearestAdvisory ? theme.tooltipBgAdvisory : theme.tooltipBg
      ctx.beginPath()
      ctx.roundRect(tipX, tipY, tipW, tipH, 4)
      ctx.fill()

      // Severity accent left edge when showing advisory
      if (nearestAdvisory) {
        ctx.fillStyle = getSeverityColor(nearestAdvisory.severity)
        ctx.fillRect(tipX, tipY + 2, 2, tipH - 4)
      }

      // Text lines
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = lines[i].color
        ctx.fillText(lines[i].text, tipX + tipPad + (nearestAdvisory ? 4 : 0), tipY + tipPad + i * lineH)
      }

      // Crosshair lines (subtle) — theme-aware when no advisory nearby
      ctx.strokeStyle = nearestAdvisory ? `${getSeverityColor(nearestAdvisory.severity)}30` : theme.crosshairIdle
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(hover.x, 0)
      ctx.lineTo(hover.x, plotHeight)
      ctx.moveTo(0, hover.y)
      ctx.lineTo(plotWidth, hover.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()

    drawAxisLabels(ctx, padding, plotWidth, plotHeight, range, fontSize, width, height, canvasThemeRef.current)

  }, [spectrumRef, graphFontSize, earlyWarning, rtaDbMin, rtaDbMax, spectrumLineWidthProp, showThresholdLine, feedbackThresholdDb, showFreqZones, spectrumWarmMode, spectrumSmoothingMode])

  useAnimationFrame(render, isRunning || hasEverStarted, canvasTargetFps)

  // Mark dirty when display props change (triggers redraw on next rAF tick)
  useEffect(() => {
    peakHoldRef.current = null
    dirtyRef.current = true
  }, [spectrumSmoothingMode])
  useEffect(() => {
    dirtyRef.current = true
    if (!hasEverStarted && canvasRef.current) {
      syncIdleCanvas(canvasRef.current)
    }
  }, [graphFontSize, earlyWarning, rtaDbMin, rtaDbMax, spectrumLineWidthProp, showThresholdLine, feedbackThresholdDb, showFreqZones, spectrumWarmMode, hasEverStarted, syncIdleCanvas])
  useEffect(() => { dirtyRef.current = true }, [advisories, clearedIds])

  const isKeyboardInteractive = Boolean(onFreqRangeChange || onThresholdChange)
  const activeAdvisoryCount = advisories.filter(
    (advisory) => advisory.lifecycle !== 'provisional' && !advisory.resolved,
  ).length
  const spectrumStatusDescription = formatSpectrumStatusDescription({
    isRunning,
    minFrequency,
    maxFrequency,
    rtaDbMin,
    rtaDbMax,
    activeAdvisoryCount,
    totalAdvisoryCount: advisories.length,
    isFrozen,
    isKeyboardInteractive,
    canAdjustFrequency: Boolean(onFreqRangeChange),
    canAdjustThreshold: Boolean(onThresholdChange),
  })
  const ariaLabel = onFreqRangeChange
    ? onThresholdChange
      ? 'Frequency range and detection threshold'
      : 'Frequency range'
    : onThresholdChange
      ? 'Detection threshold'
      : undefined
  const ariaValueText = onFreqRangeChange
    ? onThresholdChange && feedbackThresholdDb != null
      ? `${minFrequency} Hz to ${maxFrequency} Hz, threshold ${feedbackThresholdDb} dB`
      : `${minFrequency} Hz to ${maxFrequency} Hz`
    : onThresholdChange && feedbackThresholdDb != null
      ? `${feedbackThresholdDb} dB threshold`
      : undefined
  const ariaValueMin = onFreqRangeChange ? CANVAS_SETTINGS.RTA_FREQ_MIN : onThresholdChange ? rtaDbMin : undefined
  const ariaValueMax = onFreqRangeChange ? CANVAS_SETTINGS.RTA_FREQ_MAX : onThresholdChange ? rtaDbMax : undefined
  const ariaValueNow = onFreqRangeChange ? minFrequency : onThresholdChange ? feedbackThresholdDb : undefined

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
      tabIndex={isKeyboardInteractive ? 0 : undefined}
      role={isKeyboardInteractive ? 'slider' : undefined}
      aria-label={ariaLabel}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      aria-valuetext={ariaValueText}
      onKeyDown={isKeyboardInteractive ? handleKeyDown : undefined}
    >
      <canvas ref={canvasRef} className="w-full h-full" role="img" aria-label="Real-time audio frequency spectrum display" aria-describedby={descId} />
      {/* Screen reader description — summarizes RTA state for assistive technology */}
      <div id={descId} className="sr-only">
        {spectrumStatusDescription}
      </div>
      <SpectrumCanvasOverlay
        showIdleStartOverlay={showIdleStartOverlay}
        isStarting={isStarting}
        error={error}
        isRunning={isRunning}
        onStart={onStart}
      />
      {overlay}
    </div>
  )
})
