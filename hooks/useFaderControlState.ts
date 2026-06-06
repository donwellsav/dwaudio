'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { FaderMode } from '@/components/analyzer/faderTypes'
import {
  clampFaderValue,
  getFaderBounds,
  getFaderThumbBottom,
  getFaderValueFromClientY,
  stepFaderValue,
} from '@/lib/fader/faderMath'

interface UseFaderControlStateParams {
  mode: FaderMode
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  trackRef: RefObject<HTMLDivElement | null>
  autoGainEnabled?: boolean
  autoGainDb?: number
  onAutoGainToggle?: (enabled: boolean) => void
}

export function useFaderControlState({
  mode,
  value,
  onChange,
  min,
  max,
  trackRef,
  autoGainEnabled = false,
  autoGainDb,
  onAutoGainToggle,
}: UseFaderControlStateParams) {
  const readoutRef = useRef<HTMLButtonElement>(null)
  const isDraggingRef = useRef(false)
  const pendingValueRef = useRef<number | null>(null)
  const rafCoalesceRef = useRef(0)
  const updateValueFromYRef = useRef<(clientY: number) => void>(() => {})
  const [editing, setEditing] = useState(false)

  const isSensitivity = mode === 'sensitivity'
  const displayValue = isSensitivity ? value : autoGainEnabled && autoGainDb != null ? autoGainDb : value
  const { min: effectiveMin, max: effectiveMax } = getFaderBounds({ mode, min, max })
  const thumbBottom = getFaderThumbBottom({
    mode,
    value: displayValue,
    min,
    max,
  })

  const disableAutoGain = useCallback(() => {
    if (!isSensitivity && autoGainEnabled && onAutoGainToggle) {
      onAutoGainToggle(false)
    }
  }, [autoGainEnabled, isSensitivity, onAutoGainToggle])

  const updateValueFromY = useCallback((clientY: number) => {
    const track = trackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    pendingValueRef.current = getFaderValueFromClientY({
      mode,
      clientY,
      trackTop: rect.top,
      trackHeight: rect.height,
      min,
      max,
    })

    disableAutoGain()

    if (!rafCoalesceRef.current) {
      rafCoalesceRef.current = requestAnimationFrame(() => {
        rafCoalesceRef.current = 0
        if (pendingValueRef.current === null) return
        onChange(pendingValueRef.current)
        pendingValueRef.current = null
      })
    }
  }, [disableAutoGain, max, min, mode, onChange, trackRef])

  useEffect(() => {
    updateValueFromYRef.current = updateValueFromY
  }, [updateValueFromY])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return
      updateValueFromYRef.current(event.clientY)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!isDraggingRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      updateValueFromYRef.current(touch.clientY)
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

  const beginPointerDrag = useCallback((clientY: number) => {
    if (editing) return
    isDraggingRef.current = true
    updateValueFromYRef.current(clientY)
  }, [editing])

  const handleKeyStep = useCallback((direction: 1 | -1) => {
    disableAutoGain()
    onChange(stepFaderValue({
      mode,
      value,
      direction,
      min,
      max,
    }))
  }, [disableAutoGain, max, min, mode, onChange, value])

  const commitEdit = useCallback((raw: string) => {
    const trimmed = raw.trim()
    const parsed = Number(trimmed)

    if (trimmed !== '' && Number.isFinite(parsed)) {
      disableAutoGain()
      onChange(clampFaderValue({
        mode,
        value: parsed,
        min,
        max,
      }))
    }

    setEditing(false)
  }, [disableAutoGain, max, min, mode, onChange])

  const valueLabel = isSensitivity ? `${value}` : `${displayValue > 0 ? '+' : ''}${displayValue}`

  return {
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
  }
}
