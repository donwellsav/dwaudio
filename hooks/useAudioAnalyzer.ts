// DoneWell Audio React Hook - Manages audio analyzer lifecycle
// DSP post-processing (classification, EQ advisory) runs in a Web Worker via useDSPWorker.
// Advisory state management (Map, sorting, dedup) is delegated to useAdvisoryMap.

import { useState, useEffect, useCallback, useRef } from 'react'
import { createAudioAnalyzer } from '@/lib/audio/createAudioAnalyzer'
import type { AudioAnalyzer } from '@/lib/audio/createAudioAnalyzer'
import { useDSPWorker, type DSPWorkerCallbacks, type DSPWorkerHandle } from './useDSPWorker'
import { useAdvisoryMap } from './useAdvisoryMap'
import { resetFeedbackHistoryForCurrentRun } from '@/lib/dsp/feedbackHistory'
import type {
  Advisory,
  SpectrumData,
  TrackSummary,
  DetectorSettings,
} from '@/types/advisory'
import { useLayeredSettings } from '@/hooks/useLayeredSettings'
import { pickAudioRuntimeSettings, pickWorkerRuntimeSettings } from '@/lib/settings/runtimeSettings'
import type { EarlyWarning, SpectrumStatus } from '@/hooks/audioAnalyzerTypes'
import { useAnalyzerFrameState } from '@/hooks/useAnalyzerFrameState'
import type { DwaSessionState, DisplayPrefs } from '@/types/settings'
import type { UseLayeredSettingsReturn } from '@/hooks/useLayeredSettings'

export type { EarlyWarning, SpectrumStatus } from '@/hooks/audioAnalyzerTypes'

export interface UseAudioAnalyzerState {
  isRunning: boolean
  /** True between clicking Start and mic stream acquisition (covers permission prompt) */
  isStarting: boolean
  hasPermission: boolean
  error: string | null
  /** Non-fatal worker error (crash/recovery in progress) â€” shown as amber warning */
  workerError: string | null
  noiseFloorDb: number | null
  sampleRate: number
  fftSize: number
  spectrumStatus: SpectrumStatus | null
  advisories: Advisory[]
  earlyWarning: EarlyWarning | null
}

export interface UseAudioAnalyzerReturn extends UseAudioAnalyzerState {
  start: (options?: { deviceId?: string }) => Promise<void>
  stop: () => void
  switchDevice: (deviceId: string) => Promise<void>
  resetSettings: () => void
  settings: DetectorSettings
  spectrumRef: React.RefObject<SpectrumData | null>
  tracksRef: React.RefObject<TrackSummary[]>
  dspWorker: DSPWorkerHandle
  layeredSession: DwaSessionState
  layeredDisplay: DisplayPrefs
  layered: UseLayeredSettingsReturn
}

type InternalAnalyzerState = Omit<
  UseAudioAnalyzerState,
  'advisories' | 'noiseFloorDb' | 'spectrumStatus' | 'earlyWarning'
>

