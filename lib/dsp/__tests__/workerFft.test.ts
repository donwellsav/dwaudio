import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmEngine } from '../workerFft'
import { AmplitudeHistoryBuffer } from '../advancedDetection'
import type { DetectedPeak, Track } from '@/types/advisory'

const SAMPLE_RATE = 48000
const FFT_SIZE = 128
const CONTENT_TYPE_RESET_SILENCE_FRAMES = 5

function makeSpectrum(length: number, peakBin: number, peakDb: number): Float32Array {
  const spectrum = new Float32Array(length)
  spectrum.fill(-90)
  spectrum[peakBin] = peakDb
  if (peakBin > 0) spectrum[peakBin - 1] = peakDb - 8
  if (peakBin + 1 < length) spectrum[peakBin + 1] = peakDb - 8
  return spectrum
}

function makeFlatSpectrum(length: number, db: number): Float32Array {
  const spectrum = new Float32Array(length)
  spectrum.fill(db)
  return spectrum
}

function makeSilentSpectrum(length: number): Float32Array {
  const spectrum = new Float32Array(length)
  spectrum.fill(-Infinity)
  return spectrum
}

function makeMusicSpectrum(length: number): Float32Array {
  const spectrum = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const normFreq = i / length
    spectrum[i] = -35 - normFreq * 15
  }
  return spectrum
}

function makePeak(binIndex: number, timestamp: number): DetectedPeak {
  return {
    binIndex,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -24,
    prominenceDb: 14,
    sustainedMs: 240,
    harmonicOfHz: null,
    timestamp,
    noiseFloorDb: -90,
    effectiveThresholdDb: -50,
  }
}

function makeTrack(binIndex: number): Track {
  return {
    id: `track-${binIndex}`,
    binIndex,
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -24,
    prominenceDb: 14,
    onsetTime: 1000,
    onsetDb: -28,
    lastUpdateTime: 1000,
    history: [],
    features: {
      stabilityCentsStd: 0,
      meanQ: 12,
      minQ: 12,
      meanVelocityDbPerSec: 0,
      maxVelocityDbPerSec: 0,
      persistenceMs: 0,
      harmonicityScore: 0,
      modulationScore: 0,
      noiseSidebandScore: 0,
    },
    qEstimate: 12,
    bandwidthHz: 90,
    velocityDbPerSec: 0,
    harmonicOfHz: null,
    isSubHarmonicRoot: false,
    isActive: true,
  }
}

