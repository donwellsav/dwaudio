'use client'

import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useTheme } from 'next-themes'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { GEQBarEmptyState } from './GEQBarEmptyState'
import { GEQBarTooltip } from './GEQBarTooltip'
import {
  createGEQCanvasMetrics,
  drawGEQBarView,
} from '@/lib/canvas/geqBarViewDrawing'
import type { Advisory } from '@/types/advisory'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'
import { useGEQBarViewState } from '@/hooks/useGEQBarViewState'

interface GEQBarViewProps {
  advisories: Advisory[]
  graphFontSize?: number
  clearedIds?: Set<string>
  isRunning?: boolean
  isLowSignal?: boolean
  spectrumStatus?: SpectrumStatus | null
}

export const GEQBarView = memo(function GEQBarView({
  advisories,
  graphFontSize = 11,
  clearedIds,
  isRunning = false,
  isLowSignal = false,
  spectrumStatus,
}: GEQBarViewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dimensionsRef = useRef({ width: 0, height: 0 })
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const dirtyRef = useRef(true)
  const [containerWidth, setContainerWidth] = useState(300)

  const {
    bandRecommendations,
    hasRecommendations,
    geqAriaLabel,
    hoverLabel,
    hoverPos,
    hoverRec,
    layoutRef,
    handleMouseMove,
    handleMouseLeave,
  } = useGEQBarViewState({
    advisories,
    clearedIds,
    isDark,
    containerRef,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        dimensionsRef.current = { width, height }
        setContainerWidth(width)

        const dpr = window.devicePixelRatio || 1
        dprRef.current = dpr
        ctxRef.current = null
        dirtyRef.current = true

        const canvas = canvasRef.current
        if (!canvas) {
          continue
        }

        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const render = useCallback(() => {
    if (!dirtyRef.current) {
      return
    }
    dirtyRef.current = false

    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d')
    }
    const ctx = ctxRef.current
    if (!ctx) {
      return
    }

    const dpr = dprRef.current
    const { width, height } = dimensionsRef.current
    if (width === 0 || height === 0) {
      return
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const metrics = createGEQCanvasMetrics(width, height, graphFontSize)
    layoutRef.current = {
      paddingLeft: metrics.padding.left,
      barSpacing: metrics.barSpacing,
      numBands: metrics.numBands,
    }

    drawGEQBarView(ctx, metrics, bandRecommendations, isDark)
  }, [bandRecommendations, graphFontSize, isDark, layoutRef])

  useAnimationFrame(render)

  useEffect(() => {
    dirtyRef.current = true
  }, [bandRecommendations, graphFontSize, isDark])

  const onContainerMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    handleMouseMove(event.clientX, event.clientY)
  }, [handleMouseMove])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onMouseMove={onContainerMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring rounded-sm"
        tabIndex={0}
        role="img"
        aria-label={geqAriaLabel}
      />

      {hoverRec && hoverLabel && (
        <GEQBarTooltip
          hoverRec={hoverRec}
          hoverLabel={hoverLabel}
          hoverPos={hoverPos}
          containerWidth={containerWidth}
        />
      )}

      {!hasRecommendations && (
        <GEQBarEmptyState
          isRunning={isRunning}
          isLowSignal={isLowSignal}
          spectrumStatus={spectrumStatus}
        />
      )}
    </div>
  )
})
