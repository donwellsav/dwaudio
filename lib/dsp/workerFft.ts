/**
 * workerFft.ts — FFT processing + algorithm score computation
 *
 * Encapsulates the Radix-2 Cooley-Tukey FFT (for phase extraction),
 * MSD/Phase/Amplitude history buffers, and all algorithm score
 * computation.  Pure computational logic — no worker messaging.
 *
 * Extracted from dspWorker.ts (Batch 4) for maintainability.
 */

import {
  AmplitudeHistoryBuffer,
  PhaseHistoryBuffer,
  detectCombPattern,
  calculateSpectralFlatness,
  analyzeInterHarmonicRatio,
  calculatePTMR,
  detectContentType,
} from './advancedDetection'
import { TEMPORAL_ENVELOPE, MSD_CONSTANTS, MSD_SETTINGS } from './constants'
import type { AlgorithmScores } from './advancedDetection'
import { dbToLinearLut as dbToLinear } from './expLut'
import type { ContentType, DetectedPeak, Track, MSDResult } from '@/types/advisory'

// ── Extracted magic numbers ─────────────────────────────────────────────────

const SIDEBAND_NOISE_OFFSET_DB = 3
const SIDEBAND_NOISE_RANGE_DB = 9
const CONTENT_TYPE_SILENCE_RESET_FRAMES = 5

// ── Pure helper functions (exported for testability) ────────────────────────

/**
 * Compute noise sideband score for whistle discrimination.
 *
 * Whistles produce broadband breath noise in the sidebands around the main
 * frequency.  Feedback produces a clean spectral spike with sidebands at
 * noise floor.  Measures excess energy in near-sidebands (±5-15 bins)
 * relative to far-sidebands (±20-40 bins).
 *
 * @returns Score 0-1 where higher = more sideband noise (whistle-like)
 */
export function computeNoiseSidebandScore(spectrum: Float32Array, peakBin: number): number {
  const n = spectrum.length

  // Near sidebands (±5 to ±15 bins): breath noise characteristic region
  let nearPower = 0
  let nearCount = 0
  for (let offset = 5; offset <= 15; offset++) {
    if (peakBin + offset < n) { nearPower += dbToLinear(spectrum[peakBin + offset]); nearCount++ }
    if (peakBin - offset >= 0) { nearPower += dbToLinear(spectrum[peakBin - offset]); nearCount++ }
  }

  // Far sidebands (±20 to ±40 bins): reference "clean" spectral floor
  let farPower = 0
  let farCount = 0
  for (let offset = 20; offset <= 40; offset++) {
    if (peakBin + offset < n) { farPower += dbToLinear(spectrum[peakBin + offset]); farCount++ }
    if (peakBin - offset >= 0) { farPower += dbToLinear(spectrum[peakBin - offset]); farCount++ }
  }

  if (nearCount === 0 || farCount === 0) return 0

  const nearAvgDb = 10 * Math.log10(nearPower / nearCount)
  const farAvgDb = 10 * Math.log10(farPower / farCount)

  // Map: < 3 dB excess → 0, > 12 dB excess → 1.0
  const excessDb = nearAvgDb - farAvgDb
  return Math.max(0, Math.min(1, (excessDb - SIDEBAND_NOISE_OFFSET_DB) / SIDEBAND_NOISE_RANGE_DB))
}


function detectorMsdFallback(peak: DetectedPeak, spectrum: Float32Array, binIndex: number): MSDResult | null {
  if (peak.msd === undefined || !Number.isFinite(peak.msd) || peak.msd < 0) {
    return null
  }

  const feedbackScore = Math.max(0, Math.min(1, Math.exp(-peak.msd / MSD_CONSTANTS.THRESHOLD)))
  const sustainedFrameEstimate = Math.ceil((peak.sustainedMs ?? 0) / 20)
  const framesAnalyzed = Math.max(
    peak.persistenceFrames ?? 0,
    sustainedFrameEstimate,
    peak.msdFastConfirm ? MSD_SETTINGS.FAST_CONFIRM_FRAMES : 0,
    MSD_CONSTANTS.MIN_FRAMES_SPEECH,
  )

  return {
    msd: peak.msd,
    feedbackScore,
    secondDerivative: peak.msdGrowthRate ?? 0,
    isFeedbackLikely: peak.msdIsHowl === true || peak.msdFastConfirm === true || peak.msd < MSD_CONSTANTS.THRESHOLD,
    framesAnalyzed,
    meanMagnitudeDb: Number.isFinite(spectrum[binIndex]) ? spectrum[binIndex] : peak.trueAmplitudeDb,
  }
}

