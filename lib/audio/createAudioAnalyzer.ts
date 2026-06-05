// DoneWell Audio Analyzer - Manages Web Audio API setup and analysis pipeline
// DSP post-processing (classification, EQ advisory) is offloaded to a Web Worker
// via AudioAnalyzerCallbacks.onPeakDetected / onPeakCleared wiring in useAudioAnalyzer.

import { FeedbackDetector } from '@/lib/dsp/feedbackDetector'
import { dbToLinearLut } from '@/lib/dsp/expLut'
import type { 
  Advisory, 
  DetectedPeak,
  SpectrumData,
  TrackedPeak,
} from '@/types/advisory'
import type { CombPatternResult } from '@/lib/dsp/advancedDetection'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
import type { AudioRuntimeSettings } from '@/lib/settings/runtimeSettings'

const EMPTY_POWER = new Float32Array(0)

export interface AudioAnalyzerCallbacks {
  onSpectrum?: (data: SpectrumData) => void
  /** Raw peak detected — route to DSP worker for classification */
  onPeakDetected?: (peak: DetectedPeak, spectrum: Float32Array, sampleRate: number, fftSize: number, timeDomain?: Float32Array) => void
  /** Periodic spectrum snapshot for worker content-type/compression detection (~100ms cadence) */
  onSpectrumUpdate?: (spectrum: Float32Array, crestFactor: number, sampleRate: number, fftSize: number) => void
  /** Peak cleared — route to DSP worker */
  onPeakCleared?: (peak: { binIndex: number; frequencyHz: number; timestamp: number }) => void
  /** Comb filter pattern detected — includes predicted feedback frequencies (early warning) */
  onCombPatternDetected?: (pattern: CombPatternResult) => void
  // Legacy callbacks kept for compatibility — now driven by worker results in useAudioAnalyzer
  onAdvisory?: (advisory: Advisory) => void
  onAdvisoryCleared?: (advisoryId: string) => void
  onTracksUpdate?: (tracks: TrackedPeak[]) => void
  onError?: (error: Error) => void
  onStateChange?: (isRunning: boolean) => void
}

export interface AudioAnalyzerState {
  isRunning: boolean
  hasPermission: boolean
  error: string | null
  noiseFloorDb: number | null
  sampleRate: number
  fftSize: number
  effectiveThresholdDb: number
}

export class AudioAnalyzer {
  private settings: Partial<AudioRuntimeSettings>
  private callbacks: AudioAnalyzerCallbacks
  private detector: FeedbackDetector
  
  private rafId: number = 0
  private lastSpectrumTime: number = 0
  private spectrumIntervalMs: number = 33 // ~30fps for spectrum display
  private lastSpectrumUpdateTime: number = 0
  private spectrumUpdateIntervalMs: number = 100 // ~10fps for content-type/compression detection

  private _isRunning: boolean = false
  private _hasPermission: boolean = false
  private _error: string | null = null

  constructor(
    settings: Partial<AudioRuntimeSettings> = {},
    callbacks: AudioAnalyzerCallbacks = {}
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.callbacks = callbacks

    this.detector = new FeedbackDetector({}, {
      onPeakDetected: (peak: DetectedPeak) => {
        // Route to worker via callback — spectrum + time-domain are read from detector
        const spectrum = this.detector.getSpectrum()
        const timeDomain = this.detector.getTimeDomain()
        const state = this.detector.getState()
        if (spectrum) {
          this.callbacks.onPeakDetected?.(peak, spectrum, state.sampleRate, state.fftSize, timeDomain ?? undefined)
        }
      },
      onPeakCleared: (peak) => {
        this.callbacks.onPeakCleared?.(peak)
      },
      // Comb filter pattern detection — early warning for predicted feedback frequencies
      onCombPatternDetected: (pattern) => {
        this.callbacks.onCombPatternDetected?.(pattern)
      },
    })

    // Apply initial settings via the mapping layer (DetectorSettings → AnalysisConfig)
    this.detector.updateSettings(this.settings)

    this.spectrumLoop = this.spectrumLoop.bind(this)
  }

  // ==================== Public API ====================

  async start(options: { deviceId?: string } = {}): Promise<void> {
    if (this._isRunning) return

    try {
      await this.detector.start({ deviceId: options.deviceId })
      this._isRunning = true
      this._hasPermission = true
      this._error = null

      // Start spectrum display loop
      this.lastSpectrumTime = 0
      this.rafId = requestAnimationFrame(this.spectrumLoop)

      this.callbacks.onStateChange?.(true)
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to start analyzer'
      this._hasPermission = false
      this.callbacks.onError?.(err instanceof Error ? err : new Error(this._error))
      throw err
    }
  }

