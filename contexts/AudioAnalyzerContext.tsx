'use client'

import { useMemo, type ReactNode } from 'react'
import { useAnalyzerContextState } from '@/hooks/useAnalyzerContextState'

import { EngineContext, useEngine } from '@/contexts/EngineContext'
import type { EngineContextValue } from '@/contexts/EngineContext'
import { SettingsContext, useSettings } from '@/contexts/SettingsContext'
import type { SettingsContextValue } from '@/contexts/SettingsContext'
import { MeteringContext, useMetering } from '@/contexts/MeteringContext'
import type { MeteringContextValue } from '@/contexts/MeteringContext'
import { DetectionContext, useDetection } from '@/contexts/DetectionContext'
import type { DetectionContextValue } from '@/contexts/DetectionContext'
import {
  createDetectionContextValue,
  createEngineContextValue,
  createMeteringContextValue,
  createSettingsContextValue,
} from '@/contexts/audioAnalyzerContextValues'

export { useEngine, useSettings, useMetering, useDetection }

export type {
  EngineContextValue,
  SettingsContextValue,
  MeteringContextValue,
  DetectionContextValue,
}

/**
 * @deprecated Use `EngineContextValue`, `SettingsContextValue`, `MeteringContextValue`,
 * or `DetectionContextValue` instead.
 */
export type AudioAnalyzerContextValue =
  EngineContextValue & SettingsContextValue & MeteringContextValue & DetectionContextValue

interface AudioAnalyzerProviderProps {
  frozenRef?: React.RefObject<boolean>
  children: ReactNode
}

export function AudioAnalyzerProvider({
  frozenRef,
  children,
}: AudioAnalyzerProviderProps) {
  const state = useAnalyzerContextState({ frozenRef })
  const {
    isRunning,
    isStarting,
    error,
    workerError,
    startWithDevice,
    stop,
    switchDevice,
    devices,
    selectedDeviceId,
    handleDeviceChange,
    dspWorker,
    settings,
    resetSettings,
    layeredSession,
    layeredDisplay,
    layered,
    spectrumRef,
    tracksRef,
    spectrumStatus,
    noiseFloorDb,
    sampleRate,
    fftSize,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
    advisories,
    earlyWarning,
  } = state
  const {
    setMode,
    setSensitivityOffset,
    setInputGain,
    setAutoGain,
    setFocusRange,
    setEqStyle,
    updateDisplay,
    updateDiagnostics,
    updateLiveOverrides,
  } = layered

  const engineValue = useMemo(() => createEngineContextValue({
    isRunning,
    isStarting,
    error,
    workerError,
    startWithDevice,
    stop,
    switchDevice,
    devices,
    selectedDeviceId,
    handleDeviceChange,
    dspWorker,
  }), [
    isRunning,
    isStarting,
    error,
    workerError,
    startWithDevice,
    stop,
    switchDevice,
    devices,
    selectedDeviceId,
    handleDeviceChange,
    dspWorker,
  ])

  const settingsValue = useMemo(() => createSettingsContextValue({
    settings,
    resetSettings,
    layeredSession,
    layeredDisplay,
    layered: {
      setMode,
      setSensitivityOffset,
      setInputGain,
      setAutoGain,
      setFocusRange,
      setEqStyle,
      updateDisplay,
      updateDiagnostics,
      updateLiveOverrides,
    },
  }), [
    settings,
    resetSettings,
    layeredSession,
    layeredDisplay,
    setMode,
    setSensitivityOffset,
    setInputGain,
    setAutoGain,
    setFocusRange,
    setEqStyle,
    updateDisplay,
    updateDiagnostics,
    updateLiveOverrides,
  ])

  const meteringValue = useMemo(() => createMeteringContextValue({
    spectrumRef,
    tracksRef,
    spectrumStatus,
    noiseFloorDb,
    sampleRate,
    fftSize,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
  }), [
    spectrumRef,
    tracksRef,
    spectrumStatus,
    noiseFloorDb,
    sampleRate,
    fftSize,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
  ])

  const detectionValue = useMemo(() => createDetectionContextValue({
    advisories,
    earlyWarning,
  }), [
    advisories,
    earlyWarning,
  ])

  return (
    <EngineContext.Provider value={engineValue}>
      <SettingsContext.Provider value={settingsValue}>
        <DetectionContext.Provider value={detectionValue}>
          <MeteringContext.Provider value={meteringValue}>
            {children}
          </MeteringContext.Provider>
        </DetectionContext.Provider>
      </SettingsContext.Provider>
    </EngineContext.Provider>
  )
}

/**
 * @deprecated Use `useEngine()`, `useSettings()`, `useMetering()`, or `useDetection()` instead.
 * This hook reads all 4 contexts and re-renders on ANY context change.
 */
export function useAudio(): AudioAnalyzerContextValue {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn('[DWA] useAudio() is deprecated â€” use useEngine(), useSettings(), useMetering(), or useDetection() for granular re-renders')
  }

  const engine = useEngine()
  const settingsCtx = useSettings()
  const metering = useMetering()
  const detection = useDetection()

  return { ...engine, ...settingsCtx, ...metering, ...detection }
}
