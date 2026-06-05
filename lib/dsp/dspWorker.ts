/**
 * DSP Worker — thin orchestrator (runs off the main thread)
 *
 * Delegates DSP computation to focused modules:
 *   - AlgorithmEngine (workerFft.ts): FFT, MSD, phase, amplitude analysis
 *   - AdvisoryManager (advisoryManager.ts): advisory lifecycle, dedup, pruning
 *
 * This file owns:
 *   - Worker message dispatch (onmessage / postMessage)
 *   - Classification temporal smoothing (ring-buffer majority vote)
 *   - Fusion configuration from user settings
 *
 * Refactored from monolithic 935-line dspWorker.ts (Batch 4).
 */

import { TrackManager } from './trackManager'
import { classifyTrackWithAlgorithms, getReportGateDecision } from './classifier'
import { generateEQAdvisory, analyzeSpectralTrends } from './eqAdvisor'
import { fuseAlgorithmResults, buildFusionConfig, CombStabilityTracker, AgreementPersistenceTracker } from './advancedDetection'
import type { CombPatternResult, FusedDetectionResult, FusionConfig } from './advancedDetection'
import { AlgorithmEngine } from './workerFft'
import { AdvisoryManager } from './advisoryManager'
import type {
  Advisory,
  AlgorithmMode,
  ContentType,
  DetectedPeak,
  DetectorSettings,
  RecommendationContext,
  ReportGateId,
  TrackSummary,
} from '@/types/advisory'
import { DEFAULT_SETTINGS } from './constants'
import type { WorkerRuntimeSettings } from '@/lib/settings/runtimeSettings'
import {
  isWithinFeedbackHistoryTolerance,
  type FeedbackHotspotSummary,
} from './feedbackHistoryShared'

// ─── Message types ──────────────────────────────────────────────────────────

export type WorkerInboundMessage =
  | {
      type: 'init'
      settings: WorkerRuntimeSettings
      sampleRate: number
      fftSize: number
    }
  | {
      type: 'updateSettings'
      settings: Partial<WorkerRuntimeSettings>
    }
  | {
      type: 'syncFeedbackHistory'
      hotspots: FeedbackHotspotSummary[]
    }
  | {
      type: 'processPeak'
      peak: DetectedPeak
      spectrum: Float32Array
      sampleRate: number
      fftSize: number
      /** Optional time-domain samples for phase coherence analysis.
       *  Send via AnalyserNode.getFloatTimeDomainData() on the main thread. */
      timeDomain?: Float32Array
    }
  | {
      type: 'clearPeak'
      binIndex: number
      frequencyHz: number
      timestamp: number
    }
  | {
      type: 'reset'
    }
  // Periodic spectrum feed for content-type detection (independent of peak backpressure)
  | {
      type: 'spectrumUpdate'
      spectrum: Float32Array
      crestFactor: number
      sampleRate: number
      fftSize: number
    }

interface WorkerReportGateStatus {
  lastFusionVerdict?: FusedDetectionResult['verdict']
  lastFusionConfidence?: number
  lastFeedbackProbability?: number
  lastReportDecision?: 'reported' | 'blocked'
  lastReportGate?: ReportGateId
  lastReportGateReason?: string
  lastReportFrequencyHz?: number
  lastReportTimestamp?: number
}

export type WorkerOutboundMessage =
  | { type: 'advisory'; advisory: Advisory }
  | { type: 'advisoryCleared'; advisoryId: string }
  | ({ type: 'tracksUpdate'; tracks: TrackSummary[]; contentType?: ContentType; algorithmMode?: AlgorithmMode; isCompressed?: boolean; compressionRatio?: number } & WorkerReportGateStatus)
  | { type: 'combPatternUpdate'; pattern: CombPatternResult | null }
  | { type: 'returnBuffers'; spectrum: Float32Array; timeDomain?: Float32Array; source?: 'peak' | 'spectrumUpdate' }
  | { type: 'contentTypeUpdate'; contentType: ContentType; isCompressed: boolean; compressionRatio: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }

