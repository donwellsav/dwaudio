'use client'

import { useCallback, useRef, useState } from 'react'
import type {
  AlgorithmMode,
  ContentType,
  SpectrumData,
  TrackSummary,
} from '@/types/advisory'
import type { CombPatternResult } from '@/lib/dsp/advancedDetection'
import type { SpectrumStatus } from '@/hooks/audioAnalyzerTypes'
import { useEarlyWarningState } from '@/hooks/useEarlyWarningState'

const STATUS_THROTTLE_MS = 250

export interface WorkerStatusSnapshot {
  contentType?: ContentType
  algorithmMode?: AlgorithmMode
  isCompressed?: boolean
  compressionRatio?: number
  lastFusionVerdict?: SpectrumStatus['lastFusionVerdict']
  lastFusionConfidence?: number
  lastFeedbackProbability?: number
  lastReportDecision?: SpectrumStatus['lastReportDecision']
  lastReportGate?: SpectrumStatus['lastReportGate']
  lastReportGateReason?: string
  lastReportFrequencyHz?: number
  lastReportTimestamp?: number
}

interface AnalyzerFrameState {
  noiseFloorDb: number | null
  spectrumStatus: SpectrumStatus | null
}

export function mergeFrameState(
  previous: AnalyzerFrameState,
  spectrum: SpectrumData,
  workerStatus: WorkerStatusSnapshot,
): AnalyzerFrameState {
  const nextStatus: SpectrumStatus = {
    peak: spectrum.peak,
    autoGainDb: spectrum.autoGainDb,
    autoGainEnabled: spectrum.autoGainEnabled,
    autoGainLocked: spectrum.autoGainLocked,
    algorithmMode: workerStatus.algorithmMode ?? spectrum.algorithmMode,
    contentType: workerStatus.contentType ?? spectrum.contentType,
    msdFrameCount: spectrum.msdFrameCount,
    isCompressed: workerStatus.isCompressed ?? spectrum.isCompressed,
    compressionRatio: workerStatus.compressionRatio ?? spectrum.compressionRatio,
    isSignalPresent: spectrum.isSignalPresent,
    rawPeakDb: spectrum.rawPeakDb,
    effectiveThresholdDb: spectrum.effectiveThresholdDb,
    lastConfirmLatencyMs: spectrum.lastConfirmLatencyMs,
    lastPeakConfirmedAt: spectrum.lastPeakConfirmedAt,
    lastFusionVerdict: workerStatus.lastFusionVerdict,
    lastFusionConfidence: workerStatus.lastFusionConfidence,
    lastFeedbackProbability: workerStatus.lastFeedbackProbability,
    lastReportDecision: workerStatus.lastReportDecision,
    lastReportGate: workerStatus.lastReportGate,
    lastReportGateReason: workerStatus.lastReportGateReason,
    lastReportFrequencyHz: workerStatus.lastReportFrequencyHz,
    lastReportTimestamp: workerStatus.lastReportTimestamp,
  }

  if (
    previous.spectrumStatus &&
    previous.spectrumStatus.peak === nextStatus.peak &&
    previous.spectrumStatus.autoGainDb === nextStatus.autoGainDb &&
    previous.spectrumStatus.autoGainEnabled === nextStatus.autoGainEnabled &&
    previous.spectrumStatus.autoGainLocked === nextStatus.autoGainLocked &&
    previous.spectrumStatus.algorithmMode === nextStatus.algorithmMode &&
    previous.spectrumStatus.contentType === nextStatus.contentType &&
    previous.spectrumStatus.msdFrameCount === nextStatus.msdFrameCount &&
    previous.spectrumStatus.isCompressed === nextStatus.isCompressed &&
    previous.spectrumStatus.compressionRatio === nextStatus.compressionRatio &&
    previous.spectrumStatus.isSignalPresent === nextStatus.isSignalPresent &&
    previous.spectrumStatus.rawPeakDb === nextStatus.rawPeakDb &&
    previous.spectrumStatus.effectiveThresholdDb === nextStatus.effectiveThresholdDb &&
    previous.spectrumStatus.lastConfirmLatencyMs === nextStatus.lastConfirmLatencyMs &&
    previous.spectrumStatus.lastPeakConfirmedAt === nextStatus.lastPeakConfirmedAt &&
    previous.spectrumStatus.lastFusionVerdict === nextStatus.lastFusionVerdict &&
    previous.spectrumStatus.lastFusionConfidence === nextStatus.lastFusionConfidence &&
    previous.spectrumStatus.lastFeedbackProbability === nextStatus.lastFeedbackProbability &&
    previous.spectrumStatus.lastReportDecision === nextStatus.lastReportDecision &&
    previous.spectrumStatus.lastReportGate === nextStatus.lastReportGate &&
    previous.spectrumStatus.lastReportGateReason === nextStatus.lastReportGateReason &&
    previous.spectrumStatus.lastReportFrequencyHz === nextStatus.lastReportFrequencyHz &&
    previous.spectrumStatus.lastReportTimestamp === nextStatus.lastReportTimestamp &&
    previous.noiseFloorDb === spectrum.noiseFloorDb
  ) {
    return previous
  }

  return {
    noiseFloorDb: spectrum.noiseFloorDb,
    spectrumStatus: nextStatus,
  }
}

