// DoneWell Audio Feedback Detector - Core DSP engine for peak detection
// Adapted from FeedbackDetector.js with TypeScript and enhancements

import { EXP_LUT, HARMONIC_SETTINGS, MSD_SETTINGS, PERSISTENCE_SCORING, MODE_PERSISTENCE_HIGH_MS, SIGNAL_GATE, HYSTERESIS } from './constants'
import {
  medianInPlace,
  quadraticInterpolation,
  clamp,
  isValidFftSize,
} from '@/lib/utils/mathHelpers'
import type { DetectedPeak, AnalysisConfig, DetectorSettings, AlgorithmMode, ContentType } from '@/types/advisory'
import { DEFAULT_CONFIG, DEFAULT_SMOOTHING_TIME_CONSTANT } from '@/types/advisory'
import type { CombPatternResult } from './advancedDetection'
import { MSDPool } from './msdPool'
import { computeAWeightingTable, computeAnalysisDbBounds } from './calibrationTables'
import { estimateQ as estimateQFn, calculatePHPR as calculatePHPRFn } from './frequencyAnalysis'
import { PersistenceTracker } from './persistenceScoring'
import { computeEffectiveThreshold, getMsdMinFramesForMode, classifyMsdResult, detectHarmonicRelationship, computeAdaptiveSustainMs } from './detectorUtils'

const HOLD_DECAY_RATE_MULTIPLIER = 2
const ACTIVE_PEAK_REFRESH_MS = 80

export interface FeedbackDetectorCallbacks {
  onPeakDetected?: (peak: DetectedPeak) => void
  onPeakCleared?: (peak: { binIndex: number; frequencyHz: number; timestamp: number }) => void
  onCombPatternDetected?: (pattern: CombPatternResult) => void
  onError?: (message: string) => void
}

/** Frame timing breakdown from performance.now() instrumentation (debug only) */
export interface PerfTimings {
  total: number   // Full analyze() call
  power: number   // Power/prefix sum loop (Math.exp / LUT)
  peaks: number   // Peak detection + MSD updates + registration
  msd: number     // Remaining (persistence + cleanup)
}

export interface FeedbackDetectorState {
  isRunning: boolean
  noiseFloorDb: number | null
  effectiveThresholdDb: number
  sampleRate: number
  fftSize: number
  // Auto-gain control
  autoGainEnabled: boolean
  autoGainDb: number // Current auto-computed gain in dB
  autoGainLocked: boolean // True when calibration is done and gain is frozen
  rawPeakDb: number // Pre-gain peak level in dBFS
  isSignalPresent: boolean // True when pre-gain signal is above silence threshold
  // Advanced algorithm state (populated by DSP pipeline)
  algorithmMode?: AlgorithmMode
  contentType?: ContentType
  msdFrameCount?: number
  isCompressed?: boolean
  compressionRatio?: number
  lastConfirmLatencyMs?: number
  lastPeakConfirmedAt?: number
  // Performance instrumentation (only populated when debugPerf is enabled)
  perfTimings?: PerfTimings | null
  // Computed persistence thresholds (frame-rate-independent, ms → frames at runtime)
  persistenceThresholds?: {
    minFrames: number
    highFrames: number
    veryHighFrames: number
    lowFrames: number
    historyFrames: number
  }
}

export class FeedbackDetector {
  // Configuration
  private config: AnalysisConfig
  private callbacks: FeedbackDetectorCallbacks

  // Web Audio
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private _deviceChangeHandler: (() => void) | null = null
  private _stateChangeHandler: (() => void) | null = null
  private analyser: AnalyserNode | null = null
  private startPromise: Promise<void> | null = null
  private startGeneration: number = 0

  // Preallocated buffers
  private freqDb: Float32Array<ArrayBuffer> | null = null
  private timeDomain: Float32Array<ArrayBuffer> | null = null // Raw waveform for phase coherence FFT
  private power: Float32Array | null = null
  private prefix: Float64Array | null = null
  private holdMs: Float32Array | null = null
  private deadMs: Float32Array | null = null
  private active: Uint8Array | null = null
  private activeHz: Float32Array | null = null
  private activePeakLastDispatchMs: Float32Array | null = null
  private candidateFirstSeenMs: Float64Array | null = null
  private activePeakConfirmedMs: Float64Array | null = null
  private activeBins: Uint32Array | null = null
  private activeBinPos: Int32Array | null = null
  private activeCount: number = 0
  
  // MSD (Magnitude Slope Deviation) — delegated to MSDPool (lib/dsp/msdPool.ts)
  // Pooled sparse allocation: 256 slots × 64 frames = 64KB. LRU eviction when full.
  private _msdPool: MSDPool | null = null
  // Per-frame MSD result cache — avoids duplicate calculateMsd() calls when
  // early detection and registration both need the same bin's MSD.
  // Uses generation counter instead of .clear() to invalidate stale entries (avoids Map rehash).
  private _msdResultCache: Map<number, { gen: number; msd: number; growthRate: number; isHowl: boolean; fastConfirm: boolean }> = new Map()
  private _msdCacheGen = 0
  private _fastConfirmCounts: Map<number, number> = new Map() // binIndex → consecutive low-MSD frames
  private msdMinFrames: number = MSD_SETTINGS.DEFAULT_MIN_FRAMES // Content-adaptive (synced with worker)

  // Peak Persistence Scoring — frame-rate-independent (ms-based constants → frame counts)
  // Tracks consecutive frames where a peak persists at the same frequency
  // Feedback = persistent (vertical streak), transient = short-lived
  private _persistenceTracker: PersistenceTracker | null = null

  // Frame-rate-independent persistence thresholds — computed from ms constants / analysisIntervalMs
  private _persistMinFrames = 5
  private _persistHighFrames = 15
  private _persistVeryHighFrames = 30
  private _persistLowFrames = 3
  private _persistHistoryFrames = 32

  // A-weighting lookup
  private aWeightingTable: Float32Array | null = null
  private aWeightingMinDb: number = 0
  private aWeightingMaxDb: number = 0

  // Analysis bounds
  private startBin: number = 1
  private endBin: number = 0
  private effectiveNb: number = 2

  // Noise floor
  private noiseFloorDb: number | null = null
  private noiseSampleIdx: Uint32Array | null = null
  private noiseSamples: Float32Array | null = null

  // Timing
  private isRunning: boolean = false
  private rafId: number = 0
  private lastRafTs: number = 0
  private lastAnalysisTs: number = 0
  private maxAnalysisGapMs: number = 120

  // Analysis bounds
  private analysisMinDb: number = -100
  private analysisMaxDb: number = 0

  // Harmonic detection — runtime override (set via updateSettings)
  private harmonicToleranceCents: number = HARMONIC_SETTINGS.TOLERANCE_CENTS

  // Low analyser smoothing keeps feedback frequency acquisition responsive.
  private smoothingTimeConstant: number = DEFAULT_SMOOTHING_TIME_CONSTANT

  // Auto-gain control — adjusts inputGainDb to keep signal in optimal detection range
  private _autoGainEnabled: boolean = false
  private _autoGainDb: number = 15 // Current auto-computed gain (starts at default)
  private _rawPeakDb: number = -100 // Pre-gain peak level (updated each frame)
  private _autoGainTargetDb: number = -18 // Target post-gain peak level (configurable, -18 = balanced headroom)
  private _autoGainMinDb: number = -10 // Min auto gain
  private _autoGainMaxDb: number = 30 // Max auto gain
  private _autoGainAttackCoeff: number = 0 // EMA attack (computed from sample rate)
  private _autoGainReleaseCoeff: number = 0 // EMA release (computed from sample rate)

