import { describe, expect, it } from 'vitest'
import {
  buildSpectrumDisplay,
  buildSpectrumRange,
  countActiveGeqCuts,
  hasCustomGateOverrides,
} from '@/hooks/useAnalyzerLayoutState'
import type { Advisory, DetectorSettings } from '@/types/advisory'
import type { DwaSessionState } from '@/types/settings'

function makeSessionWithDiagnostics(
  diagnostics: Partial<DwaSessionState['diagnostics']> = {},
): DwaSessionState {
  return {
    modeId: 'speech',
    environment: {
      mainsHumEnabled: true,
      mainsHumFundamental: 'auto',
    },
    liveOverrides: {
      sensitivityOffsetDb: 0,
      inputGainDb: 0,
      autoGainEnabled: false,
      autoGainTargetDb: -18,
      focusRange: { kind: 'preset', id: 'full' },
      eqStyle: 'mode-default',
    },
    diagnostics: {
      algorithmMode: 'auto',
      enabledAlgorithms: [],
      thresholdMode: 'hybrid',
      noiseFloorAttackMs: 250,
      noiseFloorReleaseMs: 2000,
      maxTracks: 8,
      trackTimeoutMs: 'mode-default',
      harmonicToleranceCents: 200,
      peakMergeCents: 35,
      ...diagnostics,
    },
  } as unknown as DwaSessionState
}

function makeSettings(overrides: Partial<DetectorSettings> = {}): DetectorSettings {
  return {
    graphFontSize: 14,
    rtaDbMin: -100,
    rtaDbMax: -6,
    spectrumLineWidth: 2,
    canvasTargetFps: 30,
    showFreqZones: true,
    showThresholdLine: true,
    spectrumWarmMode: true,
    spectrumSmoothingMode: 'raw',
    minFrequency: 80,
    maxFrequency: 12000,
    feedbackThresholdDb: 24,
    ...overrides,
  } as unknown as DetectorSettings
}

function makeAdvisory(
  id: string,
  overrides: Partial<Advisory> = {},
): Advisory {
  return {
    id,
    trackId: `track-${id}`,
    timestamp: 1,
    label: 'ACOUSTIC_FEEDBACK',
    severity: 'RESONANCE',
    confidence: 0.9,
    why: ['test'],
    trueFrequencyHz: 1000,
    trueAmplitudeDb: -12,
    prominenceDb: 8,
    qEstimate: 10,
    bandwidthHz: 40,
    velocityDbPerSec: 2,
    stabilityCentsStd: 1,
    harmonicityScore: 0,
    modulationScore: 0,
    advisory: {
      geq: { bandHz: 1000, bandIndex: 12, suggestedDb: -3 },
      peq: { type: 'notch', hz: 1000, q: 10, gainDb: -6 },
      shelves: [],
      pitch: { note: 'B', octave: 5, cents: 0, midi: 83 },
    },
    ...overrides,
  } as Advisory
}

describe('useAnalyzerLayoutState helpers', () => {
  it('detects whether any custom gate override is active', () => {
    expect(hasCustomGateOverrides(undefined)).toBe(false)
    expect(hasCustomGateOverrides(makeSessionWithDiagnostics())).toBe(false)
    expect(
      hasCustomGateOverrides(makeSessionWithDiagnostics({ formantGateOverride: 0.5 })),
    ).toBe(true)
  })

  it('counts only unresolved GEQ cuts that have not been cleared', () => {
    const advisories = [
      makeAdvisory('active'),
      makeAdvisory('resolved', { resolved: true }),
      makeAdvisory('cleared'),
    ]

    expect(countActiveGeqCuts(advisories, new Set(['cleared']))).toBe(1)
  })

  it('maps display settings into the canvas display config', () => {
    const settings = makeSettings({
      graphFontSize: 18,
      rtaDbMin: -96,
      rtaDbMax: 3,
      spectrumLineWidth: 1.5,
      canvasTargetFps: 24,
      showFreqZones: false,
      showThresholdLine: false,
      spectrumWarmMode: false,
      spectrumSmoothingMode: 'perceptual',
    })

    expect(buildSpectrumDisplay(settings)).toEqual({
      graphFontSize: 18,
      rtaDbMin: -96,
      rtaDbMax: 3,
      spectrumLineWidth: 1.5,
      canvasTargetFps: 24,
      showFreqZones: false,
      showThresholdLine: false,
      spectrumWarmMode: false,
      spectrumSmoothingMode: 'perceptual',
    })
  })

  it('maps frequency and threshold settings into the canvas range config', () => {
    const settings = makeSettings({
      minFrequency: 125,
      maxFrequency: 8000,
      feedbackThresholdDb: 19,
    })

    expect(buildSpectrumRange(settings)).toEqual({
      minFrequency: 125,
      maxFrequency: 8000,
      feedbackThresholdDb: 19,
    })
  })
})
