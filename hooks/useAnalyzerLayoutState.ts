'use client'

import { useMemo } from 'react'
import { useEngine } from '@/contexts/EngineContext'
import { useSettings } from '@/contexts/SettingsContext'
import { useMetering } from '@/contexts/MeteringContext'
import { useAdvisories } from '@/contexts/AdvisoryContext'
import { useThresholdChange } from '@/hooks/useThresholdChange'
import { useLowSignal } from '@/hooks/useLowSignal'
import type { Advisory, DetectorSettings } from '@/types/advisory'
import type { DwaSessionState } from '@/types/settings'
import type {
  SpectrumDisplayConfig,
  SpectrumLifecycle,
  SpectrumRangeConfig,
} from '@/components/analyzer/SpectrumCanvas'

type SpectrumDisplaySettings = Pick<
  DetectorSettings,
  | 'graphFontSize'
  | 'rtaDbMin'
  | 'rtaDbMax'
  | 'spectrumLineWidth'
  | 'canvasTargetFps'
  | 'showFreqZones'
  | 'showThresholdLine'
  | 'spectrumWarmMode'
  | 'spectrumSmoothingMode'
>

type SpectrumRangeSettings = Pick<
  DetectorSettings,
  'minFrequency' | 'maxFrequency' | 'feedbackThresholdDb'
>

export function hasCustomGateOverrides(session: DwaSessionState | null | undefined): boolean {
  const diagnostics = session?.diagnostics
  if (!diagnostics) return false

  return (
    diagnostics.formantGateOverride !== undefined ||
    diagnostics.chromaticGateOverride !== undefined ||
    diagnostics.combSweepOverride !== undefined ||
    diagnostics.ihrGateOverride !== undefined ||
    diagnostics.ptmrGateOverride !== undefined ||
    diagnostics.mainsHumGateOverride !== undefined
  )
}

export function countActiveGeqCuts(advisories: Advisory[], geqClearedIds: Set<string>): number {
  return advisories.filter(
    advisory =>
      advisory.lifecycle !== 'provisional' &&
      !advisory.resolved &&
      !geqClearedIds.has(advisory.id) &&
      advisory.advisory?.geq,
  ).length
}

export function buildSpectrumDisplay(settings: SpectrumDisplaySettings): SpectrumDisplayConfig {
  return {
    graphFontSize: settings.graphFontSize,
    rtaDbMin: settings.rtaDbMin,
    rtaDbMax: settings.rtaDbMax,
    spectrumLineWidth: settings.spectrumLineWidth,
    canvasTargetFps: settings.canvasTargetFps,
    showFreqZones: settings.showFreqZones,
    showThresholdLine: settings.showThresholdLine,
    spectrumWarmMode: settings.spectrumWarmMode,
    spectrumSmoothingMode: settings.spectrumSmoothingMode,
  }
}

export function buildSpectrumRange(settings: SpectrumRangeSettings): SpectrumRangeConfig {
  return {
    minFrequency: settings.minFrequency,
    maxFrequency: settings.maxFrequency,
    feedbackThresholdDb: settings.feedbackThresholdDb,
  }
}

export function useAnalyzerLayoutState() {
  const { isRunning, isStarting, error, start } = useEngine()
  const {
    settings,
    handleFreqRangeChange,
    setInputGain,
    setAutoGain,
    updateDisplay,
    setSensitivityOffset,
    session,
  } = useSettings()
  const {
    spectrumRef,
    spectrumStatus,
    noiseFloorDb,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
  } = useMetering()
  // Intentionally merged — this hook spreads the full advisory context to
  // downstream consumers (see `...advisoriesState` below), so splitting here
  // buys nothing: the spread creates a new object identity every render.
  const advisoriesState = useAdvisories()

  const isLowSignal = useLowSignal(isRunning, inputLevel)
  const handleThresholdChange = useThresholdChange(session, setSensitivityOffset)
  const {
    graphFontSize,
    rtaDbMin,
    rtaDbMax,
    spectrumLineWidth,
    canvasTargetFps,
    showFreqZones,
    showThresholdLine,
    spectrumWarmMode,
    spectrumSmoothingMode,
    minFrequency,
    maxFrequency,
    feedbackThresholdDb,
  } = settings

  const spectrumDisplay = useMemo(
    () => buildSpectrumDisplay({
      graphFontSize,
      rtaDbMin,
      rtaDbMax,
      spectrumLineWidth,
      canvasTargetFps,
      showFreqZones,
      showThresholdLine,
      spectrumWarmMode,
      spectrumSmoothingMode,
    }),
    [
      graphFontSize,
      rtaDbMin,
      rtaDbMax,
      spectrumLineWidth,
      canvasTargetFps,
      showFreqZones,
      showThresholdLine,
      spectrumWarmMode,
      spectrumSmoothingMode,
    ],
  )

  const spectrumRange = useMemo(
    () => buildSpectrumRange({
      minFrequency,
      maxFrequency,
      feedbackThresholdDb,
    }),
    [minFrequency, maxFrequency, feedbackThresholdDb],
  )

  const spectrumLifecycle = useMemo<SpectrumLifecycle>(() => ({
    isRunning,
    isStarting,
    error,
  }), [isRunning, isStarting, error])

  const spectrumLifecycleWithStart = useMemo<SpectrumLifecycle>(() => ({
    isRunning,
    isStarting,
    error,
    onStart: !isRunning && !isStarting ? start : undefined,
  }), [isRunning, isStarting, error, start])

  const issuesListBaseProps = useMemo(() => ({
    advisories: advisoriesState.advisories,
    dismissedIds: advisoriesState.dismissedIds,
    lastDismissedId: advisoriesState.lastDismissedId,
    isRunning,
    onStart: start,
    isLowSignal,
    spectrumStatus,
    noiseFloorDb,
    showAlgorithmScores: settings.showAlgorithmScores,
    showPeqDetails: settings.showPeqDetails,
    onDismiss: advisoriesState.onDismiss,
    onRestoreDismissed: advisoriesState.restoreDismissedAdvisory,
  }), [
    advisoriesState.advisories,
    advisoriesState.dismissedIds,
    advisoriesState.lastDismissedId,
    advisoriesState.onDismiss,
    advisoriesState.restoreDismissedAdvisory,
    isLowSignal,
    isRunning,
    noiseFloorDb,
    spectrumStatus,
    settings.showAlgorithmScores,
    settings.showPeqDetails,
    start,
  ])

  const activeGeqCutCount = useMemo(
    () => countActiveGeqCuts(advisoriesState.advisories, advisoriesState.geqClearedIds),
    [advisoriesState.advisories, advisoriesState.geqClearedIds],
  )

  return {
    isRunning,
    isStarting,
    error,
    start,
    settings,
    handleFreqRangeChange,
    setInputGain,
    setAutoGain,
    updateDisplay,
    session,
    spectrumRef,
    spectrumStatus,
    noiseFloorDb,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
    isLowSignal,
    handleThresholdChange,
    spectrumDisplay,
    spectrumRange,
    spectrumLifecycle,
    spectrumLifecycleWithStart,
    issuesListBaseProps,
    activeGeqCutCount,
    hasCustomGates: hasCustomGateOverrides(session),
    ...advisoriesState,
  }
}
