'use client'

import { useCallback, memo, useRef } from 'react'
import { FaderTrack } from './FaderTrack'
import { useWheelStep } from '@/hooks/useWheelStep'
import { useFaderControlState } from '@/hooks/useFaderControlState'
import { useFaderMeterCanvas } from '@/hooks/useFaderMeterCanvas'
import { clampFaderValue } from '@/lib/fader/faderMath'
import { DEFAULT_DISPLAY_PREFS } from '@/lib/settings/defaults'
import type { FaderGuidance, FaderMode } from './faderTypes'

export type { FaderGuidance } from './faderTypes'

export interface SingleFaderProps {
  mode: FaderMode
  value: number
  onChange: (db: number) => void
  level?: number
  min: number
  max: number
  label: string
  autoGainEnabled?: boolean
  autoGainDb?: number
  autoGainLocked?: boolean
  onAutoGainToggle?: (enabled: boolean) => void
  noiseFloorDb?: number | null
  guidance?: FaderGuidance
  width?: number
  homeValue?: number
}

export const SingleFader = memo(function SingleFader({
  mode,
  value,
  onChange,
  level = -60,
  min,
  max,
  label,
  autoGainEnabled = false,
  autoGainDb,
  autoGainLocked = false,
  onAutoGainToggle,
  noiseFloorDb,
  guidance,
  width = 64,
  homeValue: homeValueProp,
}: SingleFaderProps) {
  const { canvasRef, trackRef } = useFaderMeterCanvas({
    mode,
    min,
    max,
    level,
    showSensitivityZones: true,
  })
  const lastTapRef = useRef(0)
  const thumbWidth = Math.round(width * 0.844)
  const {
    readoutRef,
    editing,
    setEditing,
    isSensitivity,
    displayValue,
    effectiveMin,
    effectiveMax,
    thumbBottom,
    valueLabel,
    beginPointerDrag,
    handleKeyStep,
    commitEdit,
  } = useFaderControlState({
    mode,
    value,
    onChange,
    min,
    max,
    trackRef,
    autoGainEnabled,
    autoGainDb,
    onAutoGainToggle,
  })
  const homeValue = clampFaderValue({
    mode,
    value: homeValueProp ?? (isSensitivity ? DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb : DEFAULT_DISPLAY_PREFS.faderLinkCenterGainDb),
    min,
    max,
  })

  useWheelStep(trackRef, {
    value,
    min: effectiveMin,
    max: effectiveMax,
    step: 1,
    onChange,
    inverted: isSensitivity,
  })
  useWheelStep(readoutRef, {
    value,
    min: effectiveMin,
    max: effectiveMax,
    step: 1,
    onChange,
    inverted: isSensitivity,
  })

  const handleDoubleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      if (!isSensitivity && autoGainEnabled && onAutoGainToggle) {
        onAutoGainToggle(false)
      }
      onChange(homeValue)
      lastTapRef.current = 0
      return
    }

    lastTapRef.current = now
  }, [autoGainEnabled, homeValue, isSensitivity, onAutoGainToggle, onChange])

  return (
    <div className="flex flex-col h-full items-center gap-1" style={{ width }}>
      {editing ? (
        <input
          autoFocus
          type="text"
          aria-label={`Edit ${isSensitivity ? 'detection sensitivity' : 'input gain'}, currently ${displayValue} dB`}
          defaultValue={String(displayValue)}
          className="font-mono bg-input border border-primary rounded px-0.5 text-center text-foreground focus-visible:outline-none text-xs w-10 h-5 flex-shrink-0"
          onBlur={(event) => commitEdit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitEdit((event.target as HTMLInputElement).value)
            if (event.key === 'Escape') setEditing(false)
            if (event.key === 'ArrowUp') { event.preventDefault(); handleKeyStep(1) }
            if (event.key === 'ArrowDown') { event.preventDefault(); handleKeyStep(-1) }
          }}
        />
      ) : (
        <button
          ref={readoutRef}
          className={`fader-readout w-full overflow-hidden whitespace-nowrap px-0.5 font-mono text-center transition-colors cursor-text flex-shrink-0 tabular-nums text-sm font-bold leading-tight ${
            isSensitivity
              ? 'text-blue-400 hover:text-blue-300'
              : 'text-[var(--console-amber)] hover:text-[var(--console-amber)]/80'
          }`}
          onClick={() => setEditing(true)}
          title={
            isSensitivity
              ? `Sensitivity: ${value}dB threshold - click to type`
              : autoGainEnabled
                ? autoGainLocked
                  ? 'Gain locked - click to edit'
                  : 'Calibrating - click to edit'
                : 'Click to type, scroll +/-1dB'
          }
          aria-label={
            isSensitivity
              ? `Sensitivity ${value}dB, click to edit`
              : `Input gain ${valueLabel}dB, click to edit`
          }
        >
          {valueLabel}
          <span className="text-dwa-xs font-normal opacity-50 ml-px">dB</span>
        </button>
      )}

      <div className="relative flex-1 min-h-0 w-full flex flex-col">
        <FaderTrack
          ariaLabel={isSensitivity ? 'Detection sensitivity' : 'Input gain'}
          autoGainEnabled={autoGainEnabled}
          canvasRef={canvasRef}
          compactOverlays
          displayValue={displayValue}
          editing={editing}
          effectiveMax={effectiveMax}
          effectiveMin={effectiveMin}
          guidance={guidance}
          isSensitivity={isSensitivity}
          max={max}
          min={min}
          mode={mode}
          noiseFloorDb={noiseFloorDb}
          onBeginPointerDrag={beginPointerDrag}
          onKeyStep={handleKeyStep}
          onTrackTouchStart={handleDoubleTap}
          referenceValue={homeValue}
          showReferenceLine
          thumbBottom={thumbBottom}
          thumbWidthPx={thumbWidth}
          trackRef={trackRef}
        />
      </div>

      <span className={`text-dwa-sm font-bold uppercase tracking-wider flex-shrink-0 ${
        isSensitivity ? 'text-blue-400' : 'text-[var(--console-amber)]'
      }`}>
        {label}
      </span>
    </div>
  )
})
