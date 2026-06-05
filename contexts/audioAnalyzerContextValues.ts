'use client'

import type { EngineContextValue } from '@/contexts/EngineContext'
import type { SettingsContextValue } from '@/contexts/SettingsContext'
import type { MeteringContextValue } from '@/contexts/MeteringContext'
import type { DetectionContextValue } from '@/contexts/DetectionContext'
import type { AnalyzerContextState } from '@/hooks/useAnalyzerContextState'
import type { ModeId } from '@/types/settings'

type EngineContextStateFields = Pick<
  AnalyzerContextState,
  | 'isRunning'
  | 'isStarting'
  | 'error'
  | 'workerError'
  | 'startWithDevice'
  | 'stop'
  | 'switchDevice'
  | 'devices'
  | 'selectedDeviceId'
  | 'handleDeviceChange'
  | 'dspWorker'
>

type LayeredContextActions = Pick<
  AnalyzerContextState['layered'],
  | 'setMode'
  | 'setSensitivityOffset'
  | 'setInputGain'
  | 'setAutoGain'
  | 'setFocusRange'
  | 'setEqStyle'
  | 'updateDisplay'
  | 'updateDiagnostics'
  | 'updateLiveOverrides'
>

type SettingsContextStateFields = Pick<
  AnalyzerContextState,
  'settings' | 'resetSettings' | 'layeredSession' | 'layeredDisplay'
> & {
  layered: LayeredContextActions
}

type MeteringContextStateFields = Pick<
  AnalyzerContextState,
  | 'spectrumRef'
  | 'tracksRef'
  | 'spectrumStatus'
  | 'noiseFloorDb'
  | 'sampleRate'
  | 'fftSize'
  | 'inputLevel'
  | 'isAutoGain'
  | 'autoGainDb'
  | 'autoGainLocked'
>

type DetectionContextStateFields = Pick<AnalyzerContextState, 'advisories' | 'earlyWarning'>

export function createEngineContextValue(state: EngineContextStateFields): EngineContextValue {
  return {
    isRunning: state.isRunning,
    isStarting: state.isStarting,
    error: state.error,
    workerError: state.workerError,
    start: state.startWithDevice,
    stop: state.stop,
    switchDevice: state.switchDevice,
    devices: state.devices,
    selectedDeviceId: state.selectedDeviceId,
    handleDeviceChange: state.handleDeviceChange,
    dspWorker: state.dspWorker,
  }
}

export function createSettingsContextValue(state: SettingsContextStateFields): SettingsContextValue {
  return {
    settings: state.settings,
    resetSettings: state.resetSettings,
    handleModeChange: (mode) => state.layered.setMode(mode as ModeId),
    handleFreqRangeChange: (min, max) => state.layered.setFocusRange({ kind: 'custom', minHz: min, maxHz: max }),
    session: state.layeredSession,
    displayPrefs: state.layeredDisplay,
    setMode: state.layered.setMode,
    setSensitivityOffset: state.layered.setSensitivityOffset,
    setInputGain: state.layered.setInputGain,
    setAutoGain: state.layered.setAutoGain,
    setFocusRange: state.layered.setFocusRange,
    setEqStyle: state.layered.setEqStyle,
    updateDisplay: state.layered.updateDisplay,
    updateDiagnostics: state.layered.updateDiagnostics,
    updateLiveOverrides: state.layered.updateLiveOverrides,
  }
}

export function createMeteringContextValue(state: MeteringContextStateFields): MeteringContextValue {
  return {
    spectrumRef: state.spectrumRef,
    tracksRef: state.tracksRef,
    spectrumStatus: state.spectrumStatus,
    noiseFloorDb: state.noiseFloorDb,
    sampleRate: state.sampleRate,
    fftSize: state.fftSize,
    inputLevel: state.inputLevel,
    isAutoGain: state.isAutoGain,
    autoGainDb: state.autoGainDb,
    autoGainLocked: state.autoGainLocked,
  }
}

export function createDetectionContextValue(
  state: DetectionContextStateFields,
): DetectionContextValue {
  return {
    advisories: state.advisories,
    earlyWarning: state.earlyWarning,
  }
}