  stop(options: { releaseMic?: boolean } = {}): void {
    this._isRunning = false

    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }

    this.detector.stop(options)
    this.callbacks.onStateChange?.(false)
  }

  updateSettings(settings: Partial<AudioRuntimeSettings>): void {
    Object.assign(this.settings, settings)
    this.detector.updateSettings(settings)
  }

  getState(): AudioAnalyzerState {
    const detectorState = this.detector.getState()
    return {
      isRunning: this._isRunning,
      hasPermission: this._hasPermission,
      error: this._error,
      noiseFloorDb: detectorState.noiseFloorDb,
      sampleRate: detectorState.sampleRate,
      fftSize: detectorState.fftSize,
      effectiveThresholdDb: detectorState.effectiveThresholdDb,
    }
  }

  getSpectrum(): Float32Array | null {
    return this.detector.getSpectrum()
  }

  // ==================== Private Methods ====================

  private spectrumLoop(timestamp: number): void {
    if (!this._isRunning) return

    // Throttle spectrum updates
    if (timestamp - this.lastSpectrumTime >= this.spectrumIntervalMs) {
      const spectrum = this.detector.getSpectrum()
      const state = this.detector.getState()

      if (spectrum) {
        const shouldSendSpectrumUpdate =
          timestamp - this.lastSpectrumUpdateTime >= this.spectrumUpdateIntervalMs
        const needsPeakScan = !Number.isFinite(state.rawPeakDb)
        const needsSpectrumStats = shouldSendSpectrumUpdate && state.isSignalPresent
        let sumLinear = 0
        let validBins = 0

        let peak = needsPeakScan
          ? -100
          : state.rawPeakDb

        if (needsPeakScan || needsSpectrumStats) {
          for (let i = 0; i < spectrum.length; i++) {
            const value = spectrum[i]
            if (needsPeakScan && value > peak) {
              peak = value
            }
            if (needsSpectrumStats && Number.isFinite(value)) {
              sumLinear += dbToLinearLut(value)
              validBins++
            }
          }
        }

        const spectrumData: SpectrumData = {
          freqDb: spectrum,
          power: EMPTY_POWER, // Not needed for display
          noiseFloorDb: state.noiseFloorDb,
          effectiveThresholdDb: state.effectiveThresholdDb,
          sampleRate: state.sampleRate,
          fftSize: state.fftSize,
          timestamp,
          peak,
          // Auto-gain state from FeedbackDetector
          autoGainEnabled: state.autoGainEnabled,
          autoGainDb: state.autoGainDb,
          autoGainLocked: state.autoGainLocked,
          rawPeakDb: state.rawPeakDb,
          // Advanced algorithm state is populated by the worker.
          algorithmMode: undefined,
          contentType: state.contentType,
          msdFrameCount: state.msdFrameCount,
          isCompressed: undefined,
          compressionRatio: undefined,
          isSignalPresent: state.isSignalPresent,
          lastConfirmLatencyMs: state.lastConfirmLatencyMs,
          lastPeakConfirmedAt: state.lastPeakConfirmedAt,
        }

        this.callbacks.onSpectrum?.(spectrumData)

        // S7: Periodic spectrum feed for worker content-type/compression detection.
        if (shouldSendSpectrumUpdate) {
          this.lastSpectrumUpdateTime = timestamp
          if (!state.isSignalPresent) {
            this.callbacks.onSpectrumUpdate?.(spectrum, 0, state.sampleRate, state.fftSize)
          } else if (validBins > 0 && peak > -100) {
            const rmsDb = 10 * Math.log10(sumLinear / validBins)
            const crestFactor = peak - rmsDb
            this.callbacks.onSpectrumUpdate?.(spectrum, crestFactor, state.sampleRate, state.fftSize)
          }
        }
      }

      this.lastSpectrumTime = timestamp
    }

    this.rafId = requestAnimationFrame(this.spectrumLoop)
  }

}

/**
 * Factory function for creating an audio analyzer
 */
export function createAudioAnalyzer(
  settings?: Partial<AudioRuntimeSettings>,
  callbacks?: AudioAnalyzerCallbacks
): AudioAnalyzer {
  return new AudioAnalyzer(settings, callbacks)
}
