'use client'

import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react'
import { CANVAS_SETTINGS } from '@/lib/dsp/constants'
import { getSensitivityGraphDragValue } from '@/lib/fader/faderMath'
import { thresholdDraggedStorage } from '@/lib/storage/dwaStorage'
import { clamp, freqToLogPosition, logPositionToFreq, roundFreqToNice } from '@/lib/utils/mathHelpers'

type DragTarget = 'min' | 'max' | null

export interface SpectrumCanvasPadding {
  left: number
  top: number
  plotWidth: number
  plotHeight: number
}

interface Point {
  x: number
  y: number
}

interface RangeState {
  min: number
  max: number
}

interface ClientRectLike {
  left: number
  top: number
}

interface UseSpectrumCanvasInteractionsParams {
  canvasRef: RefObject<HTMLCanvasElement | null>
  onFreqRangeChange?: (min: number, max: number) => void
  onThresholdChange?: (db: number) => void
  dragRef: MutableRefObject<DragTarget>
  threshDragRef: MutableRefObject<{ active: boolean; startY: number; startDb: number }>
  showDragHintRef: MutableRefObject<boolean>
  paddingRef: MutableRefObject<SpectrumCanvasPadding>
  freqRangeRef: MutableRefObject<RangeState>
  onFreqRangeChangeRef: MutableRefObject<((min: number, max: number) => void) | undefined>
  onThresholdChangeRef: MutableRefObject<((db: number) => void) | undefined>
  feedbackThresholdDbRef: MutableRefObject<number>
  effectiveThreshYRef: MutableRefObject<number | null>
  hoverPosRef: MutableRefObject<Point | null>
  dirtyRef: MutableRefObject<boolean>
}

const GRAB_THRESHOLD_PX = 22
const RANGE_KEYBOARD_STEP_HZ = 50

function getRangeLineDistances(
  clientX: number,
  rect: ClientRectLike,
  padding: SpectrumCanvasPadding,
  range: RangeState,
): { minDist: number; maxDist: number } {
  const canvasX = clientX - rect.left - padding.left
  const minX = freqToLogPosition(range.min, CANVAS_SETTINGS.RTA_FREQ_MIN, CANVAS_SETTINGS.RTA_FREQ_MAX) * padding.plotWidth
  const maxX = freqToLogPosition(range.max, CANVAS_SETTINGS.RTA_FREQ_MIN, CANVAS_SETTINGS.RTA_FREQ_MAX) * padding.plotWidth

  return {
    minDist: Math.abs(canvasX - minX),
    maxDist: Math.abs(canvasX - maxX),
  }
}

function clientXToFreq(clientX: number, rect: ClientRectLike, padding: SpectrumCanvasPadding): number {
  const canvasX = clientX - rect.left - padding.left
  const position = clamp(canvasX / padding.plotWidth, 0, 1)
  return roundFreqToNice(
    logPositionToFreq(position, CANVAS_SETTINGS.RTA_FREQ_MIN, CANVAS_SETTINGS.RTA_FREQ_MAX),
  )
}

export function getThresholdDistance(
  clientY: number,
  rect: ClientRectLike,
  paddingTop: number,
  effectiveThreshY: number | null,
): number {
  if (effectiveThreshY == null) return Infinity
  const canvasY = clientY - rect.top - paddingTop
  return Math.abs(canvasY - effectiveThreshY)
}

export function getHoverCanvasPoint(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  padding: SpectrumCanvasPadding,
): Point | null {
  const x = clientX - rect.left - padding.left
  const y = clientY - rect.top - padding.top

  if (x < 0 || x > padding.plotWidth || y < 0 || y > padding.plotHeight) {
    return null
  }

  return { x, y }
}

export function adjustRangeWithKeyboard(
  range: RangeState,
  key: string,
  shiftKey: boolean,
  step = RANGE_KEYBOARD_STEP_HZ,
): RangeState | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null

  const delta = key === 'ArrowRight' ? step : -step

  if (shiftKey) {
    return {
      min: range.min,
      max: clamp(range.max + delta, range.min + step, CANVAS_SETTINGS.RTA_FREQ_MAX),
    }
  }

  return {
    min: clamp(range.min + delta, CANVAS_SETTINGS.RTA_FREQ_MIN, range.max - step),
    max: range.max,
  }
}

