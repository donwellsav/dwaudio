'use client'

import { memo, type RefObject } from 'react'
import type { FaderGuidance, FaderMode } from './faderTypes'
import { clampFaderValue, getFaderThumbBottom } from '@/lib/fader/faderMath'
import { DEFAULT_DISPLAY_PREFS } from '@/lib/settings/defaults'

interface FaderTrackProps {
  ariaLabel: string
  autoGainEnabled?: boolean
  canvasRef: RefObject<HTMLCanvasElement | null>
  compactOverlays?: boolean
  displayValue: number
  editing: boolean
  effectiveMax: number
  effectiveMin: number
  guidance?: FaderGuidance
  isSensitivity: boolean
  max: number
  min: number
  mode: FaderMode
  noiseFloorDb?: number | null
  onBeginPointerDrag: (clientY: number) => void
  onKeyStep: (direction: 1 | -1) => void
  onTrackTouchStart?: () => void
  referenceValue?: number
  showReferenceLine?: boolean
  thumbBottom: number
  thumbWidthPx?: number
  trackRef: RefObject<HTMLDivElement | null>
}

export const FaderTrack = memo(function FaderTrack({
  ariaLabel,
  autoGainEnabled = false,
  canvasRef,
  compactOverlays = false,
  displayValue,
  editing,
  effectiveMax,
  effectiveMin,
  guidance,
  isSensitivity,
  max,
  min,
  mode,
  noiseFloorDb,
  onBeginPointerDrag,
  onKeyStep,
  onTrackTouchStart,
  referenceValue,
  showReferenceLine = false,
  thumbBottom,
  thumbWidthPx = 68,
  trackRef,
}: FaderTrackProps) {
  const resolvedReferenceValue = clampFaderValue({
    mode,
    value: referenceValue ?? (isSensitivity ? DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb : DEFAULT_DISPLAY_PREFS.faderLinkCenterGainDb),
    min,
    max,
  })
  const compactThumb = thumbWidthPx < 68
  const showGuidance = guidance != null && guidance.direction !== 'none'
  const arrowColors = guidance?.urgency === 'warning'
    ? ['text-red-500', 'text-red-500/70', 'text-red-500/40']
    : ['text-amber-400/80', 'text-amber-400/50', 'text-amber-400/25']
  const arrowAnim = guidance?.urgency === 'warning'
    ? 'motion-safe:animate-arrow-flash'
    : 'motion-safe:animate-pulse'

  return (
    <div className="relative flex-1 min-h-0 w-full flex flex-col">
      <div
        ref={trackRef}
        className="relative flex-1 rounded-sm cursor-ns-resize overflow-hidden border border-white/[0.04]"
        style={{
          touchAction: 'none',
          boxShadow:
            'inset 0 2px 6px rgba(0,0,0,0.5), inset 0 -1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
        }}
        onMouseDown={(event) => {
          if (editing) return
          onBeginPointerDrag(event.clientY)
        }}
        onTouchStart={(event) => {
          if (editing) return
          const touch = event.touches[0]
          if (!touch) return
          onTrackTouchStart?.()
          onBeginPointerDrag(touch.clientY)
        }}
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={effectiveMin}
        aria-valuemax={effectiveMax}
        aria-valuenow={displayValue}
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault()
            onKeyStep(1)
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault()
            onKeyStep(-1)
          }
        }}
      >
        <div
          className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-[5px] pointer-events-none rounded-full"
          style={{
            background: 'linear-gradient(to right, rgba(0,0,0,0.6), rgba(0,0,0,0.3), rgba(0,0,0,0.6))',
            boxShadow:
              'inset 0 2px 4px rgba(0,0,0,0.8), inset 1px 0 1px rgba(0,0,0,0.4), inset -1px 0 1px rgba(0,0,0,0.4), 0 0 1px rgba(255,255,255,0.05)',
          }}
        />
        <div
          className="absolute inset-y-2 pointer-events-none"
          style={{
            left: 'calc(50% - 5px)',
            width: '1px',
            background:
              'linear-gradient(to bottom, transparent, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.06) 80%, transparent)',
          }}
        />
        <div
          className="absolute inset-y-2 pointer-events-none"
          style={{
            left: 'calc(50% + 5px)',
            width: '1px',
            background:
              'linear-gradient(to bottom, transparent, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.06) 80%, transparent)',
          }}
        />
        {showReferenceLine ? (
          <div
            className="absolute left-0 right-0 h-[2px] pointer-events-none"
            style={{
              bottom: `${getFaderThumbBottom({
                mode,
                value: resolvedReferenceValue,
                min,
                max,
              })}%`,
              background:
                'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.12) 55%, transparent 70%)',
            }}
          />
        ) : null}
        <canvas ref={canvasRef} className="w-full h-full" />
        <div
          className={`absolute left-1/2 -translate-x-1/2 translate-y-1/2 h-7 rounded border-2 pointer-events-none transition-all duration-150 ${
            isSensitivity
              ? 'border-cyan-300/60 bg-gradient-to-b from-blue-700 via-blue-800 to-blue-950'
              : autoGainEnabled
                ? 'border-primary bg-gradient-to-b from-primary/90 via-primary to-primary/80'
                : 'border-white/80 bg-gradient-to-b from-gray-50 via-gray-200 to-gray-400'
          }`}
          style={{
            width: `${thumbWidthPx}px`,
            bottom: `${thumbBottom}%`,
            boxShadow: isSensitivity
              ? '0 3px 10px rgba(0,210,210,0.35), 0 1px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)'
              : autoGainEnabled
                ? '0 3px 10px rgba(75,146,255,0.35), 0 1px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)'
                : '0 3px 10px rgba(255,255,255,0.2), 0 1px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
          aria-hidden="true"
        >
          <div
            className={`absolute inset-x-0 top-0 h-[2px] rounded-t ${
              isSensitivity ? 'bg-cyan-200/15' : autoGainEnabled ? 'bg-white/20' : 'bg-white/50'
            }`}
          />
          <div
            className={`absolute ${compactThumb ? 'inset-x-2' : 'inset-x-2.5'} top-[6px] h-[1.5px] rounded-full ${
              isSensitivity
                ? 'bg-blue-400/30'
                : autoGainEnabled
                  ? 'bg-white/25'
                  : 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.35)]'
            }`}
          />
          <div
            className={`absolute ${compactThumb ? 'inset-x-1.5' : 'inset-x-2'} top-1/2 -translate-y-1/2 h-[2px] rounded-full ${
              isSensitivity
                ? 'bg-cyan-300/50'
                : autoGainEnabled
                  ? 'bg-white/40'
                  : 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.50)]'
            }`}
          />
          <div
            className={`absolute ${compactThumb ? 'inset-x-2' : 'inset-x-2.5'} bottom-[6px] h-[1.5px] rounded-full ${
              isSensitivity
                ? 'bg-blue-400/30'
                : autoGainEnabled
                  ? 'bg-white/25'
                  : 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.35)]'
            }`}
          />
        </div>

        {showGuidance && guidance?.direction === 'up' ? (
          <div
            className="absolute inset-x-0 pointer-events-none flex flex-col items-center gap-1"
            style={{ bottom: `${Math.max(thumbBottom + 8, 15)}%` }}
            aria-hidden="true"
          >
            <span className={`${arrowColors[0]} text-xl font-bold font-mono leading-none ${arrowAnim}`}>^</span>
            <span className={`${arrowColors[1]} text-lg font-mono leading-none`}>^</span>
            <span className={`${arrowColors[2]} text-base font-mono leading-none`}>^</span>
            <span className={`${arrowColors[0]} text-dwa-sm font-mono font-bold leading-tight text-center`}>Missing</span>
            <span className={`${arrowColors[0]} text-dwa-sm font-mono leading-tight text-center opacity-70`}>Boost Up</span>
          </div>
        ) : null}
        {showGuidance && guidance?.direction === 'down' ? (
          <div
            className="absolute inset-x-0 pointer-events-none flex flex-col items-center gap-1"
            style={{ top: `${Math.min(100 - thumbBottom + 8, 85)}%` }}
            aria-hidden="true"
          >
            <span className={`${arrowColors[0]} text-xl font-bold font-mono leading-none ${arrowAnim}`}>v</span>
            <span className={`${arrowColors[1]} text-lg font-mono leading-none`}>v</span>
            <span className={`${arrowColors[2]} text-base font-mono leading-none`}>v</span>
            <span className={`${arrowColors[0]} text-dwa-sm font-mono font-bold leading-tight text-center`}>Noisy</span>
            <span className={`${arrowColors[0]} text-dwa-sm font-mono leading-tight text-center opacity-70`}>Back Off</span>
          </div>
        ) : null}
        {showGuidance ? (
          <span className="sr-only" role="status">
            {guidance?.direction === 'up'
              ? 'Not detecting feedback - increase sensitivity'
              : 'Too many detections - decrease sensitivity'}
          </span>
        ) : null}

        {!isSensitivity && noiseFloorDb != null ? (
          <div className="absolute bottom-0 inset-x-0 flex flex-col items-center pb-1.5 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            <span
              className={`${compactOverlays ? 'text-dwa-xs' : 'text-sm'} font-mono font-semibold leading-none`}
              style={{ color: 'var(--console-green)', opacity: 0.6 }}
            >
              Floor
            </span>
            <span
              className={`${compactOverlays ? 'text-dwa-xs' : 'text-sm'} font-mono font-bold leading-none`}
              style={{ color: 'var(--console-green)', opacity: 0.85 }}
            >
              {noiseFloorDb.toFixed(0)}dB
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
})
