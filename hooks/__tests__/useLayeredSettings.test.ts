// @vitest-environment jsdom
/**
 * Integration tests for useLayeredSettings in a React render context.
 *
 * Proves that:
 * 1. The hook produces valid DetectorSettings on mount
 * 2. Semantic actions produce correct derived output
 * 3. Mode changes reset live overrides as expected
 * 4. Persistence round-trips through v2 storage
 */

import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLayeredSettings } from '@/hooks/useLayeredSettings'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import {
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_SESSION_STATE,
  FRESH_START_FEEDBACK_THRESHOLD_DB,
  FRESH_START_SENSITIVITY_OFFSET_DB,
} from '@/lib/settings/defaults'

afterEach(() => {
  localStorage.removeItem('dwa-v2-session')
  localStorage.removeItem('dwa-v2-display')
})

// ─── Mount / default state ───────────────────────────────────────────────────

describe('useLayeredSettings — default state', () => {
  it('mounts when localStorage access throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })

    try {
      expect(() => renderHook(() => useLayeredSettings())).not.toThrow()
    } finally {
      getItem.mockRestore()
    }
  })

  it('produces the fresh-start Speech snapshot on first mount', () => {
    const { result } = renderHook(() => useLayeredSettings())
    const ds = result.current.derivedSettings

    expect(ds.mode).toBe('speech')
    expect(ds.feedbackThresholdDb).toBe(FRESH_START_FEEDBACK_THRESHOLD_DB)
    expect(ds.inputGainDb).toBe(0)
    expect(ds.fftSize).toBe(MODE_BASELINES.speech.fftSize)
    expect(ds.minFrequency).toBe(MODE_BASELINES.speech.minFrequency)
    expect(ds.maxFrequency).toBe(MODE_BASELINES.speech.maxFrequency)
    expect(ds.sustainMs).toBe(MODE_BASELINES.speech.sustainMs)
    expect(ds.clearMs).toBe(MODE_BASELINES.speech.clearMs)
  })

  it('display prefs match defaults', () => {
    const { result } = renderHook(() => useLayeredSettings())
    const ds = result.current.derivedSettings

    expect(ds.showAlgorithmScores).toBe(DEFAULT_DISPLAY_PREFS.showAlgorithmScores)
    expect(ds.graphFontSize).toBe(DEFAULT_DISPLAY_PREFS.graphFontSize)
    expect(ds.canvasTargetFps).toBe(DEFAULT_DISPLAY_PREFS.canvasTargetFps)
    expect(ds.spectrumSmoothingMode).toBe(DEFAULT_DISPLAY_PREFS.spectrumSmoothingMode)
  })

  it('session starts in speech mode with the startup-only sensitivity bump', () => {
    const { result } = renderHook(() => useLayeredSettings())

    expect(result.current.session.modeId).toBe('speech')
    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(
      FRESH_START_SENSITIVITY_OFFSET_DB,
    )
    expect(result.current.session.liveOverrides.inputGainDb).toBe(0)
    expect(result.current.session.environment.mainsHumEnabled).toBe(true)
  })

  it('does not inject the fresh-start bump when explicit initial settings are provided', () => {
    const { result } = renderHook(() => useLayeredSettings({ mode: 'speech' }))

    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(
      MODE_BASELINES.speech.feedbackThresholdDb,
    )
    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(0)
  })

  it('applies initial detector overrides on mount', () => {
    const { result } = renderHook(() => useLayeredSettings({
      mode: 'monitors',
      feedbackThresholdDb: 18,
      minFrequency: 250,
      maxDisplayedIssues: 5,
      showAlgorithmScores: true,
      mainsHumFundamental: 60,
    }))

    expect(result.current.derivedSettings.mode).toBe('monitors')
    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(18)
    expect(result.current.derivedSettings.minFrequency).toBe(250)
    expect(result.current.display.maxDisplayedIssues).toBe(5)
    expect(result.current.display.showAlgorithmScores).toBe(true)
    expect(result.current.session.environment.mainsHumFundamental).toBe(60)
  })
})

// ─── Semantic actions ────────────────────────────────────────────────────────