// ─── Worker state ────────────────────────────────────────────────────────────

let settings: DetectorSettings = { ...DEFAULT_SETTINGS }
let sampleRate = 48000
let fftSize = 8192
let peakProcessCount = 0
const REPORT_GATE_CLEAR_GRACE_MS = 1200

// ─── Cached FusionConfig (rebuilt only on settings change, not per-peak) ─────
let _cachedFusionConfig: FusionConfig | null = null

// ─── Per-cycle shelf cache (cross-advisory dedup) ────────────────────────────
// Shelves are broadband (global spectrum), not peak-specific. Computing once
// per analysis frame and sharing across all peaks avoids duplicate shelf arrays.
import type { ShelfRecommendation } from '@/types/advisory'
let cachedShelves: ShelfRecommendation[] | null = null
let cachedShelvesFrameId = -1

// ─── Worker-side status (sent to main thread via tracksUpdate) ───────────────
let lastContentType: ContentType = 'unknown'
let lastIsCompressed = false
let lastCompressionRatio = 1
let lastCombPattern: CombPatternResult | null = null
let feedbackHotspotSummaries: FeedbackHotspotSummary[] = []
let lastTracksUpdateFrameId = -1
let lastFusionVerdict: FusedDetectionResult['verdict'] | undefined = undefined
let lastFusionConfidence: number | undefined = undefined
let lastFeedbackProbability: number | undefined = undefined
let lastReportDecision: 'reported' | 'blocked' | undefined = undefined
let lastReportGate: ReportGateId | undefined = undefined
let lastReportGateReason: string | undefined = undefined
let lastReportFrequencyHz: number | undefined = undefined
let lastReportTimestamp: number | undefined = undefined

function clearReportGateStatus(): void {
  lastFusionVerdict = undefined
  lastFusionConfidence = undefined
  lastFeedbackProbability = undefined
  lastReportDecision = undefined
  lastReportGate = undefined
  lastReportGateReason = undefined
  lastReportFrequencyHz = undefined
  lastReportTimestamp = undefined
}

function findFeedbackHistorySummary(frequencyHz: number): FeedbackHotspotSummary | null {
  let bestMatch: FeedbackHotspotSummary | null = null
  let bestDistance = Infinity

  for (const hotspot of feedbackHotspotSummaries) {
    if (!isWithinFeedbackHistoryTolerance(frequencyHz, hotspot.centerFrequencyHz)) {
      continue
    }
    const distance = Math.abs(frequencyHz - hotspot.centerFrequencyHz)
    if (distance < bestDistance) {
      bestMatch = hotspot
      bestDistance = distance
    }
  }

  return bestMatch
}

function buildRecommendationContext(frequencyHz: number): RecommendationContext {
  const hotspot = findFeedbackHistorySummary(frequencyHz)
  if (!hotspot) {
    return { recurrenceCount: 0 }
  }

  return {
    recurrenceCount: hotspot.occurrences,
  }
}

function normalizeCombPattern(pattern: CombPatternResult | null | undefined): CombPatternResult | null {
  if (!pattern || !pattern.hasPattern || pattern.predictedFrequencies.length === 0) return null
  return {
    ...pattern,
    predictedFrequencies: [...pattern.predictedFrequencies],
  }
}

function combPatternEquals(a: CombPatternResult | null, b: CombPatternResult | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.hasPattern !== b.hasPattern) return false
  if (Math.round((a.fundamentalSpacing ?? 0) * 10) !== Math.round((b.fundamentalSpacing ?? 0) * 10)) return false
  if (Math.round((a.estimatedPathLength ?? 0) * 100) !== Math.round((b.estimatedPathLength ?? 0) * 100)) return false
  if (Math.round(a.confidence * 100) !== Math.round(b.confidence * 100)) return false
  if (a.predictedFrequencies.length !== b.predictedFrequencies.length) return false
  for (let i = 0; i < a.predictedFrequencies.length; i++) {
    if (Math.round(a.predictedFrequencies[i]) !== Math.round(b.predictedFrequencies[i])) return false
  }
  return true
}

