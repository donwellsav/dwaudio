// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdvisoryProvider, useAdvisories, useAdvisoryActions, useAdvisoryData } from '@/contexts/AdvisoryContext'
import { DetectionContext, useDetection } from '@/contexts/DetectionContext'
import { EngineContext, useEngine } from '@/contexts/EngineContext'
import { MeteringContext, useMetering } from '@/contexts/MeteringContext'
import { SettingsContext, useSettings } from '@/contexts/SettingsContext'

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
