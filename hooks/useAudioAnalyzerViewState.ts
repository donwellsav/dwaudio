'use client'

import { useAnalyzerSessionEffects } from '@/hooks/useAnalyzerSessionEffects'
import { useAnalyzerShellState } from '@/hooks/useAnalyzerShellState'
import { useFpsMonitor } from '@/hooks/useFpsMonitor'
import { useDetection } from '@/contexts/DetectionContext'
import { useEngine } from '@/contexts/EngineContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useSettings } from '@/contexts/SettingsContext'

export function useAudioAnalyzerViewState() {
  const { isRunning, error, workerError, start, dspWorker } = useEngine()
  const { settings } = useSettings()
  const { spectrumRef } = useMetering()
  const { advisories } = useDetection()

  const { actualFps, droppedPercent } = useFpsMonitor(isRunning, settings.canvasTargetFps)
  const shellState = useAnalyzerShellState(error, start)

  useAnalyzerSessionEffects({
    dspWorker,
    advisories,
    spectrumRef,
    settings,
  })

  return {
    isRunning,
    error,
    workerError,
    isWorkerPermanentlyDead: dspWorker.isPermanentlyDead,
    actualFps,
    droppedPercent,
    shellState,
  }
}