function publishCombPattern(pattern: CombPatternResult | null | undefined): void {
  const normalized = normalizeCombPattern(pattern)
  if (combPatternEquals(lastCombPattern, normalized)) return
  lastCombPattern = normalized
  self.postMessage({ type: 'combPatternUpdate', pattern: normalized } satisfies WorkerOutboundMessage)
}

function publishTracksUpdate(force: boolean = false): void {
  if (!force && lastTracksUpdateFrameId === peakProcessCount) return
  lastTracksUpdateFrameId = peakProcessCount
  self.postMessage({
    type: 'tracksUpdate',
    tracks: trackManager.getActiveTrackSummaries(),
    contentType: lastContentType,
    algorithmMode: settings?.algorithmMode ?? 'auto',
    isCompressed: lastIsCompressed,
    compressionRatio: lastCompressionRatio,
    lastFusionVerdict,
    lastFusionConfidence,
    lastFeedbackProbability,
    lastReportDecision,
    lastReportGate,
    lastReportGateReason,
    lastReportFrequencyHz,
    lastReportTimestamp,
  } satisfies WorkerOutboundMessage)
}

// ─── Module instances ────────────────────────────────────────────────────────

const trackManager = new TrackManager()
const algorithmEngine = new AlgorithmEngine()
const advisoryManager = new AdvisoryManager()

/** Per-track comb stability trackers — prevents cross-peak contamination. */
const combTrackers = new Map<string, CombStabilityTracker>()
/** Per-track agreement persistence trackers — lift stable borderline feedback over time. */
const agreementTrackers = new Map<string, AgreementPersistenceTracker>()

/** Pre-allocated scratch array for active track frequencies — avoids .map() allocation per peak. */
const _peakFreqScratch: number[] = []

// ─── Classification temporal smoothing ──────────────────────────────────────
// Prevents advisory flickering by requiring N consistent classification frames
// before changing a track's label. Safety-critical RUNAWAY/GROWING bypass this.

const CLASSIFICATION_SMOOTHING_FRAMES = 3

interface LabelRingBuffer {
  labels: string[]
  idx: number
  count: number
}

const LABEL_HISTORY_CAPACITY = CLASSIFICATION_SMOOTHING_FRAMES * 3
const classificationLabelHistory = new Map<string, LabelRingBuffer>()
/** Reusable Map for majority-vote label smoothing — avoids per-call allocation */
const _labelVoteMap = new Map<string, number>()

/**
 * Smooth classification label via ring-buffer majority vote.
 * RUNAWAY and GROWING severities bypass smoothing — they're safety-critical.
 */