export function useAnalyzerFrameState() {
  const spectrumRef = useRef<SpectrumData | null>(null)
  const tracksRef = useRef<TrackSummary[]>([])
  const workerStatusRef = useRef<WorkerStatusSnapshot>({})
  const lastStatusUpdateRef = useRef(0)
  const [frameState, setFrameState] = useState<AnalyzerFrameState>({
    noiseFloorDb: null,
    spectrumStatus: null,
  })

  const { earlyWarning, applyPattern, clearEarlyWarning } = useEarlyWarningState()

  const handleSpectrum = useCallback((spectrum: SpectrumData) => {
    spectrumRef.current = spectrum

    const now = performance.now()
    if (now - lastStatusUpdateRef.current <= STATUS_THROTTLE_MS) return

    lastStatusUpdateRef.current = now
    setFrameState((previous) => mergeFrameState(previous, spectrum, workerStatusRef.current))
  }, [])

  const handleTracksUpdate = useCallback((tracks: TrackSummary[], status?: WorkerStatusSnapshot) => {
    tracksRef.current = tracks
    if (!status) return

    workerStatusRef.current = {
      ...workerStatusRef.current,
      algorithmMode: status.algorithmMode,
      contentType: status.contentType,
      isCompressed: status.isCompressed,
      compressionRatio: status.compressionRatio,
      lastFusionVerdict: status.lastFusionVerdict,
      lastFusionConfidence: status.lastFusionConfidence,
      lastFeedbackProbability: status.lastFeedbackProbability,
      lastReportDecision: status.lastReportDecision,
      lastReportGate: status.lastReportGate,
      lastReportGateReason: status.lastReportGateReason,
      lastReportFrequencyHz: status.lastReportFrequencyHz,
      lastReportTimestamp: status.lastReportTimestamp,
    }
  }, [])

  const handleContentTypeUpdate = useCallback((
    contentType: ContentType,
    isCompressed: boolean,
    compressionRatio: number,
  ) => {
    workerStatusRef.current = {
      ...workerStatusRef.current,
      contentType,
      isCompressed,
      compressionRatio,
    }
  }, [])

  const handleCombPatternDetected = useCallback((pattern: CombPatternResult | null) => {
    applyPattern(pattern)
  }, [applyPattern])

  return {
    noiseFloorDb: frameState.noiseFloorDb,
    spectrumStatus: frameState.spectrumStatus,
    earlyWarning,
    spectrumRef,
    tracksRef,
    handleSpectrum,
    handleTracksUpdate,
    handleContentTypeUpdate,
    handleCombPatternDetected,
    clearEarlyWarning,
  }
}
