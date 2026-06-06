'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { useWheelStep } from '@/hooks/useWheelStep'

import { cn } from '@/lib/utils'

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const step = (props.step as number) ?? 1
  const _values = React.useMemo(
    () =>
      Array.isArray(value) && value.length > 0
        ? value
        : Array.isArray(defaultValue) && defaultValue.length > 0
          ? defaultValue
          : [min],
    [value, defaultValue, min],
  )
  const firstValue = _values[0]
  const currentValue = Number.isFinite(firstValue) ? firstValue : min
  const sliderRef = React.useRef<HTMLSpanElement>(null)
  useWheelStep(sliderRef, {
    value: currentValue,
    min,
    max,
    step,
    onChange: (v) => {
      if (_values.length === 1) {
        onValueChange?.([v])
      }
    },
  })
  const handleValueChange = React.useCallback((nextValue: number[]) => {
    if (nextValue.length === _values.length && nextValue.every(Number.isFinite)) {
      onValueChange?.(nextValue)
    }
  }, [_values.length, onValueChange])

  return (
    <SliderPrimitive.Root
      ref={sliderRef}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      onValueChange={handleValueChange}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={
          'bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
        }
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={
            'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
          }
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