describe('useLayeredSettings — semantic actions', () => {
  const gainContractCases = [
    { requested: -41, expected: -40 },
    { requested: -40, expected: -40 },
    { requested: 40, expected: 40 },
    { requested: 41, expected: 40 },
  ] as const

  it.each(gainContractCases)(
    'setInputGain clamps $requested to the declared $expected dB contract',
    ({ requested, expected }) => {
      const { result } = renderHook(() => useLayeredSettings())

      act(() => result.current.setInputGain(requested))

      expect(result.current.derivedSettings.inputGainDb).toBe(expected)
    },
  )

  it.each(gainContractCases)(
    'bulk live overrides clamp gain $requested to $expected dB',
    ({ requested, expected }) => {
      const { result } = renderHook(() => useLayeredSettings())

      act(() => result.current.updateLiveOverrides({ inputGainDb: requested }))

      expect(result.current.derivedSettings.inputGainDb).toBe(expected)
    },
  )

  it.each(gainContractCases)(
    'bulk display updates clamp linked-center gain $requested to $expected dB',
    ({ requested, expected }) => {
      const { result } = renderHook(() => useLayeredSettings())

      act(() => result.current.updateDisplay({ faderLinkCenterGainDb: requested }))

      expect(result.current.display.faderLinkCenterGainDb).toBe(expected)
    },
  )

  it('setMode changes derived mode and thresholds', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => result.current.setMode('liveMusic'))

    const ds = result.current.derivedSettings
    expect(ds.mode).toBe('liveMusic')
    expect(ds.feedbackThresholdDb).toBe(MODE_BASELINES.liveMusic.feedbackThresholdDb)
    expect(ds.fftSize).toBe(MODE_BASELINES.liveMusic.fftSize)
    expect(ds.minFrequency).toBe(MODE_BASELINES.liveMusic.minFrequency)
  })

  it('setMode resets sensitivity offset but preserves gain', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => {
      result.current.setSensitivityOffset(5)
      result.current.setInputGain(6)
    })

    act(() => result.current.setMode('monitors'))

    // Sensitivity offset reset
    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(0)
    // Gain preserved
    expect(result.current.session.liveOverrides.inputGainDb).toBe(6)
  })

  it('setSensitivityOffset shifts threshold', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => result.current.setSensitivityOffset(5))

    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(
      MODE_BASELINES.speech.feedbackThresholdDb + 5,
    )
  })

  it('updateDisplay changes display prefs without affecting DSP', () => {
    const { result } = renderHook(() => useLayeredSettings())
    const thresholdBefore = result.current.derivedSettings.feedbackThresholdDb

    act(() => result.current.updateDisplay({
      showAlgorithmScores: true,
      graphFontSize: 22,
      spectrumSmoothingMode: 'perceptual',
    }))

    expect(result.current.derivedSettings.showAlgorithmScores).toBe(true)
    expect(result.current.derivedSettings.graphFontSize).toBe(22)
    expect(result.current.derivedSettings.spectrumSmoothingMode).toBe('perceptual')
    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(thresholdBefore)
  })

  it('resetAll restores all defaults', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => {
      result.current.setMode('liveMusic')
      result.current.setSensitivityOffset(10)
      result.current.updateDisplay({ graphFontSize: 30 })
    })

    act(() => result.current.resetAll())

    expect(result.current.derivedSettings.mode).toBe('speech')
    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(
      FRESH_START_SENSITIVITY_OFFSET_DB,
    )
    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(
      FRESH_START_FEEDBACK_THRESHOLD_DB,
    )
    expect(result.current.derivedSettings.inputGainDb).toBe(0)
    expect(result.current.display.graphFontSize).toBe(DEFAULT_DISPLAY_PREFS.graphFontSize)
  })
})

// ─── Regression tests (GPT cross-review findings) ───────────────────────────

describe('useLayeredSettings — regression', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('resetAll cancels in-flight debounced persistence (P1 fix)', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => result.current.setMode('liveMusic'))
    act(() => result.current.resetAll())
    act(() => { vi.advanceTimersByTime(200) })

    const stored = JSON.parse(localStorage.getItem('dwa-v2-session') ?? '{}')
    expect(stored.modeId).toBe('speech')
    expect(stored.liveOverrides?.sensitivityOffsetDb).toBe(FRESH_START_SENSITIVITY_OFFSET_DB)
    expect(result.current.derivedSettings.mode).toBe('speech')
    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(FRESH_START_FEEDBACK_THRESHOLD_DB)
  })

  it('sanitizes invalid live setter input before deriving active settings', () => {
    const { result } = renderHook(() => useLayeredSettings())

    act(() => {
      result.current.setSensitivityOffset(Number.POSITIVE_INFINITY)
      result.current.setInputGain(Number.NaN)
      result.current.setAutoGain(true, 999)
      result.current.setFocusRange({ kind: 'custom', minHz: 20000, maxHz: 20 })
    })

    expect(Number.isFinite(result.current.session.liveOverrides.sensitivityOffsetDb)).toBe(true)
    expect(Number.isFinite(result.current.session.liveOverrides.inputGainDb)).toBe(true)
    expect(result.current.session.liveOverrides.autoGainTargetDb).toBe(-3)
    expect(result.current.session.liveOverrides.focusRange).toEqual(
      DEFAULT_SESSION_STATE.liveOverrides.focusRange,
    )
    expect(result.current.derivedSettings.minFrequency).toBe(MODE_BASELINES.speech.minFrequency)
    expect(result.current.derivedSettings.maxFrequency).toBe(MODE_BASELINES.speech.maxFrequency)
  })
})