  // Measure-then-lock: auto-gain calibrates for a short window, then freezes
  private _autoGainLocked: boolean = false // True once calibration is done and gain is frozen
  private _autoGainCalibrationStartMs: number = 0 // Timestamp when calibration began
  private _autoGainCalibrationMs: number = 3000 // Calibration window duration (3 seconds)
  private _autoGainSignalFrames: number = 0 // Frames with signal present during calibration

  // Signal presence gate — prevents auto-gain from amplifying silence into phantom peaks
  private _isSignalPresent: boolean = false
  private _silenceThresholdDb: number = SIGNAL_GATE.DEFAULT_SILENCE_THRESHOLD_DB
  private _lastConfirmLatencyMs: number | undefined = undefined
  private _lastPeakConfirmedAt: number | undefined = undefined

  // Hysteresis — recently cleared bins need extra dB to re-trigger (prevents flicker duplicates)
  private _recentlyClearedBins: Map<number, number> = new Map() // bin -> cleared timestamp
  private _analyzeCallCount: number = 0  // Frame counter for periodic housekeeping

  // Performance instrumentation — zero cost when disabled
  private _debugPerf: boolean = false
  private _perfTimings: PerfTimings | null = null

  // Advanced algorithm state — set externally by DSP pipeline, returned via getState()
  private _algorithmMode: AlgorithmMode | undefined = undefined
  private _contentType: ContentType | undefined = undefined
  // S7: Content-type detection moved to worker (temporal metrics + smoothing).
  // _contentType is now set externally via setAlgorithmState().
  private _msdFrameCount: number | undefined = undefined
  private _isCompressed: boolean | undefined = undefined
  private _compressionRatio: number | undefined = undefined

  constructor(config: Partial<AnalysisConfig> = {}, callbacks: FeedbackDetectorCallbacks = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.callbacks = callbacks
    this.maxAnalysisGapMs = Math.max(2 * this.config.analysisIntervalMs, 120)
    this.updateMsdMinFrames()
    this._recomputePersistenceFrames(this.config.analysisIntervalMs)
    this.rafLoop = this.rafLoop.bind(this)
  }

  // ==================== Public API ====================

  async start(options: { stream?: MediaStream; audioContext?: AudioContext; deviceId?: string } = {}): Promise<void> {
    if (this.isRunning) return
    if (this.startPromise) return this.startPromise

    const generation = ++this.startGeneration
    this.startPromise = this.startInternal(options, generation).finally(() => {
      if (this.startGeneration === generation) {
        this.startPromise = null
      }
    })
    return this.startPromise
  }

