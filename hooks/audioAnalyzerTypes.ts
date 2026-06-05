import type { AlgorithmMode, ContentType, ReportGateId } from '@/types/advisory'

export interface EarlyWarning {
  predictedFrequencies: number[]
  fundamentalSpacing: number | null
  estimatedPathLength: number | null
  confidence: number
  timestamp: number
}

export interface SpectrumStatus {
  peak: number
  autoGainDb?: number
  autoGainEnabled?: boolean
  autoGainLocked?: boolean
  algorithmMode?: AlgorithmMode
  contentType?: ContentType
  msdFrameCount?: number
  isCompressed?: boolean
  compressionRatio?: number
  isSignalPresent?: boolean
  rawPeakDb?: number
  effectiveThresholdDb?: number
  lastConfirmLatencyMs?: number
  lastPeakConfirmedAt?: number
  lastFusionVerdict?: 'FEEDBACK' | 'POSSIBLE_FEEDBACK' | 'NOT_FEEDBACK' | 'UNCERTAIN'
  lastFusionConfidence?: number
  lastFeedbackProbability?: number
  lastReportDecision?: 'reported' | 'blocked'
  lastReportGate?: ReportGateId
  lastReportGateReason?: string
  lastReportFrequencyHz?: number
  lastReportTimestamp?: number
}
