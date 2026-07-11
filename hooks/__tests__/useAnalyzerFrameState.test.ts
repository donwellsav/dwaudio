// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeFrameState, useAnalyzerFrameState } from '@/hooks/useAnalyzerFrameState'
import type { SpectrumData, TrackSummary } from '@/types/advisory'
import type { CombPatternResult } from '@/lib/dsp/advancedDetection'

function makeSpectrum(overrides: Partial<SpectrumData> = {}): SpectrumData {
  return {
    freqDb: new Float32Array([1, 2, 3]),
    power: new Float32Array([4, 5, 6]),
    noiseFloorDb: -92,
    effectiveThresholdDb: -45,
    sampleRate: 48000,
    fftSize: 8192,
    timestamp: 1,
    peak: -12,
    autoGainEnabled: true,
    autoGainDb: 6,
    autoGainLocked: false,
    rawPeakDb: -18,
    algorithmMode: 'auto',
    contentType: 'speech',
    msdFrameCount: 12,
    isCompressed: false,
    compressionRatio: 1.2,
    isSignalPresent: true,
    lastConfirmLatencyMs: 84,
    lastPeakConfirmedAt: 1200,
    ...overrides,
  }
}

function makePattern(overrides: Partial<CombPatternResult> = {}): CombPatternResult {
  return {
    hasPattern: true,
    fundamentalSpacing: 120,
    estimatedPathLength: 2.8,
    matchingPeaks: 4,
    predictedFrequencies: [720, 840, 960],
    confidence: 0.86,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mergeFrameState', () => {
  it('prefers worker-owned status fields and preserves identity when nothing changed', () => {
    const spectrum = makeSpectrum({ contentType: 'speech', algorithmMode: 'auto', isCompressed: false })

    const first = mergeFrameState(
      { noiseFloorDb: null, spectrumStatus: null },
      spectrum,
      { contentType: 'music', algorithmMode: 'custom', isCompressed: true, compressionRatio: 3.4 },
    )

    expect(first.spectrumStatus?.contentType).toBe('music')
    expect(first.spectrumStatus?.algorithmMode).toBe('custom')
    expect(first.spectrumStatus?.isCompressed).toBe(true)
    expect(first.spectrumStatus?.compressionRatio).toBe(3.4)
    expect(first.spectrumStatus?.effectiveThresholdDb).toBe(-45)
    expect(first.spectrumStatus?.lastConfirmLatencyMs).toBe(84)
    expect(first.spectrumStatus?.lastPeakConfirmedAt).toBe(1200)

    const second = mergeFrameState(
      first,
      spectrum,
      { contentType: 'music', algorithmMode: 'custom', isCompressed: true, compressionRatio: 3.4 },
    )

    expect(second).toBe(first)
  })
})

describe('useAnalyzerFrameState', () => {
  it('clears spectrum, tracks, worker status, throttle, frame state, and early warning for a new run', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(400)

    const { result } = renderHook(() => useAnalyzerFrameState())
    const firstSpectrum = makeSpectrum({ contentType: 'speech', peak: -18 })
    const track = { id: 'track-1' } as TrackSummary

    act(() => {
      result.current.handleTracksUpdate([track], { contentType: 'music' })
      result.current.handleSpectrum(firstSpectrum)
      result.current.handleCombPatternDetected(makePattern())
    })

    expect(result.current.spectrumStatus?.contentType).toBe('music')
    expect(result.current.tracksRef.current).toEqual([track])
    expect(result.current.earlyWarning).not.toBeNull()

    act(() => {
      result.current.resetFrameState()
    })

    expect(result.current.noiseFloorDb).toBeNull()
    expect(result.current.spectrumStatus).toBeNull()
    expect(result.current.spectrumRef.current).toBeNull()
    expect(result.current.tracksRef.current).toEqual([])
    expect(result.current.earlyWarning).toBeNull()

    const nextSpectrum = makeSpectrum({ contentType: 'speech', peak: -6 })
    act(() => {
      result.current.handleSpectrum(nextSpectrum)
    })

    expect(result.current.spectrumStatus?.peak).toBe(-6)
    expect(result.current.spectrumStatus?.contentType).toBe('speech')
  })

  it('throttles DOM-facing status updates but still refreshes the hot spectrum ref', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(320)

    const { result } = renderHook(() => useAnalyzerFrameState())
    const firstSpectrum = makeSpectrum({ peak: -18, timestamp: 1 })
    const secondSpectrum = makeSpectrum({ peak: -6, timestamp: 2 })

    act(() => {
      result.current.handleSpectrum(firstSpectrum)
    })

    expect(result.current.spectrumStatus?.peak).toBe(-18)
    expect(result.current.spectrumRef.current).toBe(firstSpectrum)

    act(() => {
      result.current.handleSpectrum(secondSpectrum)
    })

    expect(result.current.spectrumStatus?.peak).toBe(-18)
    expect(result.current.spectrumRef.current).toBe(secondSpectrum)
  })

  it('reuses the original early-warning timestamp when the comb pattern is unchanged', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(3000)

    const { result } = renderHook(() => useAnalyzerFrameState())

    act(() => {
      result.current.handleCombPatternDetected(makePattern())
    })

    const firstTimestamp = result.current.earlyWarning?.timestamp
    expect(firstTimestamp).toBe(1000)

    act(() => {
      result.current.handleCombPatternDetected(makePattern())
    })

    expect(result.current.earlyWarning?.timestamp).toBe(firstTimestamp)

    act(() => {
      result.current.handleCombPatternDetected(
        makePattern({ predictedFrequencies: [740, 860, 980] }),
      )
    })

    expect(result.current.earlyWarning?.timestamp).toBe(2000)
  })
})
