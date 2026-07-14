'use client'

import { useCallback, useMemo } from 'react'
import { useAdvisoryActions, useAdvisoryData } from '@/contexts/AdvisoryContext'
import { useEngine } from '@/contexts/EngineContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useUI } from '@/contexts/UIContext'

export interface HeaderBarState {
  isRunning: boolean
  isStarting: boolean
  inputLevel: number
  isFrozen: boolean
  hasClearableContent: boolean
  handleToggleAnalysis: () => void
  handleClearDisplays: () => void
  toggleFreeze: () => void
}

export function useHeaderBarState(): HeaderBarState {
  const {
    isRunning,
    isStarting,
    start,
    stop,
  } = useEngine()
  const { inputLevel } = useMetering()
  const { isFrozen, toggleFreeze } = useUI()
  const { advisories, dismissedIds, hasActiveGEQBars, hasActiveRTAMarkers } = useAdvisoryData()
  const { onClearAll, onClearGEQ, onClearRTA } = useAdvisoryActions()

  const hasClearableContent = useMemo(
    () =>
      advisories.some((advisory) => !dismissedIds.has(advisory.id)) ||
      hasActiveGEQBars ||
      hasActiveRTAMarkers,
    [advisories, dismissedIds, hasActiveGEQBars, hasActiveRTAMarkers],
  )

  const handleToggleAnalysis = useCallback(() => {
    if (isStarting) return
    if (isRunning) {
      stop()
      return
    }
    void start()
  }, [isRunning, isStarting, start, stop])

  const handleClearDisplays = useCallback(() => {
    onClearAll()
    onClearGEQ()
    onClearRTA()
  }, [onClearAll, onClearGEQ, onClearRTA])

  return {
    isRunning,
    isStarting,
    inputLevel,
    isFrozen,
    hasClearableContent,
    handleToggleAnalysis,
    handleClearDisplays,
    toggleFreeze,
  }
}
