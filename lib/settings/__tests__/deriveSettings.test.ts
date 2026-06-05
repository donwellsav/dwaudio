/**
 * Exhaustive tests for the derivation function.
 *
 * These tests prove that deriveDetectorSettings() produces outputs that
 * match the current local analyzer behavior.
 *
 * Values are sourced from:
 *   - OPERATION_MODES in lib/dsp/constants.ts (lines 417-632)
 *   - DEFAULT_SETTINGS in lib/dsp/constants.ts (fresh-start compatibility snapshot)
 *   - Mode baselines in lib/settings/modeBaselines.ts
 *
 * Room/environment data has been removed from the local-only fork.
 */

import { describe, expect, it } from 'vitest'
import { OPERATION_MODES } from '@/lib/dsp/constants'
import { DEFAULT_DIAGNOSTICS, DEFAULT_DISPLAY_PREFS, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES } from '@/lib/settings/defaults'
import { deriveDetectorSettings } from '@/lib/settings/deriveSettings'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { DEFAULT_SMOOTHING_TIME_CONSTANT } from '@/types/advisory'
import type { ModeId } from '@/types/settings'

const ALL_MODES: ModeId[] = ['speech', 'worship', 'liveMusic', 'theater', 'monitors', 'broadcast', 'outdoor']

// ─── Helper ─────────────────────────────────────────────────────────────────

function deriveForMode(modeId: ModeId) {
  return deriveDetectorSettings(
    MODE_BASELINES[modeId],
    DEFAULT_ENVIRONMENT,
    DEFAULT_LIVE_OVERRIDES,
    DEFAULT_DISPLAY_PREFS,
    DEFAULT_DIAGNOSTICS,
  )
}

// ─── Mode baselines match OPERATION_MODES exactly ────────────────────────────

describe('deriveDetectorSettings — mode baselines (no room)', () => {
  it.each(ALL_MODES)('mode "%s" matches OPERATION_MODES values', (modeId) => {
    const derived = deriveForMode(modeId)
    const original = OPERATION_MODES[modeId]

    // All mode-owned fields must match the source constants
    expect(derived.mode).toBe(modeId)
    expect(derived.feedbackThresholdDb).toBe(original.feedbackThresholdDb)
    expect(derived.ringThresholdDb).toBe(original.ringThresholdDb)
    expect(derived.growthRateThreshold).toBe(original.growthRateThreshold)
    expect(derived.fftSize).toBe(original.fftSize)
    expect(derived.minFrequency).toBe(original.minFrequency)
    expect(derived.maxFrequency).toBe(original.maxFrequency)
    expect(derived.sustainMs).toBe(original.sustainMs)
    expect(derived.clearMs).toBe(original.clearMs)
    expect(derived.confidenceThreshold).toBe(original.confidenceThreshold)
    expect(derived.prominenceDb).toBe(original.prominenceDb)
    expect(derived.eqPreset).toBe(original.eqPreset)
    expect(derived.aWeightingEnabled).toBe(original.aWeightingEnabled)
    expect(derived.ignoreWhistle).toBe(original.ignoreWhistle)
  })

  it.each(ALL_MODES)('mode "%s" now defaults to visible whistle warnings', (modeId) => {
    const derived = deriveForMode(modeId)
    expect(derived.ignoreWhistle).toBe(false)
  })
})

// ─── Display fields pass through unchanged ──────────────────────────────────

