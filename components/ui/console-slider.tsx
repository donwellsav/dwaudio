'use client'

import { memo, useState, useCallback, useRef } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { useWheelStep } from '@/hooks/useWheelStep'
import { ResetDefault } from '@/components/ui/reset-default'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Color config ─────────────────────────────────────────────────────────────

type SliderColor = 'amber' | 'blue' | 'green'

const COLOR_CONFIG: Record<SliderColor, {
  rangeGradient: string
  rangeGlow: string
  thumbBorder: string
  thumbGlow: string
  text: string
}> = {
  amber: {
    rangeGradient: 'linear-gradient(90deg, rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.30), rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.70))',
    rangeGlow: '0 0 6px var(--console-amber-glow)',
    thumbBorder: 'var(--console-amber)',
    thumbGlow: '0 0 8px var(--console-amber-glow), 0 0 2px var(--console-amber-glow)',
    text: 'var(--console-amber)',
  },
  blue: {
    rangeGradient: 'linear-gradient(90deg, rgba(75,146,255,0.28), rgba(75,146,255,0.65))',
    rangeGlow: '0 0 6px var(--console-blue-glow)',
    thumbBorder: 'var(--console-blue)',
    thumbGlow: '0 0 8px var(--console-blue-glow), 0 0 2px var(--console-blue-glow)',
    text: 'var(--console-blue)',
  },
  green: {
    rangeGradient: 'linear-gradient(90deg, rgba(74,222,128,0.22), rgba(74,222,128,0.55))',
    rangeGlow: '0 0 6px var(--console-green-glow)',
    thumbBorder: 'var(--console-green)',
    thumbGlow: '0 0 8px var(--console-green-glow), 0 0 2px var(--console-green-glow)',
    text: 'var(--console-green)',
  },
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ConsoleSliderProps {
  label: string
  /** Formatted display value (e.g. "25 dB", "35%") */
  value: string
  /** Tooltip help text */
  tooltip?: string
  /** Whether to show tooltip (requires tooltip prop) */
  showTooltip?: boolean
  /** Numeric slider value */
  sliderValue: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /**
   * Operator color group.
   * amber = detection controls (sensitivity, thresholds, algorithms)
   * blue  = scope controls (frequency range, timing, FFT)
   * cyan  = system controls (auto-gain, noise floor, track management)
   * Default: amber
   */
  color?: SliderColor
  className?: string
  /** When provided, shows a reset icon when value differs from default */
  defaultValue?: number
  /** Operator-facing reset/default label when the slider value is transformed */
  defaultLabel?: string
  /** Optional custom reset behavior for mode-derived defaults */
  onResetToDefault?: () => void
}

/**
 * Pro-audio console-style slider with recessed track, color-coded fill,
 * knob thumb with glow ring, monospace LED value readout, and click-to-edit.
 *
 * Click the value readout to type a number directly. Scroll the slider
 * track (after clicking to focus) to step ±1. Hold Shift for fine-step.
 */
export const ConsoleSlider = memo(function ConsoleSlider({
  label,
  value,
  tooltip,
  showTooltip = true,
  sliderValue,
  min,
  max,
  step,
  onChange,
  color = 'amber',
  className,
  defaultValue,
  defaultLabel,
  onResetToDefault,
}: ConsoleSliderProps) {
  const c = COLOR_CONFIG[color]
  const [isDragging, setIsDragging] = useState(false)
  const handlePointerDown = useCallback(() => setIsDragging(true), [])
  const handlePointerUp = useCallback(() => setIsDragging(false), [])
  const sliderRef = useRef<HTMLSpanElement>(null)
  useWheelStep(sliderRef, { value: sliderValue, min, max, step, onChange })

  // Click-to-edit state for the value readout
  const [editing, setEditing] = useState(false)
  const commitEdit = useCallback((raw: string) => {
    const parsed = parseFloat(raw.replace(',', '.'))
    if (!isNaN(parsed)) {
      // Round to step precision and clamp
      const rounded = Math.round(parsed / step) * step
      onChange(Math.min(max, Math.max(min, rounded)))
    }
    setEditing(false)
  }, [min, max, step, onChange])

  return (
      <div className={cn('space-y-0.5', className)}>
        {/* Header: label + value readout (click to edit) */}
        <div className="flex min-h-4 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <span className="section-label" style={{ color: c.text }}>{label}</span>
            {defaultValue != null && (
              <ResetDefault
                current={sliderValue}
                defaultValue={defaultValue}
                onReset={onResetToDefault ?? (() => onChange(defaultValue))}
                tolerance={step / 2}
                label={defaultLabel}
              />
            )}
            {tooltip && showTooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 text-muted-foreground/70 hover:text-muted-foreground cursor-help flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[260px] text-sm">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {editing ? (
            <input
              autoFocus
              type="text"
              defaultValue={String(sliderValue)}
              aria-label={`${label} value`}
              className="console-readout bg-input border border-primary rounded px-1 text-right w-14 focus-visible:outline-none"
              style={{ color: c.text }}
              onBlur={(e) => commitEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="console-readout shrink-0 cursor-text hover:opacity-80 transition-opacity"
              style={{ color: c.text, textShadow: `0 0 8px ${c.thumbBorder}40` }}
              title="Click to type a value"
              aria-label={`${label}: ${value}. Click to edit.`}
            >
              {value}
            </button>
          )}
        </div>

        {/* Slider track */}
        <SliderPrimitive.Root
          ref={sliderRef}
          aria-label={label}
          value={[sliderValue]}
          onValueChange={([v]) => onChange(v)}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          min={min}
          max={max}
          step={step}
          className="relative flex h-4 w-full touch-none items-center select-none"
        >
          <SliderPrimitive.Track
            className="relative h-1.5 grow overflow-hidden rounded-full panel-recessed"
            style={{ background: 'var(--card)' }}
          >
            <SliderPrimitive.Range
              className="absolute h-full"
              style={{ background: c.rangeGradient, boxShadow: c.rangeGlow }}
            />
          </SliderPrimitive.Track>
          <Tooltip open={isDragging}>
            <TooltipTrigger asChild>
              <SliderPrimitive.Thumb
                aria-label={label}
                className="console-thumb block shrink-0 rounded-full motion-safe:transition-[box-shadow,transform] motion-safe:duration-100 focus-visible:outline-hidden cursor-grab active:cursor-grabbing"
                style={{
                  width: 16, height: 16,
                  borderColor: c.thumbBorder,
                  boxShadow: c.thumbGlow,
                }}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs font-mono py-0.5 px-1.5" style={{ color: c.text }}>
              {value}
            </TooltipContent>
          </Tooltip>
        </SliderPrimitive.Root>
      </div>
  )
})