describe('AlgorithmEngine compression caching', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reuses compression analysis for multiple peaks in the same frame', () => {
    const detectCompressionSpy = vi.spyOn(AmplitudeHistoryBuffer.prototype, 'detectCompression')
    const engine = new AlgorithmEngine()
    engine.init(128)

    const firstSpectrum = makeSpectrum(64, 10, -20)
    const secondSpectrum = makeSpectrum(64, 12, -18)

    engine.feedFrame(1000, firstSpectrum, undefined, 150, 10000, 48000, 128)
    const firstResult = engine.computeScores(makePeak(10, 1000), makeTrack(10), firstSpectrum, 48000, 128, [])
    engine.computeScores(makePeak(12, 1000), makeTrack(12), secondSpectrum, 48000, 128, [])

    expect(detectCompressionSpy).toHaveBeenCalledTimes(1)
    expect(firstResult.algorithmScores.compression).toBeNull()

    engine.feedFrame(1020, firstSpectrum, undefined, 150, 10000, 48000, 128)
    engine.computeScores(makePeak(10, 1020), makeTrack(10), firstSpectrum, 48000, 128, [])

    expect(detectCompressionSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps content/compression state across short silent gaps and clears after sustained silence', () => {
    const engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)

    const compressedSpectrum = makeFlatSpectrum(64, -40)
    const silentSpectrum = makeSilentSpectrum(64)

    for (let timestamp = 1000; timestamp < 1200; timestamp += 20) {
      engine.feedFrame(timestamp, compressedSpectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
    }

    expect(engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)).toBe(true)
    expect(engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)).toBe(false)
    expect(engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)).toBe(true)
    expect(engine.getContentType()).toBe('compressed')
    expect(engine.getIsCompressed()).toBe(true)
    expect(engine.getCompressionRatio()).toBeGreaterThan(1)

    for (let i = 0; i < CONTENT_TYPE_RESET_SILENCE_FRAMES - 1; i++) {
      expect(engine.updateContentType(silentSpectrum, 0, SAMPLE_RATE, FFT_SIZE)).toBe(false)
    }

    expect(engine.getContentType()).toBe('compressed')
    expect(engine.getIsCompressed()).toBe(true)

    expect(engine.updateContentType(silentSpectrum, 0, SAMPLE_RATE, FFT_SIZE)).toBe(true)
    expect(engine.getContentType()).toBe('unknown')
    expect(engine.getIsCompressed()).toBe(false)
    expect(engine.getCompressionRatio()).toBe(1)
  })

  it('reinitialization clears previously learned content/compression state', () => {
    const engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)

    const compressedSpectrum = makeFlatSpectrum(64, -40)
    for (let timestamp = 1000; timestamp < 1200; timestamp += 20) {
      engine.feedFrame(timestamp, compressedSpectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
    }

    engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)
    engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)
    engine.updateContentType(compressedSpectrum, 4, SAMPLE_RATE, FFT_SIZE)

    expect(engine.getContentType()).toBe('compressed')
    expect(engine.getIsCompressed()).toBe(true)

    engine.init(FFT_SIZE)

    expect(engine.getContentType()).toBe('unknown')
    expect(engine.getIsCompressed()).toBe(false)
    expect(engine.getCompressionRatio()).toBe(1)
  })

  it('uses instant content type as scoring fallback while smoothed state warms up', () => {
    const engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)

    const spectrum = makeMusicSpectrum(64)
    const peakBin = 16

    expect(engine.updateContentType(spectrum, 13, SAMPLE_RATE, FFT_SIZE)).toBe(false)
    expect(engine.getContentType()).toBe('unknown')

    for (let frame = 0; frame < 7; frame++) {
      const timestamp = 1000 + frame * 20
      engine.feedFrame(timestamp, spectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
      const result = engine.computeScores(makePeak(peakBin, timestamp), makeTrack(peakBin), spectrum, SAMPLE_RATE, FFT_SIZE, [])

      expect(result.contentType).toBe('music')
      expect(result.algorithmScores.msd).toBeNull()
    }
  })

  it('uses detector-provided MSD while worker MSD history warms up', () => {
    const engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)

    const peakBin = 16
    const timestamp = 1000
    const spectrum = makeSpectrum(64, peakBin, -24)
    const peak = {
      ...makePeak(peakBin, timestamp),
      msd: 0.02,
      msdGrowthRate: 1.4,
      msdIsHowl: true,
      msdFastConfirm: true,
      persistenceFrames: 8,
    }

    engine.feedFrame(timestamp, spectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
    const result = engine.computeScores(peak, makeTrack(peakBin), spectrum, SAMPLE_RATE, FFT_SIZE, [])

    expect(result.algorithmScores.msd).not.toBeNull()
    expect(result.algorithmScores.msd?.msd).toBe(0.02)
    expect(result.algorithmScores.msd?.isFeedbackLikely).toBe(true)
    expect(result.algorithmScores.msd?.framesAnalyzed).toBeGreaterThanOrEqual(8)
  })

  it('never replaces detector MSD with a differently clocked worker history', () => {
    const engine = new AlgorithmEngine()
    engine.init(FFT_SIZE)
    const peakBin = 16

    for (let frame = 0; frame < 10; frame++) {
      const timestamp = 1000 + frame * 80
      const spectrum = makeSpectrum(64, peakBin, frame % 2 === 0 ? -24 : -10)
      const peak = {
        ...makePeak(peakBin, timestamp),
        msd: 0.02,
        msdGrowthRate: 1.4,
        msdIsHowl: true,
        msdFastConfirm: true,
        persistenceFrames: 8 + frame,
      }

      engine.feedFrame(timestamp, spectrum, undefined, 150, 10000, SAMPLE_RATE, FFT_SIZE)
      const result = engine.computeScores(peak, makeTrack(peakBin), spectrum, SAMPLE_RATE, FFT_SIZE, [])

      expect(result.algorithmScores.msd?.msd).toBe(peak.msd)
      expect(result.algorithmScores.msd?.isFeedbackLikely).toBe(true)
    }
  })
})
