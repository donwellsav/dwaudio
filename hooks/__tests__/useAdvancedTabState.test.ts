// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdvancedTabState } from '@/hooks/useAdvancedTabState'
import type { DetectorSettings } from '@/types/advisory'

const mockUseSettings = vi.fn()

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => mockUseSettings(),
}))

function makeSettings(overrides: Partial<DetectorSettings> = {}): DetectorSettings {
  return {
    mode: 'speech',
    fftSize: 8192,
    smoothingTimeConstant: 0.3,
    minFrequency: 150,
    maxFrequency: 10000,
    feedbackThresholdDb: 30,
    ringThresholdDb: 5,
    growthRateThreshold: 1,
    peakMergeCents: 100,
    maxDisplayedIssues: 8,
    eqPreset: 'surgical',
    inputGainDb: 0,
    autoGainEnabled: false,
    autoGainTargetDb: -18,
    graphFontSize: 15,
    harmonicToleranceCents: 200,
    showTooltips: true,
    aWeightingEnabled: true,
    confidenceThreshold: 0.35,
    mainsHumEnabled: true,
    mainsHumFundamental: 'auto',
    algorithmMode: 'auto',
    enabledAlgorithms: ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr'],
    adaptivePhaseSkip: true,
    showAlgorithmScores: false,
    showPeqDetails: false,
    showFreqZones: false,
    spectrumWarmMode: false,
    spectrumSmoothingMode: 'raw',
    sustainMs: 500,
    clearMs: 500,
    thresholdMode: 'hybrid',
    prominenceDb: 8,
    noiseFloorAttackMs: 200,
    noiseFloorReleaseMs: 1000,
    maxTracks: 64,
    trackTimeoutMs: 2000,
    ignoreWhistle: true,
    rtaDbMin: -100,
    rtaDbMax: 0,
    spectrumLineWidth: 1,
    showThresholdLine: true,
    canvasTargetFps: 30,
    faderMode: 'gain',
    faderLinkMode: 'unlinked',
    faderLinkRatio: 1,
    faderLinkCenterGainDb: 0,
    faderLinkCenterSensDb: 25,
    signalTintEnabled: true,
    ...overrides,
  }
}

describe('useAdvancedTabState', () => {
  beforeEach(() => {
    mockUseSettings.mockReset()
    mockUseSettings.mockReturnValue({
      updateDisplay: vi.fn(),
      updateDiagnostics: vi.fn(),
    })
  })

  it('delegates typed display and diagnostics updates', () => {
    const { result } = renderHook(() => useAdvancedTabState({
      settings: makeSettings(),
    }))

    act(() => {
      result.current.updateDisplayField('faderLinkRatio', 1.5)
      result.current.updateDiagnosticField('maxTracks', 72)
    })

    const context = mockUseSettings.mock.results[0]?.value as {
      updateDisplay: ReturnType<typeof vi.fn>
      updateDiagnostics: ReturnType<typeof vi.fn>
    }

    expect(context.updateDisplay).toHaveBeenCalledWith({ faderLinkRatio: 1.5 })
    expect(context.updateDiagnostics).toHaveBeenCalledWith({ maxTracks: 72 })
  })

  it('toggles algorithm mode and updates custom selections', () => {
    const customSettings = makeSettings({
      algorithmMode: 'custom',
      enabledAlgorithms: ['msd', 'phase'],
    })

    const { result, rerender } = renderHook(({ settings }) => useAdvancedTabState({ settings }), {
      initialProps: { settings: makeSettings() },
    })

    act(() => {
      result.current.toggleAlgorithmMode()
    })

    rerender({ settings: customSettings })

    act(() => {
      result.current.toggleAlgorithmMode()
      result.current.toggleAlgorithm('phase')
    })

    const context = mockUseSettings.mock.results[0]?.value as {
      updateDiagnostics: ReturnType<typeof vi.fn>
    }

    expect(context.updateDiagnostics).toHaveBeenNthCalledWith(1, { algorithmMode: 'custom' })
    expect(context.updateDiagnostics).toHaveBeenNthCalledWith(2, { algorithmMode: 'auto' })
    expect(context.updateDiagnostics).toHaveBeenNthCalledWith(3, { enabledAlgorithms: ['msd'] })
  })

  it('falls back to auto mode when the last custom algorithm is removed', () => {
    const { result } = renderHook(() => useAdvancedTabState({
      settings: makeSettings({
        algorithmMode: 'custom',
        enabledAlgorithms: ['ptmr'],
      }),
    }))

    act(() => {
      result.current.toggleAlgorithm('ptmr')
    })

    const context = mockUseSettings.mock.results[0]?.value as {
      updateDiagnostics: ReturnType<typeof vi.fn>
    }

    expect(context.updateDiagnostics).toHaveBeenCalledWith({ algorithmMode: 'auto' })
  })
})