function smoothClassificationLabel(
  trackId: string,
  newLabel: string,
  severity: string
): string {
  if (severity === 'RUNAWAY' || severity === 'GROWING') {
    classificationLabelHistory.delete(trackId)
    return newLabel
  }

  let ring = classificationLabelHistory.get(trackId)
  if (!ring) {
    ring = { labels: new Array<string>(LABEL_HISTORY_CAPACITY), idx: 0, count: 0 }
    classificationLabelHistory.set(trackId, ring)
  }

  ring.labels[ring.idx] = newLabel
  ring.idx = (ring.idx + 1) % LABEL_HISTORY_CAPACITY
  ring.count = Math.min(ring.count + 1, LABEL_HISTORY_CAPACITY)

  if (ring.count < CLASSIFICATION_SMOOTHING_FRAMES) {
    return newLabel
  }

  // Majority vote over the most recent window
  // Reuse module-level Map to avoid per-call allocation (~60 calls/sec)
  const cap = LABEL_HISTORY_CAPACITY
  const windowSize = CLASSIFICATION_SMOOTHING_FRAMES
  _labelVoteMap.clear()
  for (let k = 0; k < windowSize; k++) {
    const label = ring.labels[(ring.idx - 1 - k + cap) % cap]
    _labelVoteMap.set(label, (_labelVoteMap.get(label) ?? 0) + 1)
  }

  let maxLabel = newLabel
  let maxCount = 0
  for (const [label, count] of _labelVoteMap) {
    if (count > maxCount) {
      maxCount = count
      maxLabel = label
    }
  }
  return maxLabel
}

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data

  try {
  switch (msg.type) {
    case 'init': {
      settings = { ...DEFAULT_SETTINGS, ...msg.settings }
      sampleRate = msg.sampleRate
      fftSize = msg.fftSize

      algorithmEngine.init(fftSize)
      trackManager.clear()
      combTrackers.clear()
      agreementTrackers.clear()
      advisoryManager.reset()
      classificationLabelHistory.clear()
      peakProcessCount = 0
      cachedShelves = null
      cachedShelvesFrameId = -1
      lastCombPattern = null
      lastTracksUpdateFrameId = -1
      clearReportGateStatus()

      self.postMessage({ type: 'ready' } satisfies WorkerOutboundMessage)
      break
    }

    case 'updateSettings': {
      settings = { ...settings, ...msg.settings }
      _cachedFusionConfig = null  // Invalidate — rebuilt on next processPeak
      if (msg.settings.maxTracks !== undefined || msg.settings.trackTimeoutMs !== undefined) {
        trackManager.updateOptions({
          maxTracks: msg.settings.maxTracks,
          trackTimeoutMs: msg.settings.trackTimeoutMs,
        })
      }
      break
    }

    case 'syncFeedbackHistory': {
      feedbackHotspotSummaries = [...msg.hotspots]
      break
    }

    case 'reset': {
      trackManager.clear()
      algorithmEngine.reset()
      advisoryManager.reset()
      combTrackers.clear()
      agreementTrackers.clear()
      classificationLabelHistory.clear()
      peakProcessCount = 0
      cachedShelves = null
      cachedShelvesFrameId = -1
      _cachedFusionConfig = null
      publishCombPattern(null)
      lastTracksUpdateFrameId = -1
      clearReportGateStatus()
      break
    }

    case 'spectrumUpdate': {
      const suSpectrum = msg.spectrum
      try {
        const stateChanged = algorithmEngine.updateContentType(
          suSpectrum, msg.crestFactor, msg.sampleRate, msg.fftSize
        )
        lastContentType = algorithmEngine.getContentType()
        lastIsCompressed = algorithmEngine.getIsCompressed()
        lastCompressionRatio = algorithmEngine.getCompressionRatio()
        if (stateChanged) {
          self.postMessage({
            type: 'contentTypeUpdate',
            contentType: lastContentType,
            isCompressed: lastIsCompressed,
            compressionRatio: lastCompressionRatio,
          } satisfies WorkerOutboundMessage)
        }
      } finally {
        if (suSpectrum.buffer.byteLength > 0) {
          self.postMessage(
            { type: 'returnBuffers', spectrum: suSpectrum, source: 'spectrumUpdate' } satisfies WorkerOutboundMessage,
            [suSpectrum.buffer as ArrayBuffer]
          )
        }
      }
      break
    }

    case 'processPeak': {
      // Guard: worker must be initialized before processing peaks
      if (!sampleRate || !fftSize) {
        break
      }
      const spectrum = msg.spectrum
      const timeDomain = msg.timeDomain
      try {
      const { peak, sampleRate: sr, fftSize: fft } = msg
      sampleRate = sr
      fftSize = fft

      // Validate frequency bounds
      const minFreq = settings.minFrequency ?? 200
      const maxFreq = settings.maxFrequency ?? 8000
      if (minFreq >= maxFreq) break

      // Process through track manager
      const track = trackManager.processPeak(peak)

      // Feed frame-level buffers (MSD, amplitude, phase — once per frame)
      const skipPhase = algorithmEngine.shouldSkipPhase(
        settings?.adaptivePhaseSkip ?? true,
        settings?.mode ?? 'speech',
      )
      const isNewFrame = algorithmEngine.feedFrame(
        peak.timestamp, spectrum, timeDomain,
        minFreq, maxFreq, sampleRate, fftSize,
        skipPhase,
      )

      if (isNewFrame) {
        peakProcessCount++

        // Periodic pruning (every 50 frames) — prevents unbounded growth
        if (peakProcessCount % 50 === 0) {
          const now = peak.timestamp
          advisoryManager.pruneBandCooldowns(now)

          // Prune classification label history and comb trackers for dead tracks
          // Uses trackManager.isActiveTrack() directly — avoids Set + .map() allocation
          for (const trackId of classificationLabelHistory.keys()) {
            if (!trackManager.isActiveTrack(trackId)) classificationLabelHistory.delete(trackId)
          }
          for (const trackId of combTrackers.keys()) {
            if (!trackManager.isActiveTrack(trackId)) combTrackers.delete(trackId)
          }
          for (const trackId of agreementTrackers.keys()) {
            if (!trackManager.isActiveTrack(trackId)) agreementTrackers.delete(trackId)
          }
        }

      }

      // Compute algorithm scores for this peak
      const activeTracks = trackManager.getRawTracks()
      _peakFreqScratch.length = 0
      for (let i = 0; i < activeTracks.length; i++) {
        _peakFreqScratch.push(activeTracks[i].trueFrequencyHz)
      }

      const algorithmResult = algorithmEngine.computeScores(
        peak, track, spectrum, sampleRate, fftSize, _peakFreqScratch
      )
      const { algorithmScores } = algorithmResult
      publishCombPattern(algorithmScores.comb ?? null)

      // Worker owns authoritative content type (S7 refactor: temporal metrics +
      // majority-vote smoothing now run in worker via spectrumUpdate).
      // algorithmResult.contentType is instantaneous (no temporal); use as fallback only.
      const contentType = algorithmEngine.getContentType() !== 'unknown'
        ? algorithmEngine.getContentType()
        : algorithmResult.contentType

      // Update worker-side status for UI
      lastContentType = contentType
      lastIsCompressed = algorithmScores.compression?.isCompressed ?? false
      lastCompressionRatio = algorithmScores.compression?.estimatedRatio ?? 1

      // Fuse algorithm results with user-selected mode (cached — rebuilt only on settings change)
      if (!_cachedFusionConfig) {
        _cachedFusionConfig = buildFusionConfig(settings)
      }
      // Get or create per-track comb stability tracker
      // Fix 13 (AI Fight Club): Cap at 256 entries to prevent unbounded growth during broadband transients
      let trackCst = combTrackers.get(track.id)
      if (!trackCst) {
        if (combTrackers.size >= 256) {
          // Emergency prune — remove entries not in active tracks
          for (const tid of combTrackers.keys()) {
            if (!trackManager.isActiveTrack(tid)) combTrackers.delete(tid)
          }
          // Hard cap — if prune didn't free enough (all active), reset to prevent unbounded growth
          if (combTrackers.size >= 300) combTrackers.clear()
        }
        trackCst = new CombStabilityTracker()
        combTrackers.set(track.id, trackCst)
      }
      let trackAgreement = agreementTrackers.get(track.id)
      if (!trackAgreement) {
        if (agreementTrackers.size >= 256) {
          for (const tid of agreementTrackers.keys()) {
            if (!trackManager.isActiveTrack(tid)) agreementTrackers.delete(tid)
          }
          if (agreementTrackers.size >= 300) agreementTrackers.clear()
        }
        trackAgreement = new AgreementPersistenceTracker()
        agreementTrackers.set(track.id, trackAgreement)
      }
      const fusionResult = fuseAlgorithmResults(
        algorithmScores, contentType, _cachedFusionConfig, track.trueFrequencyHz, trackCst,
        trackAgreement, undefined,
        { combSweepOverride: settings.combSweepOverride, ihrGateOverride: settings.ihrGateOverride, ptmrGateOverride: settings.ptmrGateOverride }
      )

      // Feed fusion probability back to the algorithm engine for adaptive phase skipping.
      algorithmEngine.updateLastFusion(fusionResult.feedbackProbability)

      // Classify track with full algorithm context
      const classification = classifyTrackWithAlgorithms(
        track, algorithmScores, fusionResult, settings, _peakFreqScratch
      )

      // Apply temporal smoothing (RUNAWAY/GROWING bypass automatically)
      const smoothedLabel = smoothClassificationLabel(
        track.id, classification.label, classification.severity
      )
      if (smoothedLabel !== classification.label) {
        classification.label = smoothedLabel as typeof classification.label
        // Remap severity to match the smoothed label — all label types must be handled
        if (smoothedLabel === 'WHISTLE') classification.severity = 'WHISTLE'
        else if (smoothedLabel === 'INSTRUMENT') classification.severity = 'INSTRUMENT'
        else if (smoothedLabel === 'ACOUSTIC_FEEDBACK') classification.severity = 'RESONANCE'
        else if (smoothedLabel === 'POSSIBLE_RING') classification.severity = 'POSSIBLE_RING'
      }

      const isHarmonic = advisoryManager.isHarmonicOfExisting(track.trueFrequencyHz, settings)
      if (isHarmonic) {
        classification.confidence = Math.min(classification.confidence, 0.35)
        if (classification.severity === 'RUNAWAY' || classification.severity === 'GROWING') {
          classification.severity = 'RESONANCE'
        }
        classification.reasons = [...classification.reasons, 'Harmonic of existing advisory']
      }

      const reportGate = getReportGateDecision(classification, settings)
      lastFusionVerdict = fusionResult.verdict
      lastFusionConfidence = fusionResult.confidence
      lastFeedbackProbability = fusionResult.feedbackProbability
      lastReportDecision = reportGate.shouldReport ? 'reported' : 'blocked'
      lastReportGate = reportGate.gate
      lastReportGateReason = reportGate.reason
      lastReportFrequencyHz = track.trueFrequencyHz
      lastReportTimestamp = peak.timestamp

      // Gate on reporting threshold
      if (!reportGate.shouldReport) {
        const graceMs = Math.max(settings.clearMs ?? 0, REPORT_GATE_CLEAR_GRACE_MS)
        const clearedId = advisoryManager.clearForTrackAfterReportGateMiss(
          track.id,
          peak.timestamp,
          graceMs,
        )
        if (clearedId) {
          self.postMessage({ type: 'advisoryCleared', advisoryId: clearedId } satisfies WorkerOutboundMessage)
        }
        publishTracksUpdate()
        break
      }

      // Flag harmonics of existing advisories — reduce confidence instead of suppressing.
      // This lets the soft floor system send them as shallow cuts if slots are available.
      // Compute shelves once per analysis frame (cross-advisory dedup)
      if (cachedShelvesFrameId !== peakProcessCount) {
        cachedShelves = analyzeSpectralTrends(spectrum, sampleRate, fftSize)
        cachedShelvesFrameId = peakProcessCount
      }

      // Generate EQ advisory with pre-computed shelves
      const recommendationContext = buildRecommendationContext(track.trueFrequencyHz)
      const eqAdvisory = generateEQAdvisory(
        track, classification.severity,
        settings.eqPreset,
        undefined,
        undefined,
        undefined,
        cachedShelves ?? [],
        recommendationContext,
      )

      // Create or update advisory (handles rate limit, band cooldown, dedup)
      const actions = advisoryManager.createOrUpdate(
        track, peak, classification, eqAdvisory, settings
      )

      // Attach algorithm scores and spectral profile to advisory actions
      for (const action of actions) {
        if (action.type === 'advisory') {
          action.advisory.algorithmScores = {
            msd: algorithmScores.msd?.feedbackScore ?? null,
            phase: algorithmScores.phase?.feedbackScore ?? null,
            spectral: algorithmScores.spectral?.feedbackScore ?? null,
            comb: algorithmScores.comb?.confidence ?? null,
            ihr: algorithmScores.ihr?.feedbackScore ?? null,
            ptmr: algorithmScores.ptmr?.feedbackScore ?? null,
            fusedProbability: fusionResult.feedbackProbability,
          }
          // Attach ±1 octave spectral profile around detection for smarter notch decisions
          if (spectrum && spectrum.length > 0) {
            const binHz = sampleRate / fftSize
            const centerBin = Math.round(track.trueFrequencyHz / binHz)
            const lowBin = Math.max(0, Math.round(track.trueFrequencyHz / 2 / binHz))
            const highBin = Math.min(spectrum.length - 1, Math.round(track.trueFrequencyHz * 2 / binHz))
            const profile: number[] = []
            const step = Math.max(1, Math.round((highBin - lowBin) / 32)) // max 32 samples
            for (let i = lowBin; i <= highBin; i += step) {
              profile.push(Math.round(spectrum[i] * 10) / 10)
            }
            action.advisory.spectralProfile = {
              lowHz: Math.round(lowBin * binHz),
              highHz: Math.round(highBin * binHz),
              peakHz: Math.round(centerBin * binHz),
              samples: profile,
              isHarmonic: isHarmonic || false,
            }
          }
        }
        self.postMessage(action satisfies WorkerOutboundMessage)
      }

      // Post tracks update if any advisory was created/updated
      if (actions.length > 0) {
        publishTracksUpdate()
      }

      break
      } finally {
        // Return pooled buffers to main thread via zero-copy transfer
        const returnList: ArrayBuffer[] = []
        if (spectrum.buffer.byteLength > 0) returnList.push(spectrum.buffer as ArrayBuffer)
        if (timeDomain && timeDomain.buffer.byteLength > 0) returnList.push(timeDomain.buffer as ArrayBuffer)
        if (returnList.length > 0) {
          self.postMessage(
            { type: 'returnBuffers', spectrum, timeDomain, source: 'peak' } satisfies WorkerOutboundMessage,
            returnList
          )
        }
      }
    }

    case 'clearPeak': {
      const { binIndex, frequencyHz, timestamp } = msg

      // Clear from track manager; advisoryManager handles the user clear cooldown.
      trackManager.clearTrack(binIndex, timestamp)
      trackManager.pruneInactiveTracks(timestamp)

      // Prune combTrackers for tracks that no longer exist
      for (const trackId of combTrackers.keys()) {
        if (!trackManager.getTrack(trackId)) combTrackers.delete(trackId)
      }
      for (const trackId of agreementTrackers.keys()) {
        if (!trackManager.getTrack(trackId)) agreementTrackers.delete(trackId)
      }
      if (trackManager.getRawTracks().length < 3) {
        publishCombPattern(null)
      }

      // Clear advisory by frequency (also sets band cooldown)
      const clearedId = advisoryManager.clearByFrequency(frequencyHz, timestamp)
      if (clearedId) {
        self.postMessage({ type: 'advisoryCleared', advisoryId: clearedId } satisfies WorkerOutboundMessage)
      }

      clearReportGateStatus()
      publishTracksUpdate(true)
      break
    }

    default: {
      // Exhaustiveness check — if a new WorkerInboundMessage variant is added
      // but not handled, TypeScript will error here at compile time.
      const _exhaustive: never = msg
      void _exhaustive
    }
  }
  } catch (err) {
    // Fix 6 (AI Fight Club): Use trueFrequencyHz (actual field name), not frequency.
    const peakCtx = msg.type === 'processPeak' && 'peak' in msg
      ? ` @ ${(msg as { peak?: { trueFrequencyHz?: number; binIndex?: number } }).peak?.trueFrequencyHz?.toFixed(1)}Hz bin=${(msg as { peak?: { trueFrequencyHz?: number; binIndex?: number } }).peak?.binIndex}`
      : ''
    self.postMessage({ type: 'error', message: `[${msg.type}${peakCtx}] ${err instanceof Error ? err.message : String(err)}` } satisfies WorkerOutboundMessage)
  }
}

export {}