export function useAudioAnalyzer(
  initialSettings: Partial<DetectorSettings> = {},
  frozenRef?: React.RefObject<boolean>,
): UseAudioAnalyzerReturn {
  const layered = useLayeredSettings(initialSettings)
  const settings = layered.derivedSettings
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const { advisories, onAdvisory, onAdvisoryCleared, clearMap } = useAdvisoryMap(
    settings.maxDisplayedIssues,
    frozenRef,
  )

  const [state, setState] = useState<InternalAnalyzerState>({
    isRunning: false,
    isStarting: false,
    hasPermission: false,
    error: null,
    workerError: null,
    sampleRate: 48000,
    fftSize: settings.fftSize,
  })

  const analyzerRef = useRef<AudioAnalyzer | null>(null)
  const deviceIdRef = useRef<string>('')
  const pendingDeviceIdRef = useRef<string | null>(null)
  const switchDevicePromiseRef = useRef<Promise<void> | null>(null)
  const switchResolveRef = useRef<(() => void) | null>(null)
  const isSwitchingDeviceRef = useRef(false)
  const operationGenerationRef = useRef(0)
  const activeStartGenerationRef = useRef<number | null>(null)
  const appliedFftSizeRef = useRef(settings.fftSize)
  const retireDeviceSwitch = useCallback(() => {
    const resolve = switchResolveRef.current
    switchResolveRef.current = null
    switchDevicePromiseRef.current = null
    isSwitchingDeviceRef.current = false
    resolve?.()
  }, [])
  const {
    noiseFloorDb,
    spectrumStatus,
    earlyWarning,
    spectrumRef,
    tracksRef,
    handleSpectrum,
    handleTracksUpdate,
    handleContentTypeUpdate,
    handleCombPatternDetected,
    resetFrameState,
  } = useAnalyzerFrameState()
  const stableCallbacks = useRef<DSPWorkerCallbacks>({
    onAdvisory,
    onAdvisoryCleared,
    onTracksUpdate: handleTracksUpdate,
    onEarlyWarningUpdate: handleCombPatternDetected,
    onContentTypeUpdate: handleContentTypeUpdate,
    onReady: () => {
      setState((previous) => previous.workerError ? { ...previous, workerError: null } : previous)
    },
    onError: (message) => {
      setState((previous) => ({ ...previous, workerError: message }))
    },
  }).current

  const dspWorker = useDSPWorker(stableCallbacks)
  const dspWorkerRef = useRef(dspWorker)
  dspWorkerRef.current = dspWorker

  const resetRunState = useCallback(() => {
    resetFeedbackHistoryForCurrentRun()
    clearMap()
    resetFrameState()
    dspWorkerRef.current.reset()
  }, [clearMap, resetFrameState])

  useEffect(() => {
    const analyzer = createAudioAnalyzer(pickAudioRuntimeSettings(settingsRef.current), {
      onSpectrum: handleSpectrum,
      onPeakDetected: (peak, spectrum, sampleRate, fftSize, timeDomain) => {
        dspWorkerRef.current.processPeak(peak, spectrum, sampleRate, fftSize, timeDomain)
      },
      onSpectrumUpdate: (spectrum, crestFactor, sampleRate, fftSize) => {
        dspWorkerRef.current.sendSpectrumUpdate(spectrum, crestFactor, sampleRate, fftSize)
      },
      onPeakCleared: (peak) => {
        dspWorkerRef.current.clearPeak(peak.binIndex, peak.frequencyHz, peak.timestamp)
      },
      onCombPatternDetected: handleCombPatternDetected,
      onError: (error) => {
        if (isSwitchingDeviceRef.current) return
        setState((previous) => ({
          ...previous,
          error: error.message,
          isRunning: false,
        }))
      },
      onStateChange: (isRunning) => {
        if (isSwitchingDeviceRef.current) return
        setState((previous) => ({ ...previous, isRunning }))
      },
    })

    analyzerRef.current = analyzer

    return () => {
      operationGenerationRef.current += 1
      activeStartGenerationRef.current = null
      pendingDeviceIdRef.current = null
      retireDeviceSwitch()
      analyzer.stop({ releaseMic: true })
    }
  }, [handleCombPatternDetected, handleSpectrum, retireDeviceSwitch])

  useEffect(() => {
    const analyzer = analyzerRef.current
    const fftSizeChanged = appliedFftSizeRef.current !== settings.fftSize
    appliedFftSizeRef.current = settings.fftSize
    const workerSettings = pickWorkerRuntimeSettings(settings)
    let workerInitialized = false

    if (analyzer) {
      analyzer.updateSettings(pickAudioRuntimeSettings(settings))
      setState((previous) => ({ ...previous, fftSize: settings.fftSize }))

      if (fftSizeChanged) {
        const analyzerState = analyzer.getState()
        if (analyzerState.isRunning) {
          resetRunState()
          dspWorkerRef.current.init(
            workerSettings,
            analyzerState.sampleRate,
            analyzerState.fftSize,
          )
          workerInitialized = true
        }
      }
    }
    if (!workerInitialized) dspWorkerRef.current.updateSettings(workerSettings)
  }, [resetRunState, settings])

  const start = useCallback(async (options: { deviceId?: string } = {}) => {
    if (!analyzerRef.current) return

    const deviceId = options.deviceId ?? deviceIdRef.current
    const replacesActiveSwitch = switchDevicePromiseRef.current !== null
    deviceIdRef.current = deviceId
    pendingDeviceIdRef.current = null
    const startGeneration = ++operationGenerationRef.current
    activeStartGenerationRef.current = startGeneration
    if (replacesActiveSwitch) analyzerRef.current.stop({ releaseMic: true })
    retireDeviceSwitch()

    try {
      resetRunState()
      setState((previous) => ({ ...previous, isStarting: true }))

      await analyzerRef.current.start({ deviceId: deviceId || undefined })
      if (operationGenerationRef.current !== startGeneration) return
      const analyzerState = analyzerRef.current.getState()

      if (!analyzerState.isRunning) {
        setState((previous) => ({
          ...previous,
          isStarting: false,
          isRunning: false,
          hasPermission: analyzerState.hasPermission,
          error: analyzerState.error,
          sampleRate: analyzerState.sampleRate,
          fftSize: analyzerState.fftSize,
        }))
        return
      }

      dspWorkerRef.current.init(
        pickWorkerRuntimeSettings(settingsRef.current),
        analyzerState.sampleRate,
        analyzerState.fftSize,
      )

      setState((previous) => ({
        ...previous,
        isStarting: false,
        isRunning: true,
        hasPermission: analyzerState.hasPermission,
        error: null,
        sampleRate: analyzerState.sampleRate,
        fftSize: analyzerState.fftSize,
      }))
    } catch (error) {
      if (operationGenerationRef.current !== startGeneration) return
      setState((previous) => ({
        ...previous,
        isStarting: false,
        error: error instanceof Error ? error.message : 'Failed to start',
        isRunning: false,
        hasPermission: false,
      }))
    } finally {
      if (activeStartGenerationRef.current === startGeneration) {
        activeStartGenerationRef.current = null
      }
    }
  }, [resetRunState, retireDeviceSwitch])

  const stop = useCallback(() => {
    if (!analyzerRef.current) return

    operationGenerationRef.current += 1
    activeStartGenerationRef.current = null
    pendingDeviceIdRef.current = null
    retireDeviceSwitch()
    analyzerRef.current.stop({ releaseMic: true })
    tracksRef.current = []
    setState((previous) => ({
      ...previous,
      isStarting: false,
      isRunning: false,
    }))
  }, [retireDeviceSwitch, tracksRef])

  const switchDevice = useCallback((deviceId: string): Promise<void> => {
    deviceIdRef.current = deviceId
    pendingDeviceIdRef.current = deviceId

    if (switchDevicePromiseRef.current) return switchDevicePromiseRef.current

    const analyzer = analyzerRef.current
    const hasPendingStart = activeStartGenerationRef.current !== null
    if (!analyzer || (!analyzer.getState().isRunning && !hasPendingStart)) {
      pendingDeviceIdRef.current = null
      return Promise.resolve()
    }
    const switchGeneration = ++operationGenerationRef.current
    activeStartGenerationRef.current = null

    let resolveSwitch!: () => void
    let rejectSwitch!: (error: unknown) => void
    const switchPromise = new Promise<void>((resolve, reject) => {
      resolveSwitch = resolve
      rejectSwitch = reject
    })

    const runSwitches = async () => {
      try {
        while (true) {
          while (pendingDeviceIdRef.current !== null) {
            if (operationGenerationRef.current !== switchGeneration) return
            const nextDeviceId = pendingDeviceIdRef.current
            pendingDeviceIdRef.current = null

            resetRunState()
            setState((previous) => ({
              ...previous,
              isStarting: true,
              isRunning: false,
            }))
            analyzer.stop({ releaseMic: true })

            try {
              await analyzer.start({ deviceId: nextDeviceId || undefined })
              if (operationGenerationRef.current !== switchGeneration) return

              if (deviceIdRef.current !== nextDeviceId) {
                analyzer.stop({ releaseMic: true })
                continue
              }
              if (pendingDeviceIdRef.current === nextDeviceId) {
                pendingDeviceIdRef.current = null
              }

              const analyzerState = analyzer.getState()
              if (!analyzerState.isRunning) {
                setState((previous) => ({
                  ...previous,
                  isStarting: false,
                  error: analyzerState.error,
                  isRunning: false,
                  hasPermission: analyzerState.hasPermission,
                  sampleRate: analyzerState.sampleRate,
                  fftSize: analyzerState.fftSize,
                }))
                return
              }

              dspWorkerRef.current.init(
                pickWorkerRuntimeSettings(settingsRef.current),
                analyzerState.sampleRate,
                analyzerState.fftSize,
              )
              setState((previous) => ({
                ...previous,
                isStarting: false,
                error: null,
                isRunning: true,
                hasPermission: analyzerState.hasPermission,
                sampleRate: analyzerState.sampleRate,
                fftSize: analyzerState.fftSize,
              }))
            } catch (error) {
              if (operationGenerationRef.current !== switchGeneration) return
              if (deviceIdRef.current !== nextDeviceId) {
                analyzer.stop({ releaseMic: true })
                continue
              }
              if (pendingDeviceIdRef.current === nextDeviceId) {
                pendingDeviceIdRef.current = null
              }

              setState((previous) => ({
                ...previous,
                isStarting: false,
                error: error instanceof Error ? error.message : 'Failed to switch input device',
                isRunning: false,
                hasPermission: false,
              }))
              return
            }
          }

          // Let requests queued by final publication join before closing this shared switch.
          await Promise.resolve()
          if (operationGenerationRef.current !== switchGeneration) return
          if (pendingDeviceIdRef.current === null) return
        }
      } finally {
        if (switchDevicePromiseRef.current === switchPromise) {
          switchDevicePromiseRef.current = null
          switchResolveRef.current = null
          isSwitchingDeviceRef.current = false
        }
      }
    }

    switchDevicePromiseRef.current = switchPromise
    switchResolveRef.current = resolveSwitch
    isSwitchingDeviceRef.current = true
    void runSwitches().then(resolveSwitch, rejectSwitch)
    return switchPromise
  }, [resetRunState])

  const resetSettings = useCallback(() => {
    layered.resetAll()
  }, [layered])

  return {
    ...state,
    noiseFloorDb,
    spectrumStatus,
    advisories,
    earlyWarning,
    settings,
    start,
    stop,
    switchDevice,
    resetSettings,
    spectrumRef,
    tracksRef,
    dspWorker,
    layeredSession: layered.session,
    layeredDisplay: layered.display,
    layered,
  }
}
