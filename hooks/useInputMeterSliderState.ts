'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type TouchEvent,
} from 'react'
import { useWheelStep } from '@/hooks/useWheelStep'
import {
  clampInputMeterValue,
  formatInputMeterValueLabel,
  getInputMeterDisplayValue,
  getInputMeterValueFromClientX,
  stepInputMeterValue,
} from '@/lib/inputMeter/inputMeterMath'

interface UseInputMeterSliderStateParams {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  autoGainEnabled: boolean
  autoGainDb?: number
  onAutoGainToggle?: (enabled: boolean) => void
}

interface UseInputMeterSliderStateResult {
  sliderRef: RefObject<HTMLDivElement | null>
  readoutRef: RefObject<HTMLButtonElement | null>
  editing: boolean
  displayValue: number
  valueLabel: string
  handleToggleAutoGain?: () => void
  handleReadoutClick: () => void
  handleTrackMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  handleTrackTouchStart: (event: TouchEvent<HTMLDivElement>) => void
  handleTrackKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  handleEditBlur: (event: FocusEvent<HTMLInputElement>) => void
  handleEditKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

export function useInputMeterSliderState({
  value,
  onChange,
  min,
  max,
  autoGainEnabled,
  autoGainDb,
  onAutoGainToggle,
}: UseInputMeterSliderStateParams): UseInputMeterSliderStateResult {
  const sliderRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLButtonElement>(null)
  const updateValueFromXRef = useRef<(clientX: number) => void>(() => {})
  const isDraggingRef = useRef(false)
  const pendingValueRef = useRef<number | null>(null)
  const rafCoalesceRef = useRef(0)
  const [editing, setEditing] = useState(false)
  const displayValue = getInputMeterDisplayValue(value, autoGainEnabled, autoGainDb)
  const valueLabel = formatInputMeterValueLabel(displayValue)

  useWheelStep(sliderRef, { value, min, max, step: 1, onChange })
  useWheelStep(readoutRef, { value, min, max, step: 1, onChange })

  const disableAutoGain = useCallback(() => {
    if (autoGainEnabled && onAutoGainToggle) {
      onAutoGainToggle(false)
    }
  }, [autoGainEnabled, onAutoGainToggle])

  const commitEdit = useCallback((raw: string) => {
    const trimmed = raw.trim()
    const parsed = Number(trimmed)
    if (trimmed !== '' && Number.isFinite(parsed)) {
      disableAutoGain()
      onChange(clampInputMeterValue(parsed, min, max))
    }
    setEditing(false)
  }, [disableAutoGain, max, min, onChange])

  const handleToggleAutoGain = onAutoGainToggle
    ? () => onAutoGainToggle(!autoGainEnabled)
    : undefined

  const updateValueFromX = useCallback((clientX: number) => {
    const slider = sliderRef.current
    if (!slider) return

    const rect = slider.getBoundingClientRect()
    disableAutoGain()
    pendingValueRef.current = getInputMeterValueFromClientX({
      clientX,
      sliderLeft: rect.left,
      sliderWidth: rect.width,
      min,
      max,
    })

    if (!rafCoalesceRef.current) {
      rafCoalesceRef.current = requestAnimationFrame(() => {
        rafCoalesceRef.current = 0
        if (pendingValueRef.current !== null) {
          onChange(pendingValueRef.current)
          pendingValueRef.current = null
        }
      })
    }
  }, [disableAutoGain, max, min, onChange])

  useEffect(() => {
    updateValueFromXRef.current = updateValueFromX
  }, [updateValueFromX])

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isDraggingRef.current) return
      updateValueFromXRef.current(event.clientX)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
    }

    const handleTouchMove = (event: globalThis.TouchEvent) => {
      if (!isDraggingRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      updateValueFromXRef.current(touch.clientX)
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      if (rafCoalesceRef.current) {
        cancelAnimationFrame(rafCoalesceRef.current)
      }
    }
  }, [])

  const handleTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (editing) return
    isDraggingRef.current = true
    updateValueFromXRef.current(event.clientX)
  }, [editing])

  const handleTrackTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (editing) return
    const touch = event.touches[0]
    if (!touch) return
    isDraggingRef.current = true
    updateValueFromXRef.current(touch.clientX)
  }, [editing])

  const handleTrackKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      disableAutoGain()
      onChange(stepInputMeterValue(value, 1, min, max))
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      disableAutoGain()
      onChange(stepInputMeterValue(value, -1, min, max))
    }
  }, [disableAutoGain, max, min, onChange, value])

  const handleEditBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    commitEdit(event.target.value)
  }, [commitEdit])

  const handleEditKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitEdit(event.currentTarget.value)
    }

    if (event.key === 'Escape') {
      setEditing(false)
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onChange(stepInputMeterValue(value, 1, min, max))
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(stepInputMeterValue(value, -1, min, max))
    }
  }, [commitEdit, max, min, onChange, value])

  return {
    sliderRef,
    readoutRef,
    editing,
    displayValue,
    valueLabel,
    handleToggleAutoGain,
    handleReadoutClick: () => setEditing(true),
    handleTrackMouseDown,
    handleTrackTouchStart,
    handleTrackKeyDown,
    handleEditBlur,
    handleEditKeyDown,
  }
}