const THRESHOLD_MIN_DB = 2
const THRESHOLD_MAX_DB = 50
const THRESHOLD_KEYBOARD_STEP_DB = 1
const THRESHOLD_KEYBOARD_STEP_SHIFT_DB = 5

export function adjustThresholdWithKeyboard(
  currentDb: number,
  key: string,
  shiftKey: boolean,
): number | null {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null

  const step = shiftKey ? THRESHOLD_KEYBOARD_STEP_SHIFT_DB : THRESHOLD_KEYBOARD_STEP_DB
  const delta = key === 'ArrowUp' ? step : -step
  return clamp(currentDb + delta, THRESHOLD_MIN_DB, THRESHOLD_MAX_DB)
}

export function useSpectrumCanvasInteractions({
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
}: UseSpectrumCanvasInteractionsParams) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasElement: HTMLCanvasElement = canvas

    const hasFreqDrag = !!onFreqRangeChange

    function onPointerDown(event: PointerEvent) {
      const rect = canvasElement.getBoundingClientRect()
      const thresholdDistance = getThresholdDistance(
        event.clientY,
        rect,
        paddingRef.current.top,
        effectiveThreshYRef.current,
      )

      if (thresholdDistance <= GRAB_THRESHOLD_PX && onThresholdChangeRef.current) {
        event.preventDefault()
        threshDragRef.current = {
          active: true,
          startY: event.clientY - rect.top - paddingRef.current.top,
          startDb: feedbackThresholdDbRef.current,
        }

        if (showDragHintRef.current) {
          showDragHintRef.current = false
          thresholdDraggedStorage.set()
        }

        canvasElement.setPointerCapture(event.pointerId)
        canvasElement.style.cursor = 'ns-resize'
        return
      }

      if (!hasFreqDrag) return

      const { minDist, maxDist } = getRangeLineDistances(
        event.clientX,
        rect,
        paddingRef.current,
        freqRangeRef.current,
      )
      const closest = minDist <= maxDist ? 'min' : 'max'
      const distance = Math.min(minDist, maxDist)

      if (distance > GRAB_THRESHOLD_PX) return

      event.preventDefault()
      dragRef.current = closest
      canvasElement.setPointerCapture(event.pointerId)
      canvasElement.style.cursor = 'ew-resize'
    }

    function onPointerMove(event: PointerEvent) {
      // One rect read per event — shared across threshold drag, range drag, and idle hover branches.
      const rect = canvasElement.getBoundingClientRect()

      if (threshDragRef.current.active) {
        const currentY = event.clientY - rect.top - paddingRef.current.top
        const newDb = getSensitivityGraphDragValue({
          startValue: threshDragRef.current.startDb,
          startY: threshDragRef.current.startY,
          currentY,
          plotHeight: paddingRef.current.plotHeight,
        })
        onThresholdChangeRef.current?.(newDb)
        dirtyRef.current = true
        return
      }

      if (dragRef.current) {
        const hz = clientXToFreq(event.clientX, rect, paddingRef.current)
        const range = freqRangeRef.current
        dirtyRef.current = true

        if (dragRef.current === 'min') {
          const newMin = Math.min(hz, range.max - RANGE_KEYBOARD_STEP_HZ)
          freqRangeRef.current = { min: newMin, max: range.max }
          onFreqRangeChangeRef.current?.(newMin, range.max)
        } else {
          const newMax = Math.max(hz, range.min + RANGE_KEYBOARD_STEP_HZ)
          freqRangeRef.current = { min: range.min, max: newMax }
          onFreqRangeChangeRef.current?.(range.min, newMax)
        }
        return
      }

      const thresholdDistance = getThresholdDistance(
        event.clientY,
        rect,
        paddingRef.current.top,
        effectiveThreshYRef.current,
      )

      if (thresholdDistance <= GRAB_THRESHOLD_PX && onThresholdChangeRef.current) {
        canvasElement.style.cursor = 'ns-resize'
        return
      }

      if (!hasFreqDrag) {
        canvasElement.style.cursor = 'default'
        return
      }

      const { minDist, maxDist } = getRangeLineDistances(
        event.clientX,
        rect,
        paddingRef.current,
        freqRangeRef.current,
      )
      canvasElement.style.cursor = Math.min(minDist, maxDist) <= GRAB_THRESHOLD_PX ? 'ew-resize' : 'default'
    }

    function resetInteractionState(pointerId: number) {
      if (threshDragRef.current.active) {
        threshDragRef.current = { active: false, startY: 0, startDb: 0 }
        canvasElement.releasePointerCapture(pointerId)
        canvasElement.style.cursor = 'default'
        return
      }

      if (dragRef.current) {
        dragRef.current = null
        canvasElement.releasePointerCapture(pointerId)
        canvasElement.style.cursor = 'default'
      }
    }

    function onPointerUp(event: PointerEvent) {
      resetInteractionState(event.pointerId)
    }

    function onPointerCancel(event: PointerEvent) {
      resetInteractionState(event.pointerId)
    }

    canvasElement.addEventListener('pointerdown', onPointerDown)
    canvasElement.addEventListener('pointermove', onPointerMove)
    canvasElement.addEventListener('pointerup', onPointerUp)
    canvasElement.addEventListener('pointercancel', onPointerCancel)

    return () => {
      canvasElement.removeEventListener('pointerdown', onPointerDown)
      canvasElement.removeEventListener('pointermove', onPointerMove)
      canvasElement.removeEventListener('pointerup', onPointerUp)
      canvasElement.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [
    canvasRef,
    dirtyRef,
    dragRef,
    effectiveThreshYRef,
    feedbackThresholdDbRef,
    freqRangeRef,
    onFreqRangeChange,
    onFreqRangeChangeRef,
    onThresholdChange,
    onThresholdChangeRef,
    paddingRef,
    showDragHintRef,
    threshDragRef,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasElement: HTMLCanvasElement = canvas
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return

    function onMouseMove(event: MouseEvent) {
      if (dragRef.current) {
        hoverPosRef.current = null
        return
      }

      const rect = canvasElement.getBoundingClientRect()
      hoverPosRef.current = getHoverCanvasPoint(
        event.clientX,
        event.clientY,
        rect,
        paddingRef.current,
      )
      dirtyRef.current = true
    }

    function onMouseLeave() {
      hoverPosRef.current = null
      dirtyRef.current = true
    }

    canvasElement.addEventListener('mousemove', onMouseMove)
    canvasElement.addEventListener('mouseleave', onMouseLeave)

    return () => {
      canvasElement.removeEventListener('mousemove', onMouseMove)
      canvasElement.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [canvasRef, dirtyRef, dragRef, hoverPosRef, paddingRef])

  return useCallback((event: React.KeyboardEvent) => {
    // Threshold adjustment — ArrowUp/ArrowDown (Shift = 5 dB step).
    if (onThresholdChangeRef.current) {
      const nextDb = adjustThresholdWithKeyboard(
        feedbackThresholdDbRef.current,
        event.key,
        event.shiftKey,
      )
      if (nextDb != null) {
        event.preventDefault()
        onThresholdChangeRef.current(nextDb)
        dirtyRef.current = true
        return
      }
    }

    // Frequency range adjustment — ArrowLeft/ArrowRight (Shift = move max edge).
    if (!onFreqRangeChangeRef.current) return

    const nextRange = adjustRangeWithKeyboard(
      freqRangeRef.current,
      event.key,
      event.shiftKey,
    )
    if (!nextRange) return

    event.preventDefault()
    freqRangeRef.current = nextRange
    onFreqRangeChangeRef.current(nextRange.min, nextRange.max)
    dirtyRef.current = true
  }, [dirtyRef, feedbackThresholdDbRef, freqRangeRef, onFreqRangeChangeRef, onThresholdChangeRef])
}