// ─── Persistence ─────────────────────────────────────────────────────────────

describe('useLayeredSettings — persistence', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('session state persists to v2 storage and reloads on remount', () => {
    const { result, unmount } = renderHook(() => useLayeredSettings())

    act(() => result.current.setMode('worship'))
    // Flush debounced persistence
    act(() => { vi.advanceTimersByTime(200) })
    unmount()

    const { result: result2 } = renderHook(() => useLayeredSettings())
    expect(result2.current.derivedSettings.mode).toBe('worship')
  })

  it('display prefs persist separately from session', () => {
    const { result, unmount } = renderHook(() => useLayeredSettings())

    act(() => {
      result.current.setMode('liveMusic')
      result.current.updateDisplay({ graphFontSize: 25 })
    })
    // Flush debounced persistence
    act(() => { vi.advanceTimersByTime(200) })
    unmount()

    // Clear only session storage
    localStorage.removeItem('dwa-v2-session')

    const { result: result2 } = renderHook(() => useLayeredSettings())
    // Session reset to default
    expect(result2.current.derivedSettings.mode).toBe('speech')
    expect(result2.current.derivedSettings.feedbackThresholdDb).toBe(FRESH_START_FEEDBACK_THRESHOLD_DB)
    // Display prefs survived
    expect(result2.current.display.graphFontSize).toBe(25)
  })
})

// ─── Storage backfill ─────────────────────────────────────────────────────────