describe('deriveDetectorSettings — display passthrough', () => {
  it('all display fields match DEFAULT_DISPLAY_PREFS', () => {
    const derived = deriveForMode('speech')

    expect(derived.maxDisplayedIssues).toBe(DEFAULT_DISPLAY_PREFS.maxDisplayedIssues)
    expect(derived.graphFontSize).toBe(DEFAULT_DISPLAY_PREFS.graphFontSize)
    expect(derived.showTooltips).toBe(DEFAULT_DISPLAY_PREFS.showTooltips)
    expect(derived.showAlgorithmScores).toBe(DEFAULT_DISPLAY_PREFS.showAlgorithmScores)
    expect(derived.showPeqDetails).toBe(DEFAULT_DISPLAY_PREFS.showPeqDetails)
    expect(derived.showFreqZones).toBe(DEFAULT_DISPLAY_PREFS.showFreqZones)
    expect(derived.spectrumWarmMode).toBe(DEFAULT_DISPLAY_PREFS.spectrumWarmMode)
    expect(derived.spectrumSmoothingMode).toBe(DEFAULT_DISPLAY_PREFS.spectrumSmoothingMode)
    expect(derived.rtaDbMin).toBe(DEFAULT_DISPLAY_PREFS.rtaDbMin)
    expect(derived.rtaDbMax).toBe(DEFAULT_DISPLAY_PREFS.rtaDbMax)
    expect(derived.spectrumLineWidth).toBe(DEFAULT_DISPLAY_PREFS.spectrumLineWidth)
    expect(derived.showThresholdLine).toBe(DEFAULT_DISPLAY_PREFS.showThresholdLine)
    expect(derived.canvasTargetFps).toBe(DEFAULT_DISPLAY_PREFS.canvasTargetFps)
    expect(derived.faderMode).toBe(DEFAULT_DISPLAY_PREFS.faderMode)
    expect(derived.faderLinkMode).toBe(DEFAULT_DISPLAY_PREFS.faderLinkMode)
    expect(derived.faderLinkRatio).toBe(DEFAULT_DISPLAY_PREFS.faderLinkRatio)
    expect(derived.faderLinkCenterGainDb).toBe(DEFAULT_DISPLAY_PREFS.faderLinkCenterGainDb)
    expect(derived.faderLinkCenterSensDb).toBe(DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb)
  })

  it('custom display prefs override defaults', () => {
    const customDisplay = { ...DEFAULT_DISPLAY_PREFS, graphFontSize: 22, showAlgorithmScores: true, spectrumSmoothingMode: 'perceptual' as const }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      DEFAULT_LIVE_OVERRIDES,
      customDisplay,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.graphFontSize).toBe(22)
    expect(derived.showAlgorithmScores).toBe(true)
    expect(derived.spectrumSmoothingMode).toBe('perceptual')
  })
})

// ─── Diagnostics fields ─────────────────────────────────────────────────────

describe('deriveDetectorSettings — diagnostics', () => {
  it('diagnostics fields match DEFAULT_DIAGNOSTICS', () => {
    const derived = deriveForMode('speech')

    expect(derived.algorithmMode).toBe(DEFAULT_DIAGNOSTICS.algorithmMode)
    expect(derived.enabledAlgorithms).toEqual(DEFAULT_DIAGNOSTICS.enabledAlgorithms)
    expect(derived.thresholdMode).toBe(DEFAULT_DIAGNOSTICS.thresholdMode)
    expect(derived.noiseFloorAttackMs).toBe(DEFAULT_DIAGNOSTICS.noiseFloorAttackMs)
    expect(derived.noiseFloorReleaseMs).toBe(DEFAULT_DIAGNOSTICS.noiseFloorReleaseMs)
    expect(derived.maxTracks).toBe(DEFAULT_DIAGNOSTICS.maxTracks)
    expect(derived.smoothingTimeConstant).toBe(DEFAULT_SMOOTHING_TIME_CONSTANT)
    // trackTimeoutMs resolves 'mode-default' sentinel to mode baseline value
    expect(derived.trackTimeoutMs).toBe(MODE_BASELINES.speech.defaultTrackTimeoutMs)
    expect(derived.harmonicToleranceCents).toBe(DEFAULT_DIAGNOSTICS.harmonicToleranceCents)
    expect(derived.peakMergeCents).toBe(DEFAULT_DIAGNOSTICS.peakMergeCents)
  })

  it('diagnostics overrides take precedence over baseline', () => {
    const diag = {
      ...DEFAULT_DIAGNOSTICS,
      confidenceThresholdOverride: 0.75,
      growthRateThresholdOverride: 5.0,
      smoothingTimeConstantOverride: 0.8,
    }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      DEFAULT_LIVE_OVERRIDES,
      DEFAULT_DISPLAY_PREFS,
      diag,
    )
    expect(derived.confidenceThreshold).toBe(0.75)
    expect(derived.growthRateThreshold).toBe(5.0)
    expect(derived.smoothingTimeConstant).toBe(0.8)
  })

  it('without overrides, baseline confidenceThreshold and growthRateThreshold are used', () => {
    const derived = deriveForMode('liveMusic')
    // Verify against the actual OPERATION_MODES values
    expect(derived.confidenceThreshold).toBe(OPERATION_MODES.liveMusic.confidenceThreshold)
    expect(derived.growthRateThreshold).toBe(OPERATION_MODES.liveMusic.growthRateThreshold)
  })
})