// ── Radix-2 FFT for Phase Extraction ────────────────────────────────────────
// Lightweight Cooley-Tukey FFT that runs in the worker thread.
// Applies Hann window → in-place FFT → extracts phase angles (atan2).
// Performance: O(N log N) ≈ 106K ops for N=8192, negligible at 50fps.

// Pre-allocated FFT buffers (reused across frames to avoid GC pressure)
let fftComplex: Float32Array | null = null
let fftHannWindow: Float32Array | null = null
let fftPhases: Float32Array | null = null
let fftBitRev: Uint32Array | null = null
let fftCurrentSize: number = 0

/**
 * Ensure all FFT buffers are allocated for the given transform size.
 * Called once per fftSize change (typically at init).
 */
function ensureFftBuffers(n: number): void {
  if (fftCurrentSize === n) return

  fftComplex = new Float32Array(n * 2)
  const numBins = n >>> 1
  fftPhases = new Float32Array(numBins)

  fftHannWindow = new Float32Array(n)
  const factor = 2 * Math.PI / (n - 1)
  for (let i = 0; i < n; i++) {
    fftHannWindow[i] = 0.5 * (1 - Math.cos(factor * i))
  }

  fftBitRev = new Uint32Array(n)
  const bits = Math.log2(n) | 0
  for (let i = 0; i < n; i++) {
    let rev = 0
    let v = i
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (v & 1)
      v >>>= 1
    }
    fftBitRev[i] = rev
  }

  fftCurrentSize = n
}

/**
 * Compute per-bin phase angles from time-domain waveform samples.
 *
 * Pipeline: Hann window → bit-reversal permutation → Radix-2 butterfly → atan2
 *
 * @param timeDomain - Raw waveform from AnalyserNode.getFloatTimeDomainData()
 * @returns Float32Array of phase angles in radians, length = N/2
 */
function computePhaseAngles(timeDomain: Float32Array): Float32Array | null {
  const N = timeDomain.length
  if (N < 64 || (N & (N - 1)) !== 0) return null

  ensureFftBuffers(N)
  const complex = fftComplex!
  const window = fftHannWindow!
  const bitRev = fftBitRev!
  const phases = fftPhases!

  // Step 1+2: Window + bit-reversal permutation in one pass
  for (let i = 0; i < N; i++) {
    const j = bitRev[i]
    complex[j * 2] = timeDomain[i] * window[i]
    complex[j * 2 + 1] = 0
  }

  // Step 3: Cooley-Tukey butterfly passes
  for (let size = 2; size <= N; size <<= 1) {
    const halfSize = size >>> 1
    const angle = -2 * Math.PI / size
    const wStepR = Math.cos(angle)
    const wStepI = Math.sin(angle)

    for (let start = 0; start < N; start += size) {
      let wR = 1
      let wI = 0

      for (let k = 0; k < halfSize; k++) {
        const evenIdx = (start + k) << 1
        const oddIdx = (start + k + halfSize) << 1

        const tR = wR * complex[oddIdx] - wI * complex[oddIdx + 1]
        const tI = wR * complex[oddIdx + 1] + wI * complex[oddIdx]

        complex[oddIdx] = complex[evenIdx] - tR
        complex[oddIdx + 1] = complex[evenIdx + 1] - tI
        complex[evenIdx] += tR
        complex[evenIdx + 1] += tI

        const newWR = wR * wStepR - wI * wStepI
        wI = wR * wStepI + wI * wStepR
        wR = newWR
      }
    }
  }

  // Step 4: Extract phase angles for bins 0..N/2-1
  const numBins = N >>> 1
  for (let i = 0; i < numBins; i++) {
    phases[i] = Math.atan2(complex[i * 2 + 1], complex[i * 2])
  }

  return phases
}

// ── Algorithm Engine ────────────────────────────────────────────────────────

export interface FrameStats {
  specMax: number
  rmsDb: number
}

