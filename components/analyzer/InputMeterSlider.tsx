'use client'

import { memo } from 'react'
import { useInputMeterCanvas } from '@/hooks/useInputMeterCanvas'
import { useInputMeterSliderState } from '@/hooks/useInputMeterSliderState'

interface InputMeterSliderProps {
  value: number
  onChange: (value: number) => void
  level: number
  min?: number
  max?: number
  fullWidth?: boolean
  compact?: boolean
  autoGainEnabled?: boolean
  autoGainDb?: number
  autoGainLocked?: boolean
  onAutoGainToggle?: (enabled: boolean) => void
}

export const InputMeterSlider = memo(function InputMeterSlider({
  value,
  onChange,
  level,
  min = -40,
  max = 40,
  fullWidth = false,
  compact = false,
  autoGainEnabled = false,
  autoGainDb,
  autoGainLocked = false,
  onAutoGainToggle,
}: InputMeterSliderProps) {
  const {
    sliderRef,
    readoutRef,
    editing,
    displayValue,
    valueLabel,
    handleToggleAutoGain,
    handleReadoutClick,
    handleTrackMouseDown,
    handleTrackTouchStart,
    handleTrackKeyDown,
    handleEditBlur,
    handleEditKeyDown,
  } = useInputMeterSliderState({
    value,
    onChange,
    min,
    max,
    autoGainEnabled,
    autoGainDb,
    onAutoGainToggle,
  })
  const { canvasRef } = useInputMeterCanvas({
    level,
    min,
    max,
    sliderRef,
  })

  const autoGainButtonClassName = autoGainEnabled
    ? autoGainLocked
      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
      : 'bg-amber-500/20 text-amber-400 border border-amber-500/40 motion-safe:animate-pulse'
    : 'bg-muted/40 text-muted-foreground border border-border hover:text-foreground'

  const autoGainTitle = autoGainEnabled
    ? autoGainLocked
      ? `Gain locked at ${autoGainDb ?? 0}dB - click for manual`
      : 'Calibrating auto-gain... click for manual'
    : 'Manual gain - click for auto'

  const autoGainLabel = autoGainEnabled
    ? autoGainLocked
      ? 'Auto gain locked, switch to manual gain'
      : 'Auto gain calibrating, switch to manual gain'
    : 'Switch to auto gain'

  const readoutClassName = autoGainEnabled
    ? 'text-[var(--console-green)] hover:text-[var(--console-green)]/80'
    : 'text-[var(--console-amber)] hover:text-[var(--console-amber)]/80'

  const readoutTitle = autoGainEnabled
    ? autoGainLocked
      ? 'Gain locked - click to edit (switches to manual)'
      : 'Calibrating - click to edit (switches to manual)'
    : 'Click to type, scroll to step +/-1dB'

  const readoutLabel = `Input gain ${valueLabel}${autoGainEnabled ? (autoGainLocked ? ' (locked)' : ' (calibrating)') : ''}, click to edit`

  return (
    <div className={`flex items-center gap-2 ${fullWidth ? 'w-full' : ''}`}>
      {handleToggleAutoGain ? (
        <button
          onClick={handleToggleAutoGain}
          className={`min-h-7 md:min-h-6 flex-shrink-0 px-1.5 py-0.5 rounded text-sm font-bold uppercase tracking-wider transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${autoGainButtonClassName}`}
          title={autoGainTitle}
          aria-label={autoGainLabel}
        >
          {autoGainEnabled ? (autoGainLocked ? 'Locked' : 'Auto') : 'Manual'}
        </button>
      ) : null}

      <div className="relative flex-1 flex flex-col">
        <div
          ref={sliderRef}
          className={`relative rounded cursor-ew-resize overflow-hidden w-full ${compact ? 'h-4' : 'h-5'}`}
          style={{ touchAction: 'none' }}
          onMouseDown={handleTrackMouseDown}
          onTouchStart={handleTrackTouchStart}
          onKeyDown={handleTrackKeyDown}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={displayValue}
          aria-label="Input gain"
          tabIndex={0}
        >
          <canvas ref={canvasRef} className="w-full h-full" />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-7 rounded-full border-2 shadow-md ring-offset-background transition-[box-shadow] hover:ring-4 hover:ring-ring/50 focus-visible:ring-4 focus-visible:ring-ring/50 pointer-events-none ${
              autoGainEnabled
                ? 'border-primary bg-primary/90'
                : 'border-background bg-white'
            }`}
            style={{ left: `${((displayValue - min) / (max - min)) * 100}%` }}
            aria-hidden="true"
          />
        </div>
        {!compact ? (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 pointer-events-none">
            <span className="text-sm text-muted-foreground font-mono leading-none">
              0
            </span>
          </div>
        ) : null}
      </div>

      {editing ? (
        <input
          autoFocus
          type="text"
          aria-label={`Edit input gain, currently ${displayValue} dB`}
          defaultValue={String(displayValue)}
          className={`font-mono bg-input border border-primary rounded px-1 text-center text-foreground focus-visible:outline-none flex-shrink-0 ${compact ? 'text-xs w-9 h-4' : 'text-sm w-12 h-5'}`}
          onBlur={handleEditBlur}
          onKeyDown={handleEditKeyDown}
        />
      ) : (
        <button
          ref={readoutRef}
          className={`font-mono text-right transition-colors cursor-text flex-shrink-0 tabular-nums ${compact ? 'text-xs w-9' : 'text-sm w-12'} ${readoutClassName}`}
          onClick={handleReadoutClick}
          title={readoutTitle}
          aria-label={readoutLabel}
        >
          {valueLabel}
        </button>
      )}
    </div>
  )
})