// ─── Environment data is limited to local mains-hum gate ─────────────────────

describe('deriveDetectorSettings — environment mains-hum gate', () => {
  it('carries mains-hum settings into DetectorSettings', () => {
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      { mainsHumEnabled: false, mainsHumFundamental: 60 },
      DEFAULT_LIVE_OVERRIDES,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )

    expect(derived.mainsHumEnabled).toBe(false)
    expect(derived.mainsHumFundamental).toBe(60)
  })
})

// ─── Live overrides ─────────────────────────────────────────────────────────

describe('deriveDetectorSettings — live overrides', () => {
  it('sensitivityOffsetDb shifts feedback threshold', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, sensitivityOffsetDb: 5 }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    // baseline + env(0) + live(5)
    expect(derived.feedbackThresholdDb).toBe(MODE_BASELINES.speech.feedbackThresholdDb + 5)
  })

  it('negative sensitivityOffsetDb makes detection more sensitive', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, sensitivityOffsetDb: -10 }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.feedbackThresholdDb).toBe(MODE_BASELINES.speech.feedbackThresholdDb - 10)
  })

  it('sensitivity offset composes from mode baseline only', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, sensitivityOffsetDb: -3 }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    const expected = MODE_BASELINES.speech.feedbackThresholdDb - 3
    expect(derived.feedbackThresholdDb).toBe(expected)
  })

  it('custom focus range overrides mode defaults', () => {
    const live = {
      ...DEFAULT_LIVE_OVERRIDES,
      focusRange: { kind: 'custom' as const, minHz: 500, maxHz: 4000 },
    }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.minFrequency).toBe(500)
    expect(derived.maxFrequency).toBe(4000)
  })

  it('mode-default focus range uses baseline values', () => {
    const derived = deriveForMode('liveMusic')
    expect(derived.minFrequency).toBe(MODE_BASELINES.liveMusic.minFrequency)
    expect(derived.maxFrequency).toBe(MODE_BASELINES.liveMusic.maxFrequency)
  })

  it('eqStyle override replaces mode baseline', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, eqStyle: 'heavy' as const }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.eqPreset).toBe('heavy')
  })

  it('eqStyle mode-default uses baseline', () => {
    const derived = deriveForMode('liveMusic')
    expect(derived.eqPreset).toBe(MODE_BASELINES.liveMusic.eqPreset)
  })

  it('auto-gain settings pass through from live overrides', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, autoGainEnabled: true, autoGainTargetDb: -12 }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.autoGainEnabled).toBe(true)
    expect(derived.autoGainTargetDb).toBe(-12)
  })
})

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('deriveDetectorSettings — edge cases', () => {
  it('threshold never goes below 1', () => {
    const live = { ...DEFAULT_LIVE_OVERRIDES, sensitivityOffsetDb: -100 }
    const derived = deriveDetectorSettings(
      MODE_BASELINES.monitors,
      DEFAULT_ENVIRONMENT,
      live,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.feedbackThresholdDb).toBe(1)
  })

  it('broadcast mode uses mode-specific autoGainTargetDb when live is at default', () => {
    const derived = deriveDetectorSettings(
      MODE_BASELINES.broadcast,
      DEFAULT_ENVIRONMENT,
      DEFAULT_LIVE_OVERRIDES,
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )
    expect(derived.autoGainTargetDb).toBe(MODE_BASELINES.broadcast.defaultAutoGainTargetDb)
  })
})

// ─── Full mode matrix ────────────────────────────────────────────────────────