  private async startInternal(options: { stream?: MediaStream; audioContext?: AudioContext; deviceId?: string } = {}, generation: number): Promise<void> {
    if (this.audioContext?.state === 'closed') {
      this.audioContext = null
      this.analyser = null
    }

    // Initialize AudioContext
    if (!this.audioContext) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx && !options.audioContext) {
        throw new Error('Web Audio API not supported')
      }
      this.audioContext = options.audioContext || new Ctx()
    }

    // Get microphone stream
    if (options.stream) {
      this.stream = options.stream
    } else {
      if (this.stream && !this.hasLiveAudioTrack(this.stream)) {
        this.stream = null
      }

      if (!this.stream) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia not supported')
        }
        try {
          const acquiredStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          })
          if (!this.isCurrentStart(generation)) {
            this.releaseStream(acquiredStream)
            return
          }
          this.stream = acquiredStream
        } catch (e) {
          // Surface specific error messages for common getUserMedia failures
          if (e instanceof DOMException) {
            switch (e.name) {
              case 'NotAllowedError':
                throw new Error('Microphone permission denied. Please allow microphone access and try again.')
              case 'NotFoundError':
                throw new Error('No microphone found. Please connect a microphone and try again.')
              case 'NotReadableError':
                throw new Error('Microphone is in use by another application. Please close it and try again.')
              case 'OverconstrainedError':
                throw new Error('Microphone does not support the requested audio settings.')
            }
          }
          throw e
        }
        // Monitor mic disconnection — track end signals device removal
        const audioTrack = this.stream.getAudioTracks()[0]
        if (audioTrack) {
          audioTrack.onended = () => {
            if (this.isRunning) {
              this.callbacks.onError?.('Microphone disconnected')
              try {
                this.stop({ releaseMic: true })
              } catch {
                // stop() cleanup is best-effort — prevent cascade failure
                // from leaving dangling listeners or buffers
                this.isRunning = false
                this.stream = null
              }
            }
          }
        }
      }
    }

    // Create analyser
    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.minDecibels = -100
      this.analyser.maxDecibels = 0
    }
    // Always apply smoothingTimeConstant from settings (it may have changed)
    this.analyser.smoothingTimeConstant = this.smoothingTimeConstant

    // Set FFT size and allocate buffers
    this.setFftSize(this.config.fftSize)

    // Recalculate EMA coefficients for this audio context's frame rate
    this._recomputeEmaCoefficients(this.config.analysisIntervalMs)
    // Auto-gain state is NOT touched here — managed entirely by updateSettings()
    // when user clicks LOUD/MED/QUIET calibration buttons

    // Recompute ms-based persistence thresholds for this frame rate
    this._recomputePersistenceFrames(this.config.analysisIntervalMs)

    // Connect source (PASSIVE - no output routing)
    if (this.source) {
      try { this.source.disconnect() } catch {}
      this.source = null
    }
    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)

    // Resume context if needed
    if (this.audioContext.state !== 'running') {
      await this.audioContext.resume()
      if (!this.isCurrentStart(generation)) return
    }

    // Listen for device changes (mic unplugged/plugged)
    if (navigator.mediaDevices && !this._deviceChangeHandler) {
      this._deviceChangeHandler = () => {
        // Check if current stream's track is still alive
        const track = this.stream?.getAudioTracks()[0]
        if (track && track.readyState === 'ended' && this.isRunning) {
          this.callbacks.onError?.('Audio device changed — microphone disconnected')
          this.stop({ releaseMic: true })
        }
      }
      navigator.mediaDevices.addEventListener('devicechange', this._deviceChangeHandler)
    }

    // Auto-resume AudioContext if browser suspends it mid-session (common on mobile background)
    if (this.audioContext && !this._stateChangeHandler) {
      this._stateChangeHandler = () => {
        const ctx = this.audioContext
        if (!ctx || !this.isRunning) return
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {
            this.callbacks.onError?.('Audio context suspended — could not resume. Try restarting.')
          })
        } else if (ctx.state === 'closed') {
          // AudioContext is permanently closed (cannot be resumed) — stop analysis
          // and surface error so user can restart
          this.callbacks.onError?.('Audio context closed unexpectedly — tap Restart to resume analysis.')
          this.stop({ releaseMic: true })
          this.audioContext = null
          this.analyser = null
        }
      }
      this.audioContext.addEventListener('statechange', this._stateChangeHandler)
    }

    // Start analysis loop
    if (!this.isCurrentStart(generation)) return
    this.isRunning = true
    this.lastRafTs = 0
    this.lastAnalysisTs = 0
    this.rafId = requestAnimationFrame(this.rafLoop)
  }

  stop(options: { releaseMic?: boolean } = {}): void {
    this.startGeneration += 1
    this.startPromise = null
    this.isRunning = false

    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }

    this.lastRafTs = 0
    this.lastAnalysisTs = 0
    this.resetHistory()

    if (this.source) {
      try { this.source.disconnect() } catch {}
      this.source = null
    }

    if (options.releaseMic && this.stream) {
      this.releaseStream(this.stream)
      this.stream = null
    }

    // Clean up device change listener
    if (this._deviceChangeHandler) {
      navigator.mediaDevices?.removeEventListener('devicechange', this._deviceChangeHandler)
      this._deviceChangeHandler = null
    }

    // Clean up audio context suspension listener
    if (this._stateChangeHandler) {
      this.audioContext?.removeEventListener('statechange', this._stateChangeHandler)
      this._stateChangeHandler = null
    }
  }

  private hasLiveAudioTrack(stream: MediaStream): boolean {
    return stream.getAudioTracks().some((track) => track.readyState === 'live')
  }

  private isCurrentStart(generation: number): boolean {
    return this.startGeneration === generation
  }

  private releaseStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  // ==================== Configuration ====================

  setFftSize(fftSize: number): void {
    if (!isValidFftSize(fftSize)) {
      throw new Error('fftSize must be a power of two between 32 and 32768')
    }
    this.config.fftSize = fftSize

    if (this.analyser) {
      this.analyser.fftSize = fftSize
      this.allocateBuffers()
      this.resetHistory()
    }
  }

  updateConfig(config: Partial<AnalysisConfig>): void {
    const needsReset = 
      config.neighborhoodBins !== undefined ||
      config.minHz !== undefined ||
      config.maxHz !== undefined ||
      config.sustainMs !== undefined

    Object.assign(this.config, config)

    if (config.fftSize !== undefined) {
      this.setFftSize(config.fftSize)
    }

    if (config.analysisIntervalMs !== undefined) {
      this.maxAnalysisGapMs = Math.max(2 * this.config.analysisIntervalMs, 120)
      this._recomputePersistenceFrames(this.config.analysisIntervalMs)
      this._recomputeEmaCoefficients(this.config.analysisIntervalMs)
    }

    if (needsReset) {
      this.recomputeDerivedIndices()
      this.resetHistory()
    }

    if (config.aWeightingEnabled !== undefined) {
      this.recomputeAnalysisDbBounds()
      this.noiseFloorDb = null
      this.resetHistory()
    }

    if (config.mode !== undefined) {
      this.updateMsdMinFrames()
    }
  }

  /**
   * Updates settings from the UI DetectorSettings interface
   * Maps DetectorSettings to the internal AnalysisConfig
   */
  updateSettings(settings: Partial<DetectorSettings>): void {
    const mappedConfig: Partial<AnalysisConfig> = {}

    if (settings.fftSize !== undefined) {
      mappedConfig.fftSize = settings.fftSize
    }
    if (settings.minFrequency !== undefined) {
      mappedConfig.minHz = settings.minFrequency
    }
    if (settings.maxFrequency !== undefined) {
      mappedConfig.maxHz = settings.maxFrequency
    }
    if (settings.feedbackThresholdDb !== undefined) {
      mappedConfig.relativeThresholdDb = settings.feedbackThresholdDb
    }
    if (settings.eqPreset !== undefined) {
      mappedConfig.preset = settings.eqPreset
    }
    if (settings.mode !== undefined) {
      // Direct assignment - OperationMode now matches AnalysisConfig['mode']
      mappedConfig.mode = settings.mode
      // Update signal presence gate threshold for this mode
      this._silenceThresholdDb = SIGNAL_GATE.MODE_SILENCE_THRESHOLDS[settings.mode]
        ?? SIGNAL_GATE.DEFAULT_SILENCE_THRESHOLD_DB
    }
    if (settings.inputGainDb !== undefined) {
      mappedConfig.inputGainDb = settings.inputGainDb
      // When user manually sets gain, seed auto-gain from that value
      if (!this._autoGainEnabled) {
        this._autoGainDb = settings.inputGainDb
      }
    }
    if (settings.autoGainEnabled !== undefined) {
      this._autoGainEnabled = settings.autoGainEnabled
      mappedConfig.autoGainEnabled = settings.autoGainEnabled
      // When switching to auto, seed from current manual setting and restart calibration
      if (settings.autoGainEnabled) {
        this._autoGainDb = this.config.inputGainDb ?? 0
        this._autoGainLocked = false
        this._autoGainCalibrationStartMs = 0
        this._autoGainSignalFrames = 0
      }
    }
    if (settings.autoGainTargetDb !== undefined) {
      this._autoGainTargetDb = settings.autoGainTargetDb
    }
    if (settings.harmonicToleranceCents !== undefined) {
      this.harmonicToleranceCents = settings.harmonicToleranceCents
    }

    // Smoothing time constant - apply directly to analyser if it exists
    if (settings.smoothingTimeConstant !== undefined) {
      this.smoothingTimeConstant = settings.smoothingTimeConstant
      if (this.analyser) {
        this.analyser.smoothingTimeConstant = settings.smoothingTimeConstant
      }
    }

    // A-weighting (IEC 61672-1) - applies perceptual loudness curve
    if (settings.aWeightingEnabled !== undefined) {
      mappedConfig.aWeightingEnabled = settings.aWeightingEnabled
    }

    // Confidence threshold for filtering
    if (settings.confidenceThreshold !== undefined) {
      mappedConfig.confidenceThreshold = settings.confidenceThreshold
    }

    // Peak timing
    if (settings.sustainMs !== undefined) {
      mappedConfig.sustainMs = settings.sustainMs
    }
    if (settings.clearMs !== undefined) {
      mappedConfig.clearMs = settings.clearMs
    }

    // Threshold control
    if (settings.thresholdMode !== undefined) {
      mappedConfig.thresholdMode = settings.thresholdMode
    }
    // NOTE: AnalysisConfig.relativeThresholdDb is driven exclusively by
    // feedbackThresholdDb (the hero slider) mapped above — no separate UI control.
    if (settings.prominenceDb !== undefined) {
      mappedConfig.prominenceDb = settings.prominenceDb
    }

    // Noise floor timing
    if (settings.noiseFloorAttackMs !== undefined) {
      mappedConfig.noiseFloorAttackMs = settings.noiseFloorAttackMs
    }
    if (settings.noiseFloorReleaseMs !== undefined) {
      mappedConfig.noiseFloorReleaseMs = settings.noiseFloorReleaseMs
    }

    // Whistle suppression
    if (settings.ignoreWhistle !== undefined) {
      mappedConfig.ignoreWhistle = settings.ignoreWhistle
    }

    if (Object.keys(mappedConfig).length > 0) {
      this.updateConfig(mappedConfig)
    }
  }

  // ==================== Getters ====================

  getState(): FeedbackDetectorState {
    return {
      isRunning: this.isRunning,
      noiseFloorDb: this.noiseFloorDb,
      effectiveThresholdDb: this.computeEffectiveThresholdDb(),
      sampleRate: this.audioContext?.sampleRate ?? 48000,
      fftSize: this.config.fftSize,
      autoGainEnabled: this._autoGainEnabled,
      autoGainDb: Math.round(this._autoGainDb),
      autoGainLocked: this._autoGainLocked,
      rawPeakDb: this._rawPeakDb,
      isSignalPresent: this._isSignalPresent,
      algorithmMode: this._algorithmMode,
      contentType: this._contentType,
      msdFrameCount: this._msdFrameCount,
      isCompressed: this._isCompressed,
      compressionRatio: this._compressionRatio,
      lastConfirmLatencyMs: this._lastConfirmLatencyMs,
      lastPeakConfirmedAt: this._lastPeakConfirmedAt,
      perfTimings: this._debugPerf ? this._perfTimings : undefined,
      // Expose computed persistence thresholds for testing
      persistenceThresholds: {
        minFrames: this._persistMinFrames,
        highFrames: this._persistHighFrames,
        veryHighFrames: this._persistVeryHighFrames,
        lowFrames: this._persistLowFrames,
        historyFrames: this._persistHistoryFrames,
      },
    }
  }

  /** Enable/disable performance.now() instrumentation in analyze() */
  enablePerfDebug(enabled: boolean): void {
    this._debugPerf = enabled
    if (!enabled) this._perfTimings = null
  }

  /** Get latest frame timings (null when debug is off or no frames analyzed yet) */
  getPerfTimings(): PerfTimings | null {
    return this._perfTimings
  }

  setAlgorithmState(state: {
    algorithmMode?: AlgorithmMode
    contentType?: ContentType
    msdFrameCount?: number
    isCompressed?: boolean
    compressionRatio?: number
  }): void {
    if (state.algorithmMode !== undefined) this._algorithmMode = state.algorithmMode
    if (state.contentType !== undefined) this._contentType = state.contentType
    if (state.msdFrameCount !== undefined) this._msdFrameCount = state.msdFrameCount
    if (state.isCompressed !== undefined) this._isCompressed = state.isCompressed
    if (state.compressionRatio !== undefined) this._compressionRatio = state.compressionRatio
  }

  getSpectrum(): Float32Array | null {
    return this.freqDb
  }

  getTimeDomain(): Float32Array | null {
    return this.timeDomain
  }

  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 48000
  }

  binToFrequency(binIndex: number): number {
    const sr = this.getSampleRate()
    return (binIndex * sr) / this.config.fftSize
  }

  frequencyToBin(hz: number): number {
    const sr = this.getSampleRate()
    return Math.round((hz * this.config.fftSize) / sr)
  }

  // ==================== Internal Methods ====================

  private allocateBuffers(): void {
    if (!this.analyser) return

    const n = this.analyser.frequencyBinCount

    // Reuse buffers if already allocated at the correct size — avoids GC pressure
    // on repeated start/stop cycles. Only reallocate when FFT size changes.
    if (!this.freqDb || this.freqDb.length !== n) {
      this.freqDb = new Float32Array(n)
      this.power = new Float32Array(n)
      this.prefix = new Float64Array(n + 1)
      this.holdMs = new Float32Array(n)
      this.deadMs = new Float32Array(n)
      this.active = new Uint8Array(n)
      this.activeHz = new Float32Array(n)
      this.activePeakLastDispatchMs = new Float32Array(n)
      this.candidateFirstSeenMs = new Float64Array(n)
      this.activePeakConfirmedMs = new Float64Array(n)
      this.activeBins = new Uint32Array(n)
      this.activeBinPos = new Int32Array(n)
      this.aWeightingTable = new Float32Array(n)
      this._persistenceTracker = new PersistenceTracker(n)
      this._msdPool = new MSDPool(MSD_SETTINGS.POOL_SIZE, MSD_SETTINGS.HISTORY_SIZE)
    } else {
      // Same size — zero existing buffers instead of reallocating
      this.holdMs!.fill(0)
      this.deadMs!.fill(0)
      this.active!.fill(0)
      this.activeHz!.fill(0)
      this.activePeakLastDispatchMs!.fill(0)
      this.activeBins!.fill(0)
      this._msdPool?.reset()
      this._persistenceTracker?.reset()
    }

    // timeDomain uses fftSize (not frequencyBinCount)
    if (!this.timeDomain || this.timeDomain.length !== this.config.fftSize) {
      this.timeDomain = new Float32Array(this.config.fftSize)
    }

    this.activeBinPos!.fill(-1)
    this.candidateFirstSeenMs!.fill(-1)
    this.activePeakConfirmedMs!.fill(-1)
    this.activeCount = 0

    this.computeAWeightingTable()
    this.recomputeAnalysisDbBounds()

    this._fastConfirmCounts = new Map()
    
    this.noiseFloorDb = null
    this.recomputeDerivedIndices()
  }

  private resetHistory(): void {
    if (this.holdMs) this.holdMs.fill(0)
    if (this.deadMs) this.deadMs.fill(0)
    if (this.active) this.active.fill(0)
    if (this.activeHz) this.activeHz.fill(0)
    if (this.activePeakLastDispatchMs) this.activePeakLastDispatchMs.fill(0)
    if (this.candidateFirstSeenMs) this.candidateFirstSeenMs.fill(-1)
    if (this.activePeakConfirmedMs) this.activePeakConfirmedMs.fill(-1)
    if (this.activeBinPos) this.activeBinPos.fill(-1)
    this.activeCount = 0
    
    // Reset MSD pool and high-water mark
    this._msdPool?.reset()
    this._msdFrameCount = 0
    this._fastConfirmCounts.clear()
    this._contentType = undefined
    this._lastConfirmLatencyMs = undefined
    this._lastPeakConfirmedAt = undefined
    
    // Reset persistence scoring
    this._persistenceTracker?.reset()

    // Reset hysteresis state
    this._recentlyClearedBins.clear()
  }

  // S7: _writeEnergyBuffer() and _computeTemporalMetrics() removed.
  // Temporal envelope analysis now runs in the worker (AlgorithmEngine.updateContentType).

  private computeAWeightingTable(): void {
    const result = computeAWeightingTable(this.config.fftSize, this.getSampleRate(), this.config.aWeightingEnabled)
    if (this.aWeightingTable) this.aWeightingTable.set(result.table)
    this.aWeightingMinDb = result.minDb
    this.aWeightingMaxDb = result.maxDb
  }

  private recomputeAnalysisDbBounds(): void {
    const bounds = computeAnalysisDbBounds(
      this.config.aWeightingEnabled,
      this.aWeightingMinDb, this.aWeightingMaxDb,
    )
    this.analysisMinDb = bounds.analysisMinDb
    this.analysisMaxDb = bounds.analysisMaxDb
  }

  private recomputeDerivedIndices(): void {
    const n = this.freqDb?.length ?? 0
    if (!n) return

    const sr = this.getSampleRate()
    const fft = this.config.fftSize
    const hzToBin = (hz: number) => Math.round((hz * fft) / sr)

    let start = hzToBin(this.config.minHz)
    let end = hzToBin(this.config.maxHz)

    start = clamp(start, 0, n - 1)
    end = clamp(end, 0, n - 1)
    if (end < start) [start, end] = [end, start]

    // Clamp neighborhood bins
    const nbMax = Math.floor((n - 3) / 2)
    const nb = Math.max(4, Math.min(this.config.neighborhoodBins, nbMax))
    this.effectiveNb = nb

    // Ensure room for full neighborhoods with ±1 exclusion
    start = Math.max(start, nb)
    end = Math.min(end, n - 1 - nb)

    if (end < start) {
      this.startBin = 1
      this.endBin = 0
      this.noiseSampleIdx = new Uint32Array(0)
      this.noiseSamples = new Float32Array(0)
      return
    }

    this.startBin = start
    this.endBin = end

    // Precompute noise floor sample indices
    const range = end - start + 1
    const desired = Math.min(this.config.noiseFloorSampleCount, range)

    this.noiseSampleIdx = new Uint32Array(desired)
    this.noiseSamples = new Float32Array(desired)

    if (desired === 1) {
      this.noiseSampleIdx[0] = start
      return
    }

    const step = (range - 1) / (desired - 1)
    for (let i = 0; i < desired; i++) {
      const idx = start + Math.round(i * step)
      this.noiseSampleIdx[i] = clamp(idx, start, end)
    }
  }

  private rafLoop(timestamp: number): void {
    if (!this.isRunning) return

    const rafDt = this.lastRafTs === 0 ? 0 : timestamp - this.lastRafTs
    this.lastRafTs = timestamp

    // Guard against throttling (background tab)
    if (rafDt > this.maxAnalysisGapMs) {
      this.resetHistory()
      this.lastAnalysisTs = timestamp
    }

    if (this.lastAnalysisTs === 0) {
      this.lastAnalysisTs = timestamp
    }

    const since = timestamp - this.lastAnalysisTs
    if (since >= this.config.analysisIntervalMs) {
      try {
        this.analyze(timestamp, since)
      } catch (err) {
        // Don't let a single bad frame kill the RAF loop — log and continue
        this.callbacks.onError?.(`Analysis error: ${err instanceof Error ? err.message : String(err)}`)
      }
      this.lastAnalysisTs = timestamp
    }

    this.rafId = requestAnimationFrame(this.rafLoop)
  }

  private analyze(now: number, dt: number): void {
    const debugPerf = this._debugPerf
    const t0 = debugPerf ? performance.now() : 0

    const analyser = this.analyser
    const ctx = this.audioContext
    if (!analyser || !this.freqDb || !this.power || !this.prefix || !this.holdMs || !this.deadMs || !this.active) return
    if (!ctx || ctx.state !== 'running') return

    // Periodic housekeeping: prune stale cleared-bin entries every ~300 frames (~5s)
    if (++this._analyzeCallCount % 300 === 0) {
      const staleThreshold = now - this.config.clearMs * 2
      for (const [bin, ts] of this._recentlyClearedBins) {
        if (ts < staleThreshold) this._recentlyClearedBins.delete(bin)
      }
    }

    // Stage 1: Read spectrum, auto-gain, silence gate
    if (!this._measureSignalAndApplyGain(now, dt)) {
      if (this.config.noiseFloorEnabled) {
        this._buildPowerSpectrum()
        this.updateNoiseFloorDb(dt)
      }
      return
    }

    // Stage 2: Build power spectrum + prefix sums
    this._buildPowerSpectrum()

    const t1 = debugPerf ? performance.now() : 0

    // Stage 3: Noise floor + effective threshold
    if (this.config.noiseFloorEnabled) {
      this.updateNoiseFloorDb(dt)
    }
    const effectiveThresholdDb = this.computeEffectiveThresholdDb()
    if (this.endBin < this.startBin) return

    // Stage 4: Peak detection loop
    this._scanAndProcessPeaks(now, dt, effectiveThresholdDb)

    // Update MSD frame count for UI status display.
    // Use analysis call count (capped at history size) as readiness proxy —
    // the pool's maxFrameCount is unreliable because broadband signal causes
    // constant LRU eviction across 256 slots, keeping individual slot frame
    // counts near 1 even when the system has been analyzing for seconds.
    this._msdFrameCount = Math.min(this._analyzeCallCount, this._msdPool ? MSD_SETTINGS.HISTORY_SIZE : 0)

    // Content-type detection now handled by worker via spectrumUpdate messages.

    if (debugPerf) {
      const t3 = performance.now()
      this._perfTimings = {
        total: t3 - t0,
        power: t1 - t0,
        peaks: t3 - t1,
        msd: 0,
      }
    }
  }

  /**
   * Read spectrum data, apply auto-gain EMA, and gate on silence.
   * @returns `true` if signal is present and analysis should continue, `false` if silent.
   * @internal
   */
  private _measureSignalAndApplyGain(now: number, dt: number): boolean {
    if (!this.analyser || !this.freqDb) return false
    const analyser = this.analyser
    const freqDb = this.freqDb
    const n = freqDb.length

    // Read spectrum + time-domain waveform (phase coherence requires raw samples)
    analyser.getFloatFrequencyData(freqDb)
    if (this.timeDomain) {
      analyser.getFloatTimeDomainData(this.timeDomain)
    }

    // ── Shared raw peak scan — used by both auto-gain and manual modes ───
    // Single O(n) pass instead of duplicate scans in each branch.
    let rawPeak = -100
    const scanStart = this.startBin > 0 ? this.startBin : 1
    const scanEnd = this.endBin > 0 ? this.endBin : n - 1
    for (let i = scanStart; i <= scanEnd; i++) {
      const v = freqDb[i]
      if (Number.isFinite(v) && v > rawPeak) rawPeak = v
    }
    this._rawPeakDb = rawPeak
    this._isSignalPresent = rawPeak >= this._silenceThresholdDb

    // ── Auto-gain: EMA calibration using the shared rawPeak ──────────────
    if (this._autoGainEnabled) {
      // ── Measure-then-lock calibration ─────────────────────────────────
      // Once locked, skip all EMA updates — gain stays frozen at calibrated value
      if (!this._autoGainLocked) {
        // Start calibration timer on first frame with signal
        if (this._autoGainCalibrationStartMs === 0 && this._isSignalPresent) {
          this._autoGainCalibrationStartMs = now
        }

        // Only update EMA when signal is present (don't calibrate on silence)
        if (this._isSignalPresent) {
          this._autoGainSignalFrames++

          // Desired gain: shift rawPeak to target (-12 dBFS)
          const desiredGain = clamp(
            this._autoGainTargetDb - rawPeak,
            this._autoGainMinDb,
            this._autoGainMaxDb
          )

          // EMA smoothing: attack (gain decreasing = signal loud) is fast,
          // release (gain increasing = signal quiet) is slower
          const coeff = desiredGain > this._autoGainDb
            ? this._autoGainReleaseCoeff
            : this._autoGainAttackCoeff
          this._autoGainDb += coeff * (desiredGain - this._autoGainDb)
        }

        // Lock gain after calibration window if we got enough signal frames
        // Minimum 30 frames (~0.6s of actual signal) prevents locking on a blip
        if (this._autoGainCalibrationStartMs > 0) {
          const elapsed = now - this._autoGainCalibrationStartMs
          if (elapsed >= this._autoGainCalibrationMs && this._autoGainSignalFrames >= 30) {
            this._autoGainLocked = true
            // Round to integer dB for stable operation
            this._autoGainDb = Math.round(this._autoGainDb)
          }
        }
      }
    }

    // When no signal present, skip peak detection. Noise floor continues tracking.
    if (!this._isSignalPresent) {
      this._clearStalePeaksOnSilence(dt, now)
      return false
    }
    return true
  }

  /**
   * Compute power spectrum from freqDb, applying input gain and A-weighting.
   * Builds prefix sums for O(1) prominence averaging.
   * @internal
   */
  private _buildPowerSpectrum(): void {
    const freqDb = this.freqDb!
    const power = this.power!
    const prefix = this.prefix!
    const n = freqDb.length
    const analysisMinDb = this.analysisMinDb
    const analysisMaxDb = this.analysisMaxDb

    const useAWeighting = this.config.aWeightingEnabled && !!this.aWeightingTable
    const aTable = this.aWeightingTable

    // Use auto-gain when enabled, otherwise manual setting
    const inputGain = this._autoGainEnabled
      ? Math.round(this._autoGainDb) // Round to integer dB to avoid micro-jitter
      : (this.config.inputGainDb ?? 0)

    // Below-threshold skip: bins far below threshold contribute negligible power
    // to prominence averages. Skip LUT for them (saves 20-60% of lookups).
    // Uses previous frame's threshold (EMA-smoothed, changes slowly).
    const skipThreshold = this.computeEffectiveThresholdDb() - 12

    // Build power + prefix sums
    prefix[0] = 0
    for (let i = 0; i < n; i++) {
      let db = freqDb[i]
      const prefixValue = prefix[i]

      if (!Number.isFinite(db)) db = analysisMinDb

      // Apply software input gain
      db += inputGain

      // Apply A-weighting before clamping. Expanded analysis bounds account
      // for the weighting curve before the LUT guard below.
      if (useAWeighting && aTable) db += aTable[i]
      if (db < analysisMinDb) db = analysisMinDb
      else if (db > analysisMaxDb) db = analysisMaxDb

      freqDb[i] = db

      // Skip power computation for bins well below threshold — they can never
      // be peaks and contribute negligibly to neighborhood averages
      if (db < skipThreshold) {
        power[i] = 0
        prefix[i + 1] = prefixValue
        continue
      }

      // LUT replaces Math.exp(db * ln10/10) — 0.1dB quantization, ~3x faster
      const lutIdx = ((db + 100) * 10 + 0.5) | 0
      const p = EXP_LUT[lutIdx < 0 ? 0 : lutIdx > 1300 ? 1300 : lutIdx]
      power[i] = p
      prefix[i + 1] = prefixValue + p
    }
  }

  /**
   * Main peak detection loop: scans bins for local maxima that exceed the
   * effective threshold, computes prominence, manages hold/dead timers,
   * and delegates sustained peaks to `_registerPeak()`.
   * @internal
   */
  private _scanAndProcessPeaks(now: number, dt: number, effectiveThresholdDb: number): void {
    const freqDb = this.freqDb!
    const power = this.power!
    const prefix = this.prefix!
    const hold = this.holdMs!
    const dead = this.deadMs!
    const active = this.active!
    const nb = this.effectiveNb
    const start = this.startBin
    const end = this.endBin
    const prominenceThreshold = this.config.prominenceDb
    const clearMs = this.config.clearMs
    const sustainMs = this.config.sustainMs
    const msdWriteThreshold = effectiveThresholdDb - 9
    const reTriggerThreshold = effectiveThresholdDb + HYSTERESIS.RE_TRIGGER_DB
    const neighborhoodCount = 2 * nb - 4
    const hzPerBin = this.getSampleRate() / this.config.fftSize

    // Invalidate per-frame MSD cache via generation counter (avoids Map.clear() rehash)
    this._msdCacheGen++

    for (let i = start; i <= end; i++) {
      const peakDb = freqDb[i]
      const leftDb = freqDb[i - 1]
      const rightDb = freqDb[i + 1]

      // MSD: Always update magnitude history for active or candidate peaks
      // This enables early detection of growing feedback
      if (peakDb >= msdWriteThreshold) { // Track peaks within 6dB of threshold
        this._msdPool!.write(i, peakDb)
        this.updatePersistence(i, peakDb) // Phase 2: Also track persistence
      }

      // Local max check
      const isLocalMax = peakDb >= leftDb && peakDb >= rightDb && (peakDb > leftDb || peakDb > rightDb)
      let valid = isLocalMax && peakDb >= effectiveThresholdDb
      let prominence = -Infinity

      const freqHz = i * hzPerBin
      const earlyConfirmReductionDb = freqHz < 250 ? 10 : 8
      const earlyConfirmThreshold = effectiveThresholdDb - earlyConfirmReductionDb

      // MSD early detection: let a narrow near-miss through when temporal
      // evidence already looks like feedback. The old 4 dB rescue window was
      // too tight for real wedges/FOH rings that start just above the floor.
      if (!valid && isLocalMax && peakDb >= earlyConfirmThreshold) {
        const msdResult = this.calculateMsd(i)
        this._msdResultCache.set(i, { gen: this._msdCacheGen, ...msdResult })
        if (msdResult.isHowl || msdResult.fastConfirm) {
          valid = true
        }
      }

      // Hysteresis: recently cleared bins need extra dB to re-trigger (prevents flicker duplicates)
      if (valid && active[i] === 0) {
        const clearedAt = this._recentlyClearedBins.get(i)
        if (clearedAt !== undefined) {
          if ((now - clearedAt) < clearMs) {
            // Within cooldown — require extra dB
            if (peakDb < reTriggerThreshold) {
              valid = false
            }
          } else {
            // Cooldown expired — clean up
            this._recentlyClearedBins.delete(i)
          }
        }
      }

      if (valid) {
        // ±2 bin Blackman exclusion for neighborhood averaging
        const startNb = i - nb
        const endNbExcl = i + nb + 1

        // totalPower = sum(range) - power[i-2] - power[i-1] - power[i] - power[i+1] - power[i+2]
        // For ±2 exclusion as per spec
        let totalPower = prefix[endNbExcl] - prefix[startNb]
        totalPower -= power[i - 2] + power[i - 1] + power[i] + power[i + 1] + power[i + 2]

        if (totalPower < 0) totalPower = 0

        const avgPower = neighborhoodCount > 0 ? totalPower / neighborhoodCount : 0
        const avgDb = avgPower > 0 ? 10 * Math.log10(avgPower) : this.analysisMinDb

        prominence = peakDb - avgDb
        if (prominence < prominenceThreshold) valid = false
      }

      if (valid) {
        let timingMsdHint: { isHowl: boolean; fastConfirm: boolean } | null = null
        const cachedMsd = this._msdResultCache.get(i)
        if (cachedMsd && cachedMsd.gen === this._msdCacheGen) {
          timingMsdHint = { isHowl: cachedMsd.isHowl, fastConfirm: cachedMsd.fastConfirm }
        } else if (active[i] === 0) {
          const msdResult = this.calculateMsd(i)
          this._msdResultCache.set(i, { gen: this._msdCacheGen, ...msdResult })
          timingMsdHint = { isHowl: msdResult.isHowl, fastConfirm: msdResult.fastConfirm }
        }

        if (active[i] === 0 && this.candidateFirstSeenMs && this.candidateFirstSeenMs[i] < 0) {
          this.candidateFirstSeenMs[i] = now
        }

        hold[i] += dt
        dead[i] = 0

        const requiredSustainMs = computeAdaptiveSustainMs(sustainMs, freqHz, timingMsdHint)
        if (hold[i] >= requiredSustainMs && active[i] === 0) {
          this._registerPeak(i, now, prominence, effectiveThresholdDb)
        } else if (
          active[i] === 1 &&
          this.activePeakLastDispatchMs &&
          now - this.activePeakLastDispatchMs[i] >= ACTIVE_PEAK_REFRESH_MS
        ) {
          this._emitActivePeakUpdate(i, now, prominence, effectiveThresholdDb)
        }
      } else {
        hold[i] = Math.max(0, hold[i] - dt * HOLD_DECAY_RATE_MULTIPLIER)

        if (active[i] === 1) {
          dead[i] += dt

          if (dead[i] >= clearMs) {
            const clearedHz = this.activeHz?.[i] ?? this.binToFrequency(i)

            active[i] = 0
            dead[i] = 0

            // Remove from active list (swap-remove)
            if (this.activeBins && this.activeBinPos) {
              const pos = this.activeBinPos[i]
              if (pos >= 0) {
                const lastPos = this.activeCount - 1
                if (lastPos >= 0) {
                  const lastBin = this.activeBins[lastPos]
                  this.activeBins[pos] = lastBin
                  this.activeBinPos[lastBin] = pos
                  this.activeCount = lastPos
                }
                this.activeBinPos[i] = -1
              }
            }
            if (this.activeHz) this.activeHz[i] = 0
            if (this.activePeakLastDispatchMs) this.activePeakLastDispatchMs[i] = 0
            if (this.candidateFirstSeenMs) this.candidateFirstSeenMs[i] = -1
            if (this.activePeakConfirmedMs) this.activePeakConfirmedMs[i] = -1

            // Reset MSD history and fast confirm for this bin
            this._msdPool!.release(i)
            this._fastConfirmCounts.delete(i)

            // Also reset persistence for this bin
            this._persistenceTracker?.clearBin(i)

            // Record for hysteresis — recently cleared bins need extra dB to re-trigger
            this._recentlyClearedBins.set(i, now)

            this.callbacks.onPeakCleared?.({
              binIndex: i,
              frequencyHz: clearedHz,
              timestamp: now,
            })
          }
        } else {
          dead[i] = 0
          if (hold[i] <= 0 && this.candidateFirstSeenMs) {
            this.candidateFirstSeenMs[i] = -1
          }
        }
      }
    }
  }

  /**
   * Register a sustained peak: quadratic interpolation, harmonic detection,
   * Q estimation, MSD/persistence scoring, and callback dispatch.
   * Called from `_scanAndProcessPeaks()` when a bin sustains past `sustainMs`.
   * @internal
   */
  private _registerPeak(i: number, now: number, prominence: number, effectiveThresholdDb: number): void {
    const active = this.active!

    // Mark active
    active[i] = 1
    if (this.activeBins && this.activeBinPos) {
      const pos = this.activeCount
      this.activeBins[pos] = i
      this.activeBinPos[i] = pos
      this.activeCount = pos + 1
    }
    if (this.activePeakLastDispatchMs) {
      this.activePeakLastDispatchMs[i] = now
    }
    const firstSeenAt = this.candidateFirstSeenMs?.[i]
    const safeFirstSeenAt = firstSeenAt != null && firstSeenAt >= 0 ? firstSeenAt : now
    const confirmedAt = now
    const confirmLatencyMs = Math.max(0, confirmedAt - safeFirstSeenAt)
    if (this.activePeakConfirmedMs) {
      this.activePeakConfirmedMs[i] = confirmedAt
    }
    this._lastConfirmLatencyMs = confirmLatencyMs
    this._lastPeakConfirmedAt = confirmedAt
    this._dispatchPeak(
      i,
      now,
      prominence,
      effectiveThresholdDb,
      safeFirstSeenAt,
      confirmedAt,
    )
  }

  /**
   * Refresh an already-confirmed peak so downstream issue cards keep tracking
   * the current frequency/amplitude instead of waiting for clear + re-register.
   */
  private _emitActivePeakUpdate(i: number, now: number, prominence: number, effectiveThresholdDb: number): void {
    if (this.activePeakLastDispatchMs) {
      this.activePeakLastDispatchMs[i] = now
    }
    const firstSeenAt = this.candidateFirstSeenMs?.[i]
    const confirmedAt = this.activePeakConfirmedMs?.[i]
    this._dispatchPeak(
      i,
      now,
      prominence,
      effectiveThresholdDb,
      firstSeenAt != null && firstSeenAt >= 0 ? firstSeenAt : now,
      confirmedAt != null && confirmedAt >= 0 ? confirmedAt : now,
    )
  }

  private _dispatchPeak(
    i: number,
    now: number,
    prominence: number,
    effectiveThresholdDb: number,
    firstSeenAt: number,
    confirmedAt: number,
  ): void {
    const freqDb = this.freqDb!
    const hold = this.holdMs!
    const ctx = this.audioContext!
    const analyser = this.analyser!

    const peakDb = freqDb[i]
    const leftDb = freqDb[i - 1]
    const rightDb = freqDb[i + 1]

    // Quadratic interpolation for true peak
    const { delta, peak: trueAmplitudeDb } = quadraticInterpolation(leftDb, peakDb, rightDb)

    const sr = ctx.sampleRate
    const fft = analyser.fftSize
    const hzPerBin = sr / fft
    const trueFrequencyHz = (i + delta) * hzPerBin

    // ── Harmonic detection ─────────────────────────────────────────
    // Delegated to extracted pure function (cents-based tolerance)
    let harmonicRootHz: number | null = null
    let isSubHarmonicRoot = false

    if (this.activeBins && this.activeHz && this.activeCount > 0) {
      const result = detectHarmonicRelationship(
        trueFrequencyHz, this.activeBins, this.activeHz,
        this.activeCount, this.harmonicToleranceCents,
      )
      harmonicRootHz = result.harmonicRootHz
      isSubHarmonicRoot = result.isSubHarmonicRoot
    }

    if (this.activeHz) this.activeHz[i] = trueFrequencyHz

    // Q estimation via -3dB bandwidth
    const { qEstimate, bandwidthHz, qMeasurementMode } = this.estimateQ(i, trueAmplitudeDb, trueFrequencyHz)

    const peak: DetectedPeak = {
      binIndex: i,
      trueFrequencyHz,
      trueAmplitudeDb: clamp(trueAmplitudeDb, this.analysisMinDb, this.analysisMaxDb),
      prominenceDb: prominence,
      sustainedMs: hold[i],
      firstSeenAt,
      confirmedAt,
      confirmLatencyMs: Math.max(0, confirmedAt - firstSeenAt),
      harmonicOfHz: harmonicRootHz,
      isSubHarmonicRoot,
      timestamp: now,
      noiseFloorDb: this.noiseFloorDb,
      effectiveThresholdDb,
    }

    // Q estimation
    peak.qEstimate = qEstimate
    peak.bandwidthHz = bandwidthHz
    peak.qMeasurementMode = qMeasurementMode

    // PHPR (Peak-to-Harmonic Power Ratio) — feedback vs music discrimination
    peak.phpr = this.calculatePHPR(i)

    // MSD analysis for howl detection (reuse cached result from early detection if available)
    const cached = this._msdResultCache.get(i)
    const msdResult = (cached && cached.gen === this._msdCacheGen) ? cached : this.calculateMsd(i)
    peak.msd = msdResult.msd
    peak.msdGrowthRate = msdResult.growthRate
    peak.msdIsHowl = msdResult.isHowl
    peak.msdFastConfirm = msdResult.fastConfirm

    // Phase 2: Persistence scoring
    const persistenceResult = this.getPersistenceScore(i)
    peak.persistenceFrames = persistenceResult.frames
    peak.persistenceBoost = persistenceResult.boost
    peak.isPersistent = persistenceResult.isPersistent
    peak.isHighlyPersistent = persistenceResult.isHighlyPersistent

    this.callbacks.onPeakDetected?.(peak)
  }

  private estimateQ(
    binIndex: number,
    peakDb: number,
    trueFrequencyHz?: number,
  ): { qEstimate: number; bandwidthHz: number; qMeasurementMode: 'full' | 'mirrored' | 'defaulted' } {
    if (!this.freqDb) {
      return { qEstimate: 10, bandwidthHz: 100, qMeasurementMode: 'defaulted' }
    }
    return estimateQFn(this.freqDb, binIndex, peakDb, this.getSampleRate(), this.config.fftSize, trueFrequencyHz)
  }

  /**
   * Calculate PHPR — delegates to frequencyAnalysis.ts
   * @see calculatePHPR in frequencyAnalysis.ts for algorithm details
   */
  private calculatePHPR(freqBin: number): number | undefined {
    if (!this.freqDb) return undefined
    return calculatePHPRFn(this.freqDb, freqBin)
  }

  private updateNoiseFloorDb(dt: number): void {
    const idx = this.noiseSampleIdx
    const samples = this.noiseSamples
    if (!idx || !samples || idx.length === 0 || !this.freqDb) return

    const freqDb = this.freqDb

    // Gather samples
    for (let i = 0; i < idx.length; i++) {
      let db = freqDb[idx[i]]
      if (!Number.isFinite(db)) db = this.analysisMinDb
      db = clamp(db, this.analysisMinDb, this.analysisMaxDb)
      samples[i] = db
    }

    // Median estimation
    const estimateDb = medianInPlace(samples)

    if (this.noiseFloorDb === null) {
      this.noiseFloorDb = estimateDb
      return
    }

    // EMA update
    const tau = estimateDb > this.noiseFloorDb 
      ? this.config.noiseFloorAttackMs 
      : this.config.noiseFloorReleaseMs
    const alpha = 1 - Math.exp(-dt / tau)
    this.noiseFloorDb = this.noiseFloorDb + alpha * (estimateDb - this.noiseFloorDb)
  }

  private computeEffectiveThresholdDb(): number {
    return computeEffectiveThreshold(this.config, this.noiseFloorDb)
  }

  // ==================== MSD Algorithm (DAFx-16) ====================

  /**
   * Update msdMinFrames based on operation mode.
   * Maps detector modes to DAFx-16 content categories so the main-thread
   * min frames stay ≤ the worker's content-adaptive min frames.
   * Called from constructor and updateConfig/updateSettings when mode changes.
   */
  private updateMsdMinFrames(): void {
    this.msdMinFrames = getMsdMinFramesForMode(this.config.mode)
  }

  /**
   * Calculate Magnitude Slope Deviation (MSD) for a frequency bin.
   *
   * Delegates to MSDPool for the core second-derivative computation, then
   * applies the energy gate and fast-confirm classification logic locally.
   *
   * MSD measures how consistently the magnitude grows over time (DAFx-16).
   * Low MSD ≈ feedback (constant trajectory). High MSD ≈ music/speech.
   *
   * @returns MSD value (lower = more likely feedback). -1 if not enough history.
   */
  private calculateMsd(binIndex: number): { msd: number; growthRate: number; isHowl: boolean; fastConfirm: boolean } {
    if (!this._msdPool) {
      return { msd: -1, growthRate: 0, isHowl: false, fastConfirm: false }
    }

    // MINIMUM ENERGY GUARD (DAFx-16 Section 3):
    // Prevent MSD from triggering on quiet noise floor fluctuations.
    if (this.noiseFloorDb !== null && this.freqDb) {
      const currentDb = this.freqDb[binIndex]
      const energyAboveNoise = currentDb - this.noiseFloorDb
      const minEnergyAboveNoiseDb =
        this.config.mode === 'monitors'
          ? 3
          : this.config.mode === 'speech' || this.config.mode === 'broadcast'
            ? 4
            : 5
      if (energyAboveNoise < minEnergyAboveNoiseDb) {
        return { msd: 999, growthRate: 0, isHowl: false, fastConfirm: false }
      }
    }

    const raw = this._msdPool.getMSD(binIndex, this.msdMinFrames)
    if (raw.msd < 0) {
      return { msd: -1, growthRate: 0, isHowl: false, fastConfirm: false }
    }

    // Delegate howl/fast-confirm classification to extracted pure function
    const { classification, newFastConfirmCount } = classifyMsdResult(
      raw.msd, raw.growthRate, this._fastConfirmCounts.get(binIndex) ?? 0,
    )
    if (newFastConfirmCount > 0) {
      this._fastConfirmCounts.set(binIndex, newFastConfirmCount)
    } else {
      this._fastConfirmCounts.delete(binIndex)
    }

    return classification
  }
  
  /**
   * When signal gate closes, continue aging active peaks so they clear properly.
   * Prevents ghost advisories from persisting during silence.
   */
  private _clearStalePeaksOnSilence(dt: number, now?: number): void {
    const active = this.active
    const dead = this.deadMs
    if (!active || !dead) return

    for (let i = 0; i < active.length; i++) {
      if (active[i] === 1) {
        dead[i] += dt
        if (dead[i] >= this.config.clearMs) {
          const clearedHz = this.activeHz?.[i] ?? this.binToFrequency(i)

          active[i] = 0
          dead[i] = 0
          if (this.holdMs) this.holdMs[i] = 0

          // Remove from active list (swap-remove)
          if (this.activeBins && this.activeBinPos) {
            const pos = this.activeBinPos[i]
            if (pos >= 0) {
              const lastPos = this.activeCount - 1
              if (lastPos >= 0) {
                const lastBin = this.activeBins[lastPos]
                this.activeBins[pos] = lastBin
                this.activeBinPos[lastBin] = pos
                this.activeCount = lastPos
              }
              this.activeBinPos[i] = -1
            }
          }
          if (this.activeHz) this.activeHz[i] = 0
          if (this.activePeakLastDispatchMs) this.activePeakLastDispatchMs[i] = 0
          if (this.candidateFirstSeenMs) this.candidateFirstSeenMs[i] = -1
          if (this.activePeakConfirmedMs) this.activePeakConfirmedMs[i] = -1

          this._msdPool?.release(i)
          this._fastConfirmCounts.delete(i)
          this._persistenceTracker?.clearBin(i)

          this.callbacks.onPeakCleared?.({
            binIndex: i,
            frequencyHz: clearedHz,
            timestamp: now ?? performance.now(),
          })
        }
      }
    }
  }

  // ==================== Persistence Scoring (Phase 2) ====================

  /**
   * Recompute frame-based persistence thresholds from ms constants.
   * Called when analysisIntervalMs changes (initAudioContext, updateConfig).
   */
  private _recomputePersistenceFrames(intervalMs: number): void {
    const mode = this.config?.mode ?? 'speech'
    this._persistenceTracker?.recomputeFrameThresholds(intervalMs, mode)
    // Keep local fields in sync for getState() exposure
    const highMs = MODE_PERSISTENCE_HIGH_MS[mode] ?? PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS
    const veryHighMs = highMs * 2
    this._persistMinFrames = Math.ceil(PERSISTENCE_SCORING.MIN_PERSISTENCE_MS / intervalMs)
    this._persistHighFrames = Math.ceil(highMs / intervalMs)
    this._persistVeryHighFrames = Math.ceil(veryHighMs / intervalMs)
    this._persistLowFrames = Math.ceil(PERSISTENCE_SCORING.LOW_PERSISTENCE_MS / intervalMs)
    this._persistHistoryFrames = Math.ceil(PERSISTENCE_SCORING.HISTORY_MS / intervalMs)
  }

  /**
   * Recompute auto-gain EMA attack/release coefficients from the analysis interval.
   * Attack (0.3s tau) responds fast to loud signals; release (1.0s tau) decays slowly.
   * Called from start() and updateConfig() when analysisIntervalMs changes.
   */
  private _recomputeEmaCoefficients(intervalMs: number): void {
    const fps = 1000 / intervalMs
    this._autoGainAttackCoeff = 1 - Math.exp(-1 / (0.3 * fps))
    this._autoGainReleaseCoeff = 1 - Math.exp(-1 / (1.0 * fps))
  }

  /**
   * Update persistence count for a frequency bin
   * Tracks consecutive frames where a peak persists at similar amplitude
   */
  /** Delegate to PersistenceTracker */
  private updatePersistence(binIndex: number, amplitudeDb: number): void {
    this._persistenceTracker?.update(binIndex, amplitudeDb)
  }

  /** Delegate to PersistenceTracker */
  private getPersistenceScore(binIndex: number): {
    frames: number
    boost: number
    penalty: number
    isPersistent: boolean
    isHighlyPersistent: boolean
    isVeryHighlyPersistent: boolean
  } {
    if (!this._persistenceTracker) {
      return { frames: 0, boost: 0, penalty: 0, isPersistent: false, isHighlyPersistent: false, isVeryHighlyPersistent: false }
    }
    return this._persistenceTracker.getScore(binIndex)
  }
}
