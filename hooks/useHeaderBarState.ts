'use client'

import { useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { useAdvisoryActions, useAdvisoryData } from '@/contexts/AdvisoryContext'
import { useEngine } from '@/contexts/EngineContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useUI } from '@/contexts/UIContext'
import type { AudioDevice } from '@/hooks/useAudioDevices'

export interface HeaderBarState {
  isRunning: boolean
  isStarting: boolean
  inputLevel: number
  devices: AudioDevice[]
  selectedDeviceId: string
  handleDeviceChange: (deviceId: string) => void
  isFrozen: boolean
  resolvedTheme: string | undefined
  hasClearableContent: boolean
  handleToggleAnalysis: () => void
  handleClearDisplays: () => void
  toggleFreeze: () => void
  toggleTheme: () => void
}

export function useHeaderBarState(): HeaderBarState {
  const {
    isRunning,
    isStarting,
    start,
    stop,
    devices,
    selectedDeviceId,
    handleDeviceChange,
  } = useEngine()
  const { inputLevel } = useMetering()
  const { isFrozen, toggleFreeze } = useUI()
  const { advisories, dismissedIds, hasActiveGEQBars, hasActiveRTAMarkers } = useAdvisoryData()
  const { onClearAll, onClearGEQ, onClearRTA } = useAdvisoryActions()
  const { resolvedTheme, setTheme } = useTheme()

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

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return {
    isRunning,
    isStarting,
    inputLevel,
    devices,
    selectedDeviceId,
    handleDeviceChange,
    isFrozen,
    resolvedTheme,
    hasClearableContent,
    handleToggleAnalysis,
    handleClearDisplays,
    toggleFreeze,
    toggleTheme,
  }
}