describe('deriveDetectorSettings — full mode matrix', () => {
  for (const modeId of ALL_MODES) {
    it(`${modeId} produces valid DetectorSettings`, () => {
      const derived = deriveForMode(modeId)

      // All key fields must be numbers
      expect(typeof derived.feedbackThresholdDb).toBe('number')
      expect(typeof derived.ringThresholdDb).toBe('number')
      expect(typeof derived.minFrequency).toBe('number')
      expect(typeof derived.maxFrequency).toBe('number')
      expect(typeof derived.sustainMs).toBe('number')
      expect(typeof derived.clearMs).toBe('number')
      expect(typeof derived.confidenceThreshold).toBe('number')

      // Thresholds are positive
      expect(derived.feedbackThresholdDb).toBeGreaterThanOrEqual(1)
      expect(derived.ringThresholdDb).toBeGreaterThanOrEqual(1)

      // Frequency range makes sense
      expect(derived.minFrequency).toBeLessThan(derived.maxFrequency)

      // Mode identity preserved
      expect(derived.mode).toBe(modeId)
    })
  }
})

// ─── Phase 6a: Diagnostics override tests ──────────────────────────────────

describe('Diagnostics override fields', () => {
  const baseline = MODE_BASELINES.speech

  it('sustainMsOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, sustainMsOverride: 999 }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.sustainMs).toBe(999)
  })

  it('sustainMs uses baseline when override absent', () => {
    const derived = deriveForMode('speech')
    expect(derived.sustainMs).toBe(baseline.sustainMs)
  })

  it('clearMsOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, clearMsOverride: 1250 }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.clearMs).toBe(1250)
  })

  it('clamps stale persisted timing overrides to the expert control range', () => {
    const diag = {
      ...DEFAULT_DIAGNOSTICS,
      sustainMsOverride: 5000,
      clearMsOverride: 50,
    }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)

    expect(derived.sustainMs).toBe(2000)
    expect(derived.clearMs).toBe(100)
  })

  it('clamps stale persisted detection overrides to the expert control range', () => {
    const diag = {
      ...DEFAULT_DIAGNOSTICS,
      confidenceThresholdOverride: 1.5,
      growthRateThresholdOverride: 0,
      smoothingTimeConstantOverride: 1.2,
      ringThresholdDbOverride: 99,
      prominenceDbOverride: -5,
    }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)

    expect(derived.confidenceThreshold).toBe(0.8)
    expect(derived.growthRateThreshold).toBe(0.5)
    expect(derived.smoothingTimeConstant).toBe(0.95)
    expect(derived.ringThresholdDb).toBe(12)
    expect(derived.prominenceDb).toBe(4)
  })

  it('prominenceDbOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, prominenceDbOverride: 15 }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.prominenceDb).toBe(15)
  })

  it('aWeightingOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, aWeightingOverride: false }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.aWeightingEnabled).toBe(false)
  })

  it('ignoreWhistleOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, ignoreWhistleOverride: false }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.ignoreWhistle).toBe(false)
  })

  it('fftSizeOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, fftSizeOverride: 16384 as const }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.fftSize).toBe(16384)
  })

  it('ringThresholdDbOverride takes precedence over baseline', () => {
    const diag = { ...DEFAULT_DIAGNOSTICS, ringThresholdDbOverride: 9 }
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, diag)
    expect(derived.ringThresholdDb).toBe(9)
  })

  it('ringThresholdDb uses baseline when override absent', () => {
    const derived = deriveDetectorSettings(baseline, DEFAULT_ENVIRONMENT, DEFAULT_LIVE_OVERRIDES, DEFAULT_DISPLAY_PREFS, DEFAULT_DIAGNOSTICS)
    expect(derived.ringThresholdDb).toBe(baseline.ringThresholdDb)
  })

  it('all overrides absent → all values from baseline', () => {
    const derived = deriveForMode('speech')
    expect(derived.sustainMs).toBe(baseline.sustainMs)
    expect(derived.clearMs).toBe(baseline.clearMs)
    expect(derived.prominenceDb).toBe(baseline.prominenceDb)
    expect(derived.aWeightingEnabled).toBe(baseline.aWeightingEnabled)
    expect(derived.ignoreWhistle).toBe(baseline.ignoreWhistle)
    expect(derived.fftSize).toBe(baseline.fftSize)
  })
})