describe('useLayeredSettings — storage backfill', () => {
  it('backfills missing display pref fields from defaults', () => {
    const staleSwipeKey = ['swipe', 'Labeling'].join('')
    // Simulate an existing user who saved display prefs before the current schema.
    const oldDisplayPrefs = {
      maxDisplayedIssues: 12,
      graphFontSize: 18,
      showTooltips: false,
      showAlgorithmScores: true,
      showPeqDetails: false,
      showFreqZones: true,
      spectrumWarmMode: false,
      rtaDbMin: -90,
      rtaDbMax: -5,
      spectrumLineWidth: 2,
      showThresholdLine: true,
      canvasTargetFps: 30,
      faderMode: 'gain',
      faderLinkMode: 'unlinked',
      faderLinkRatio: 1.0,
      faderLinkCenterGainDb: 0,
      faderLinkCenterSensDb: 25,
      [staleSwipeKey]: true,
    }
    localStorage.setItem('dwa-v2-display', JSON.stringify(oldDisplayPrefs))

    const { result } = renderHook(() => useLayeredSettings())

    // Stored values should survive
    expect(result.current.display.maxDisplayedIssues).toBe(12)
    expect(result.current.display.graphFontSize).toBe(18)
    expect(result.current.display.showTooltips).toBe(false)
    expect(result.current.display.showFreqZones).toBe(true)

    expect(result.current.display.spectrumSmoothingMode).toBe(DEFAULT_DISPLAY_PREFS.spectrumSmoothingMode)
    expect(staleSwipeKey in (result.current.display as unknown as Record<string, unknown>)).toBe(false)

    const stored = JSON.parse(localStorage.getItem('dwa-v2-display') ?? '{}')
    expect(staleSwipeKey in stored).toBe(false)
    expect(stored.maxDisplayedIssues).toBe(12)
  })

  it('backfills missing nested session fields from defaults', () => {
    const staleModelFlagKey = ['m', 'lEnabled'].join('')
    // Simulate a session saved before environment gained mainsHumEnabled
    const oldSession = {
      modeId: 'worship',
      environment: {
        feedbackOffsetDb: 5,
        ringOffsetDb: 3,
        roomRT60: 1.5,
        roomVolume: 300,
        // NOTE: mainsHumEnabled and mainsHumFundamental intentionally missing
      },
      liveOverrides: {
        sensitivityOffsetDb: 2,
        inputGainDb: 0,
        autoGainEnabled: false,
        autoGainTargetDb: -18,
        focusRange: { kind: 'mode-default' },
        eqStyle: 'mode-default',
      },
      diagnostics: {
        [staleModelFlagKey]: true,
        algorithmMode: 'auto',
        enabledAlgorithms: ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr', 'ml'],
        thresholdMode: 'hybrid',
        noiseFloorAttackMs: 200,
        noiseFloorReleaseMs: 1000,
        maxTracks: 64,
        trackTimeoutMs: 1000,
        harmonicToleranceCents: 200,
        peakMergeCents: 100,
      },
      micCalibrationProfile: 'none',
    }
    localStorage.setItem('dwa-v2-session', JSON.stringify(oldSession))

    const { result } = renderHook(() => useLayeredSettings())

    // Stored values should survive
    expect(result.current.session.modeId).toBe('worship')
    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(2)

    // New nested fields should backfill from defaults
    expect(result.current.session.environment.mainsHumEnabled).toBe(true)
    expect(result.current.session.environment.mainsHumFundamental).toBe('auto')

    expect('micCalibrationProfile' in (result.current.session as unknown as Record<string, unknown>)).toBe(false)
    expect('feedbackOffsetDb' in (result.current.session.environment as unknown as Record<string, unknown>)).toBe(false)
    expect(staleModelFlagKey in (result.current.session.diagnostics as unknown as Record<string, unknown>)).toBe(false)
    expect(result.current.session.diagnostics.enabledAlgorithms).not.toContain('ml')
  })

  it('migrates stale Speech sessions without an explicit sensitivity offset to the fresh-start default', () => {
    const oldSession = {
      modeId: 'speech',
      environment: DEFAULT_SESSION_STATE.environment,
      liveOverrides: {
        inputGainDb: 0,
        autoGainEnabled: false,
        autoGainTargetDb: -18,
        focusRange: { kind: 'mode-default' },
        eqStyle: 'mode-default',
      },
      diagnostics: DEFAULT_SESSION_STATE.diagnostics,
    }
    localStorage.setItem('dwa-v2-session', JSON.stringify(oldSession))

    const { result } = renderHook(() => useLayeredSettings())

    expect(result.current.session.liveOverrides.sensitivityOffsetDb).toBe(
      FRESH_START_SENSITIVITY_OFFSET_DB,
    )
    expect(result.current.derivedSettings.feedbackThresholdDb).toBe(
      FRESH_START_FEEDBACK_THRESHOLD_DB,
    )
    expect(result.current.derivedSettings.inputGainDb).toBe(0)

    const stored = JSON.parse(localStorage.getItem('dwa-v2-session') ?? '{}')
    expect(stored.liveOverrides.sensitivityOffsetDb).toBe(
      FRESH_START_SENSITIVITY_OFFSET_DB,
    )
  })

  it('sanitizes stale persisted expert timing and threshold overrides on load', () => {
    const staleSession = {
      ...DEFAULT_SESSION_STATE,
      diagnostics: {
        ...DEFAULT_SESSION_STATE.diagnostics,
        confidenceThresholdOverride: 1.5,
        growthRateThresholdOverride: 0,
        smoothingTimeConstantOverride: 1.2,
        sustainMsOverride: 5000,
        clearMsOverride: 50,
        prominenceDbOverride: -5,
        ringThresholdDbOverride: 99,
      },
    }
    localStorage.setItem('dwa-v2-session', JSON.stringify(staleSession))

    const { result } = renderHook(() => useLayeredSettings())

    expect(result.current.session.diagnostics.confidenceThresholdOverride).toBe(0.8)
    expect(result.current.session.diagnostics.growthRateThresholdOverride).toBe(0.5)
    expect(result.current.session.diagnostics.smoothingTimeConstantOverride).toBe(0.95)
    expect(result.current.session.diagnostics.sustainMsOverride).toBe(2000)
    expect(result.current.session.diagnostics.clearMsOverride).toBe(100)
    expect(result.current.session.diagnostics.prominenceDbOverride).toBe(4)
    expect(result.current.session.diagnostics.ringThresholdDbOverride).toBe(12)

    const stored = JSON.parse(localStorage.getItem('dwa-v2-session') ?? '{}')
    expect(stored.diagnostics.confidenceThresholdOverride).toBe(0.8)
    expect(stored.diagnostics.growthRateThresholdOverride).toBe(0.5)
    expect(stored.diagnostics.smoothingTimeConstantOverride).toBe(0.95)
    expect(stored.diagnostics.sustainMsOverride).toBe(2000)
    expect(stored.diagnostics.clearMsOverride).toBe(100)
    expect(stored.diagnostics.prominenceDbOverride).toBe(4)
    expect(stored.diagnostics.ringThresholdDbOverride).toBe(12)
  })
})
