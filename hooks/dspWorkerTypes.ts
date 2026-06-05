'use client'

import type {
  Advisory,
  AlgorithmMode,
  ContentType,
  DetectedPeak,
  ReportGateId,
  TrackSummary,
} from '@/types/advisory'
import type { CombPatternResult } from '@/lib/dsp/advancedDetection'
import type { WorkerRuntimeSettings } from '@/lib/settings/runtimeSettings'
import type { FeedbackHotspotSummary } from '@/lib/dsp/feedbackHistoryShared'

export interface DSPWorkerCallbacks {
  onAdvisory?: (advisory: Advisory) => void
  onAdvisoryCleared?: (advisoryId: string) => void
  onTracksUpdate?: (
    tracks: TrackSummary[],
    status?: {
      contentType?: ContentType
      algorithmMode?: AlgorithmMode
      isCompressed?: boolean
      compressionRatio?: number
      lastFusionVerdict?: 'FEEDBACK' | 'POSSIBLE_FEEDBACK' | 'NOT_FEEDBACK' | 'UNCERTAIN'
      lastFusionConfidence?: number
      lastFeedbackProbability?: number
      lastReportDecision?: 'reported' | 'blocked'
      lastReportGate?: ReportGateId
      lastReportGateReason?: string
      lastReportFrequencyHz?: number
      lastReportTimestamp?: number
    },
  ) => void
  onEarlyWarningUpdate?: (pattern: CombPatternResult | null) => void
  onContentTypeUpdate?: (
    contentType: ContentType,
    isCompressed: boolean,
    compressionRatio: number,
  ) => void
  onReady?: () => void
  onError?: (message: string) => void
}

export interface DSPWorkerHandle {
  isReady: boolean
  isCrashed: boolean
  isPermanentlyDead: boolean
  getBackpressureStats: () => { dropped: number; total: number; ratio: number }
  getTransportStats: () => {
    outbound: number
    inbound: number
    tracksUpdates: number
    lastTracksPayloadBytes: number
    maxTracksPayloadBytes: number
  }
  init: (
    settings: WorkerRuntimeSettings,
    sampleRate: number,
    fftSize: number,
  ) => void
  updateSettings: (settings: Partial<WorkerRuntimeSettings>) => void
  processPeak: (
    peak: DetectedPeak,
    spectrum: Float32Array,
    sampleRate: number,
    fftSize: number,
    timeDomain?: Float32Array,
  ) => void
  sendSpectrumUpdate: (
    spectrum: Float32Array,
    crestFactor: number,
    sampleRate: number,
    fftSize: number,
  ) => void
  clearPeak: (binIndex: number, frequencyHz: number, timestamp: number) => void
  reset: () => void
  terminate: () => void
  syncFeedbackHistory: (hotspots: FeedbackHotspotSummary[]) => void
}

export interface PendingPeakFrame {
  peak: DetectedPeak
  spectrum: Float32Array
  sampleRate: number
  fftSize: number
  queuedAtMs: number
  timeDomain?: Float32Array
}

export interface PendingHistorySyncRequest {
  hotspots: FeedbackHotspotSummary[]
}

export interface WorkerInitSnapshot {
  settings: WorkerRuntimeSettings
  sampleRate: number
  fftSize: number
}
