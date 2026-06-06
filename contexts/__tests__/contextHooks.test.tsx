// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdvisoryProvider, useAdvisories, useAdvisoryActions, useAdvisoryData } from '@/contexts/AdvisoryContext'
import { DetectionContext, useDetection } from '@/contexts/DetectionContext'
import { EngineContext, useEngine } from '@/contexts/EngineContext'
import { MeteringContext, useMetering } from '@/contexts/MeteringContext'
import { SettingsContext, useSettings } from '@/contexts/SettingsContext'
import {
  createDetectionContextValue,
  createEngineContextValue,
  createMeteringContextValue,
  createSettingsContextValue,
} from '@/contexts/audioAnalyzerContextValues'

const clearStateMock = vi.hoisted(() => ({
  clearState: {
    dismissed: new Set<string>(['dismissed']),
    rtaCleared: new Set<string>(),
    geqCleared: new Set<string>(),
  },
  activeAdvisoryCount: 1,
  hasActiveGEQBars: true,
  hasActiveRTAMarkers: true,
  onDismiss: vi.fn(),
  restoreDismissed: vi.fn(),
  onClearAll: vi.fn(),
  onClearResolved: vi.fn(),
  onClearGEQ: vi.fn(),
  onClearRTA: vi.fn(),
}))

vi.mock('@/hooks/useAdvisoryClearState', () => ({
  useAdvisoryClearState: vi.fn(() => clearStateMock),
}))

function expectProviderError(hook: () => unknown, message: string) {
  expect(() => renderHook(hook)).toThrow(message)
}

describe('context hooks', () => {
  it('throws clear provider errors when context hooks are used outside providers', () => {
    expectProviderError(useEngine, 'useEngine must be used within <AudioAnalyzerProvider>')
    expectProviderError(useSettings, 'useSettings must be used within <AudioAnalyzerProvider>')
    expectProviderError(useMetering, 'useMetering must be used within <AudioAnalyzerProvider>')
    expectProviderError(useDetection, 'useDetection must be used within <AudioAnalyzerProvider>')
    expectProviderError(useAdvisories, 'useAdvisories must be used within <AdvisoryProvider>')
    expectProviderError(useAdvisoryActions, 'useAdvisoryActions must be used within <AdvisoryProvider>')
    expectProviderError(useAdvisoryData, 'useAdvisoryData must be used within <AdvisoryProvider>')
  })

  it('maps analyzer state into split context values', () => {
    const startWithDevice = vi.fn()
    const stop = vi.fn()
    const switchDevice = vi.fn()
    const handleDeviceChange = vi.fn()
    const resetSettings = vi.fn()
    const setMode = vi.fn()
    const setFocusRange = vi.fn()
    const state = {
      isRunning: true,
      isStarting: false,
      error: null,
      workerError: null,
      startWithDevice,
      stop,
      switchDevice,
      devices: [{ deviceId: 'mic-1', label: 'Mic 1' }],
      selectedDeviceId: 'mic-1',
      handleDeviceChange,
      dspWorker: { reset: vi.fn() },
      settings: { mode: 'speech' },
      resetSettings,
      layeredSession: { mode: 'live' },
      layeredDisplay: { theme: 'dark' },
      layered: {
        setMode,
        setSensitivityOffset: vi.fn(),
        setInputGain: vi.fn(),
        setAutoGain: vi.fn(),
        setFocusRange,
        setEqStyle: vi.fn(),
        updateDisplay: vi.fn(),
        updateDiagnostics: vi.fn(),
        updateLiveOverrides: vi.fn(),
      },
      spectrumRef: { current: null },
      tracksRef: { current: [] },
      spectrumStatus: null,
      noiseFloorDb: -80,
      sampleRate: 48_000,
      fftSize: 8192,
      inputLevel: -20,
      isAutoGain: true,
      autoGainDb: 3,
      autoGainLocked: false,
      advisories: [],
      earlyWarning: null,
    }

    const engine = createEngineContextValue(state as unknown as Parameters<typeof createEngineContextValue>[0])
    const settings = createSettingsContextValue(state as unknown as Parameters<typeof createSettingsContextValue>[0])
    const metering = createMeteringContextValue(state as unknown as Parameters<typeof createMeteringContextValue>[0])
    const detection = createDetectionContextValue(state as unknown as Parameters<typeof createDetectionContextValue>[0])

    expect(engine.start).toBe(startWithDevice)
    expect(engine.stop).toBe(stop)
    settings.handleModeChange('worship')
    settings.handleFreqRangeChange(100, 8000)
    expect(setMode).toHaveBeenCalledWith('worship')
    expect(setFocusRange).toHaveBeenCalledWith({ kind: 'custom', minHz: 100, maxHz: 8000 })
    expect(metering.inputLevel).toBe(-20)
    expect(detection.advisories).toEqual([])
  })

  it('provides advisory data and actions from the advisory provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DetectionContext.Provider value={{ advisories: [{ id: 'a1' } as never], earlyWarning: null }}>
        <AdvisoryProvider>{children}</AdvisoryProvider>
      </DetectionContext.Provider>
    )

    const { result } = renderHook(() => ({
      all: useAdvisories(),
      data: useAdvisoryData(),
      actions: useAdvisoryActions(),
    }), { wrapper })

    expect(result.current.all.activeAdvisoryCount).toBe(1)
    expect(result.current.data.hasActiveGEQBars).toBe(true)
    result.current.actions.onClearAll()
    expect(clearStateMock.onClearAll).toHaveBeenCalled()
  })

  it('reads concrete provider values for engine, settings, metering, and detection', () => {
    const engine = { isRunning: true } as never
    const settings = { resetSettings: vi.fn() } as never
    const metering = { inputLevel: -12 } as never
    const detection = { advisories: [], earlyWarning: null }

    const { result } = renderHook(() => ({
      engine: useEngine(),
      settings: useSettings(),
      metering: useMetering(),
      detection: useDetection(),
    }), {
      wrapper: ({ children }) => (
        <EngineContext.Provider value={engine}>
          <SettingsContext.Provider value={settings}>
            <MeteringContext.Provider value={metering}>
              <DetectionContext.Provider value={detection}>
                {children}
              </DetectionContext.Provider>
            </MeteringContext.Provider>
          </SettingsContext.Provider>
        </EngineContext.Provider>
      ),
    })

    expect(result.current.engine).toBe(engine)
    expect(result.current.settings).toBe(settings)
    expect(result.current.metering).toBe(metering)
    expect(result.current.detection).toBe(detection)
  })
})