export interface AlgorithmResult {
  algorithmScores: AlgorithmScores
  contentType: ContentType
}

function hashActivePeakFrequencies(activePeakFrequencies: number[]): number {
  let hash = 2166136261 ^ activePeakFrequencies.length
  for (let i = 0; i < activePeakFrequencies.length; i++) {
    hash ^= Math.round(activePeakFrequencies[i] * 10)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Encapsulates all algorithm history buffers and score computation.
 * Stateful — maintains MSD, phase, and amplitude histories across frames.
 */
export class AlgorithmEngine {
  private phaseBuffer: PhaseHistoryBuffer | null = null
  private ampBuffer = new AmplitudeHistoryBuffer()
  private lastFrameTimestamp: number = -1
  private specMax = -Infinity
  private rmsDb = -100
  private _lastFusedProb = 0.5
  /** Frame counter for phase skip cadence (0, 1, 2, 0, 1, 2, ...) */
  private _phaseFrameCounter = 0

  // ── Content-type authority (moved from main-thread feedbackDetector.ts) ─────
  private _ctEnergyBuffer = new Float32Array(TEMPORAL_ENVELOPE.BUFFER_SIZE)
  private _ctEnergyPos = 0
  private _ctEnergyFilled = false
  // Welford's online variance accumulators — O(1) per frame instead of O(n)
  private _ctWelfordCount = 0
  private _ctWelfordMean = 0
  private _ctWelfordM2 = 0
  private _ctSilentFrameCount = 0
  private _ctConsecutiveSilentFrames = 0
  // Fix 1: Circular buffer replaces push/shift — O(1) vs O(n)
  private _ctHistoryBuf: ContentType[] = new Array<ContentType>(10).fill('unknown')
  private _ctHistoryPos = 0
  private _ctHistoryFilled = false
  private static readonly CT_WINDOW = 10
  private _contentType: ContentType = 'unknown'
  private _instantContentType: ContentType = 'unknown'
  private _ctSilenceThresholdDb = -65
  private _ctIsCompressed = false
  private _ctCompressionRatio = 1
  private _compressionCacheFrameTimestamp = -1
  private _compressionCacheResult: AlgorithmScores['compression'] = null
  private _combCacheFrameTimestamp = -1
  private _combCacheHash = 0
  private _combCacheCount = 0
  private _combCacheResult: AlgorithmScores['comb'] = null

  /**
   * Update content-type classification from a periodic spectrum snapshot.
   * Includes temporal envelope analysis and majority-vote smoothing,
   * previously done on the main thread in feedbackDetector.ts.
   *
   * @returns True when the published content/compression state changed.
   */
  updateContentType(
    spectrum: Float32Array,
    crestFactor: number,
    sampleRateParam: number,
    fftSizeParam: number,
  ): boolean {
    const startBin = Math.max(1, Math.floor(150 * fftSizeParam / sampleRateParam))
    const endBin = Math.min(spectrum.length - 1, Math.ceil(10000 * fftSizeParam / sampleRateParam))
    let specMax = -Infinity
    let validBins = 0
    for (let i = startBin; i <= endBin; i++) {
      const v = spectrum[i]
      if (Number.isFinite(v)) {
        if (v > specMax) specMax = v
        validBins++
      }
    }

    const frameEnergyDb =
      validBins === 0 || !Number.isFinite(specMax)
        ? this._ctSilenceThresholdDb - 1
        : specMax
    const isSilent = validBins === 0 || frameEnergyDb <= this._ctSilenceThresholdDb

    // Write energy to temporal ring buffer + Welford's online variance (O(1) per frame)
    const bufSize = TEMPORAL_ENVELOPE.BUFFER_SIZE
    const writeIdx = this._ctEnergyPos % bufSize

    if (this._ctEnergyFilled) {
      // Ring buffer full — subtract the evicted sample from Welford accumulators
      const evicted = this._ctEnergyBuffer[writeIdx]
      // Reverse Welford: remove evicted sample (count stays constant)
      const n = this._ctWelfordCount
      const oldMean = this._ctWelfordMean
      const newMean = oldMean + (frameEnergyDb - evicted) / n
      // Update M2: add new sample's contribution, remove evicted sample's
      this._ctWelfordM2 += (frameEnergyDb - newMean) * (frameEnergyDb - oldMean)
        - (evicted - newMean) * (evicted - oldMean)
      if (this._ctWelfordM2 < 0) this._ctWelfordM2 = 0 // Clamp numerical drift
      this._ctWelfordMean = newMean
      // Update silent frame count
      if (evicted < this._ctSilenceThresholdDb) this._ctSilentFrameCount--
      if (isSilent) this._ctSilentFrameCount++
    } else {
      // Buffer filling — standard Welford add
      this._ctWelfordCount++
      const n = this._ctWelfordCount
      const delta = frameEnergyDb - this._ctWelfordMean
      this._ctWelfordMean += delta / n
      const delta2 = frameEnergyDb - this._ctWelfordMean
      this._ctWelfordM2 += delta * delta2
      if (isSilent) this._ctSilentFrameCount++
    }

    this._ctEnergyBuffer[writeIdx] = frameEnergyDb
    this._ctEnergyPos++
    if (this._ctEnergyPos >= bufSize) this._ctEnergyFilled = true

    if (isSilent) {
      this._ctConsecutiveSilentFrames++
      if (this._ctConsecutiveSilentFrames < CONTENT_TYPE_SILENCE_RESET_FRAMES) {
        return false
      }

      const prevContentType = this._contentType
      const prevCompressed = this._ctIsCompressed
      const prevCompressionRatio = this._ctCompressionRatio

      this._contentType = 'unknown'
      this._ctIsCompressed = false
      this._ctCompressionRatio = 1
      this.ampBuffer.reset()
      this._compressionCacheFrameTimestamp = -1
      this._compressionCacheResult = null
      this._resetContentTypeTracking()

      return (
        this._contentType !== prevContentType
        || this._ctIsCompressed !== prevCompressed
        || this._ctCompressionRatio !== prevCompressionRatio
      )
    }

    this._ctConsecutiveSilentFrames = 0

    // Read temporal metrics in O(1) from accumulators
    let temporalMetrics: { energyVariance: number; silenceGapRatio: number } | undefined
    const count = this._ctEnergyFilled ? bufSize : this._ctWelfordCount
    if (count >= TEMPORAL_ENVELOPE.MIN_FRAMES) {
      temporalMetrics = {
        energyVariance: this._ctWelfordM2 / count,
        silenceGapRatio: this._ctSilentFrameCount / count,
      }
    }

    const instantType = detectContentType(spectrum, crestFactor, temporalMetrics)
    this._instantContentType = instantType

    // Majority-vote smoothing via circular buffer — O(1) write, O(window) scan
    this._ctHistoryBuf[this._ctHistoryPos] = instantType
    this._ctHistoryPos = (this._ctHistoryPos + 1) % AlgorithmEngine.CT_WINDOW
    if (!this._ctHistoryFilled && this._ctHistoryPos === 0) this._ctHistoryFilled = true
    const histLen = this._ctHistoryFilled ? AlgorithmEngine.CT_WINDOW : this._ctHistoryPos
    const ctCounts: Record<string, number> = {}
    for (let ci = 0; ci < histLen; ci++) {
      const t = this._ctHistoryBuf[ci]
      if (t !== 'unknown') ctCounts[t] = (ctCounts[t] ?? 0) + 1
    }
    // Single-pass max instead of sort (4 content types → O(4) vs O(4 log 4) + allocation)
    let bestKey = ''
    let bestCount = 0
    for (const key in ctCounts) {
      if (ctCounts[key] > bestCount) { bestCount = ctCounts[key]; bestKey = key }
    }
    const prev = this._contentType
    const prevCompressed = this._ctIsCompressed
    const prevCompressionRatio = this._ctCompressionRatio
    this._contentType = bestKey && bestCount >= 3 ? bestKey as ContentType : (this._contentType ?? 'unknown')

    // Update compression status
    const compressionResult = this.ampBuffer.detectCompression()
    this._ctIsCompressed = compressionResult?.isCompressed ?? false
    this._ctCompressionRatio = compressionResult?.estimatedRatio ?? 1

    return (
      this._contentType !== prev
      || this._ctIsCompressed !== prevCompressed
      || this._ctCompressionRatio !== prevCompressionRatio
    )
  }

  /** Get the worker's authoritative content type. */
  getContentType(): ContentType { return this._contentType }
  /** Whether compressed audio is detected. */
  getIsCompressed(): boolean { return this._ctIsCompressed }
  /** Estimated compression ratio. */
  getCompressionRatio(): number { return this._ctCompressionRatio }

  private _resetContentTypeTracking(): void {
    this._ctEnergyBuffer.fill(this._ctSilenceThresholdDb - 1)
    this._ctEnergyPos = 0
    this._ctEnergyFilled = false
    this._ctWelfordCount = 0
    this._ctWelfordMean = 0
    this._ctWelfordM2 = 0
    this._ctSilentFrameCount = 0
    this._ctConsecutiveSilentFrames = 0
    this._ctHistoryBuf.fill('unknown')
    this._ctHistoryPos = 0
    this._ctHistoryFilled = false
    this._instantContentType = 'unknown'
  }

  /** Allocate buffers for the given FFT size. */
  init(fftSize: number): void {
    const numBins = Math.floor(fftSize / 2)
    this.phaseBuffer = new PhaseHistoryBuffer(numBins, 12)
    this.ampBuffer.reset()
    ensureFftBuffers(fftSize)
    this.lastFrameTimestamp = -1
    this._resetContentTypeTracking()
    this._contentType = 'unknown'
    this._ctIsCompressed = false
    this._ctCompressionRatio = 1
    this._compressionCacheFrameTimestamp = -1
    this._compressionCacheResult = null
    this._combCacheFrameTimestamp = -1
    this._combCacheHash = 0
    this._combCacheCount = 0
    this._combCacheResult = null
  }

  /**
   * Feed frame-level buffers (MSD, amplitude, phase).
   * Should be called once per peak, but only does work on new frames.
   *
   * @returns true if this was a new frame (first peak in this timestamp)
   */
  feedFrame(
    timestamp: number,
    spectrum: Float32Array,
    timeDomain: Float32Array | undefined,
    minFreq: number,
    maxFreq: number,
    sampleRate: number,
    fftSize: number,
    skipPhase: boolean = false,
  ): boolean {
    const isNewFrame = timestamp !== this.lastFrameTimestamp
    if (!isNewFrame) return false

    // MSD: no longer fed here — writes happen per-peak in computeScores()
    // (sparse model: only peak bins accumulate history, matching feedbackDetector.ts)

    // Compression: compute frame-level peak and RMS from spectrum
    const startBin = Math.max(1, Math.floor(minFreq * fftSize / sampleRate))
    const endBin = Math.min(spectrum.length - 1, Math.ceil(maxFreq * fftSize / sampleRate))
    this.specMax = -Infinity
    let sumLinearPower = 0
    let validBins = 0
    for (let i = startBin; i <= endBin; i++) {
      if (spectrum[i] > this.specMax) this.specMax = spectrum[i]
      sumLinearPower += dbToLinear(spectrum[i])
      validBins++
    }
    this.rmsDb = validBins > 0 ? 10 * Math.log10(sumLinearPower / validBins) : -100
    this.ampBuffer.addSample(this.specMax, this.rmsDb)
    this._compressionCacheFrameTimestamp = timestamp
    this._compressionCacheResult = this.ampBuffer.detectCompression()

    // Phase coherence: adaptive skip when MSD is decisive in MSD-led modes
    if (timeDomain && this.phaseBuffer) {
      this._phaseFrameCounter++
      if (!skipPhase) {
        const phases = computePhaseAngles(timeDomain)
        if (phases) {
          this.phaseBuffer.addFrame(phases)
        }
      }
      // On skip frames, phaseBuffer retains last-written frame — coherence score
      // uses existing history, which is at most 40ms stale (2 skipped × 20ms).
    }

    this.lastFrameTimestamp = timestamp
    return true
  }

  /**
   * Compute all algorithm scores for a given peak.
   * Requires `feedFrame()` to have been called for this frame first.
   */
  computeScores(
    peak: DetectedPeak,
    track: Track,
    spectrum: Float32Array,
    sampleRate: number,
    fftSize: number,
    activePeakFrequencies: number[],
  ): AlgorithmResult {
    const binIndex = peak.binIndex

    // Spectral flatness around the peak
    const spectralResult = calculateSpectralFlatness(spectrum, binIndex)

    // Inter-harmonic ratio
    const ihrResult = analyzeInterHarmonicRatio(spectrum, binIndex, sampleRate, fftSize)

    // Peak-to-median ratio
    const ptmrResult = calculatePTMR(spectrum, binIndex)

    // Return the latest unsmoothed content type as a scoring fallback while the
    // authoritative majority-vote state warms up. MSD keeps using the smoothed
    // state so an early music fallback does not add feedback-detection latency.
    const contentType = this._contentType !== 'unknown'
      ? this._contentType
      : this._instantContentType

    // The main detector owns the only MSD history. A second worker history ran
    // at the slower peak-refresh cadence and produced incompatible frame units.
    const msdResult = detectorMsdFallback(peak, spectrum, binIndex)

    // Compression detection
    let compressionResult = this._compressionCacheResult
    if (this._compressionCacheFrameTimestamp !== this.lastFrameTimestamp) {
      compressionResult = this.ampBuffer.detectCompression()
      this._compressionCacheFrameTimestamp = this.lastFrameTimestamp
      this._compressionCacheResult = compressionResult
    }

    // Comb filter pattern from active track frequencies
    let combResult: AlgorithmScores['comb'] = null
    if (activePeakFrequencies.length >= 3) {
      const frequencyHash = hashActivePeakFrequencies(activePeakFrequencies)
      const canReuseComb =
        this._combCacheFrameTimestamp === this.lastFrameTimestamp
        && this._combCacheHash === frequencyHash
        && this._combCacheCount === activePeakFrequencies.length

      if (canReuseComb) {
        combResult = this._combCacheResult
      } else {
        combResult = detectCombPattern(activePeakFrequencies, sampleRate)
        this._combCacheFrameTimestamp = this.lastFrameTimestamp
        this._combCacheHash = frequencyHash
        this._combCacheCount = activePeakFrequencies.length
        this._combCacheResult = combResult
      }
    } else {
      this._combCacheFrameTimestamp = this.lastFrameTimestamp
      this._combCacheHash = 0
      this._combCacheCount = activePeakFrequencies.length
      this._combCacheResult = null
    }

    // Noise sideband score for whistle discrimination
    const sidebandScore = computeNoiseSidebandScore(spectrum, binIndex)
    track.features.noiseSidebandScore = sidebandScore

    // Phase coherence for this specific peak bin
    const phaseResult = this.phaseBuffer?.calculateCoherence(binIndex) ?? null

    const algorithmScores: AlgorithmScores = {
      msd: msdResult,
      phase: phaseResult,
      spectral: spectralResult,
      comb: combResult,
      compression: compressionResult,
      ihr: ihrResult,
      ptmr: ptmrResult,
    }

    return { algorithmScores, contentType }
  }

  /**
   * Feed back the fusion result from the current frame for adaptive phase skipping.
   */
  updateLastFusion(probability: number): void {
    this._lastFusedProb = probability
  }

  /**
   * Determine if phase FFT should be skipped this frame.
   * Skip when: adaptive skip enabled AND mode is MSD-led AND MSD is decisive.
   * Never skip in liveMusic or worship (phase is the lead algorithm there).
   */
  shouldSkipPhase(adaptivePhaseSkip: boolean, mode: string): boolean {
    if (!adaptivePhaseSkip) return false
    if (mode === 'liveMusic' || mode === 'worship') return false
    const msdDecisive = this._lastFusedProb > 0.8 || this._lastFusedProb < 0.1
    if (!msdDecisive) return false
    return (this._phaseFrameCounter % 3) !== 0
  }

  reset(): void {
    this.phaseBuffer?.reset()
    this.ampBuffer.reset()
    this.lastFrameTimestamp = -1
    this._phaseFrameCounter = 0
    this.specMax = -Infinity
    this.rmsDb = -100
    this._lastFusedProb = 0.5
    this._resetContentTypeTracking()
    this._contentType = 'unknown'
    this._ctIsCompressed = false
    this._ctCompressionRatio = 1
    this._compressionCacheFrameTimestamp = -1
    this._compressionCacheResult = null
    this._combCacheFrameTimestamp = -1
    this._combCacheHash = 0
    this._combCacheCount = 0
    this._combCacheResult = null
  }
}
