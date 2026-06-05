// @vitest-environment jsdom

import { type PropsWithChildren } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdvancedDetectionPolicySection,
} from '@/components/analyzer/settings/advancedSections/AdvancedDetectionSections'
import { AdvancedTrackManagementSection } from '@/components/analyzer/settings/advancedSections/AdvancedEngineSections'
import { LiveTab } from '@/components/analyzer/settings/LiveTab'
import { deriveDefaultDetectorSettings, deriveFreshStartDetectorSettings } from '@/lib/settings/defaultDetectorSettings'
import { DEFAULT_SETTINGS, OPERATION_MODES } from '@/lib/dsp/constants/presetConstants'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { DEFAULT_ENVIRONMENT, FRESH_START_SESSION_STATE } from '@/lib/settings/defaults'

const { mockUseSettings } = vi.hoisted(() => ({
  mockUseSettings: vi.fn(),
}))

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface MockSliderProps {
  label: string
  sliderValue?: number
  step?: number
  defaultValue?: number
  defaultLabel?: string
  onResetToDefault?: () => void
}

vi.mock('@/components/ui/console-slider', () => ({
  ConsoleSlider: ({ label, sliderValue, step, defaultValue, defaultLabel, onResetToDefault }: MockSliderProps) => {
    const canCompare =
      typeof sliderValue === 'number' &&
      Number.isFinite(sliderValue) &&
      typeof step === 'number' &&
      Number.isFinite(step) &&
      defaultValue != null
    const showReset =
      !!onResetToDefault &&
      (!canCompare || Math.abs(sliderValue - defaultValue) >= step / 2)

    return (
      <div
        data-testid={`slider-${slug(label)}`}
        data-default-value={defaultValue != null ? String(defaultValue) : ''}
        data-default-label={defaultLabel ?? ''}
      >
        <span>{label}</span>
        {showReset ? (
          <button
            type="button"
            aria-label={`reset-${slug(label)}`}
            onClick={onResetToDefault}
          >
            reset
          </button>
        ) : null}
      </div>
    )
  },
}))

vi.mock('@/components/ui/slider', () => ({
  Slider: () => <div data-testid="frequency-range-slider" />,
}))

vi.mock('@/components/ui/led-toggle', () => ({
  LEDToggle: ({ label }: { label: string }) => <div>{label}</div>,
}))

vi.mock('@/components/analyzer/settings/SettingsShared', () => ({
  Section: ({ title, children }: PropsWithChildren<{ title?: string }>) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: PropsWithChildren) => <>{children}</>,
}))

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => mockUseSettings(),
}))

function buildAdvancedActions() {
  return {
    updateDisplayField: vi.fn(),
    updateDiagnosticField: vi.fn(),
    toggleAlgorithmMode: vi.fn(),
    toggleAlgorithm: vi.fn(),
  }
}

describe('settings default alignment', () => {
  beforeEach(() => {
    mockUseSettings.mockReset()
  })

  it('resets mode-owned detection overrides back to the active mode baseline', () => {
    const actions = buildAdvancedActions()

    render(
      <AdvancedDetectionPolicySection
        settings={{ ...deriveDefaultDetectorSettings('liveMusic'), ringThresholdDb: 9 }}
        actions={actions}
      />,
    )

    expect(screen.getByTestId('slider-ring').dataset.defaultValue).toBe('8')

    fireEvent.click(screen.getByRole('button', { name: 'reset-ring' }))

    expect(actions.updateDiagnosticField).toHaveBeenCalledWith('ringThresholdDbOverride', undefined)
  })

  it('resets track timeout to mode-default instead of freezing a numeric override', () => {
    const actions = buildAdvancedActions()

    render(
      <AdvancedTrackManagementSection
        settings={{ ...deriveDefaultDetectorSettings('monitors'), trackTimeoutMs: 700 }}
        actions={actions}
      />,
    )

    expect(screen.getByTestId('slider-track-timeout').dataset.defaultValue).toBe('500')

    fireEvent.click(screen.getByRole('button', { name: 'reset-track-timeout' }))

    expect(actions.updateDiagnosticField).toHaveBeenCalledWith('trackTimeoutMs', 'mode-default')
  })

  it('uses operator-facing dB defaults for the live sensitivity reset control', () => {
    const setSensitivityOffset = vi.fn()
    mockUseSettings.mockReturnValue({
      session: FRESH_START_SESSION_STATE,
      setSensitivityOffset,
      setFocusRange: vi.fn(),
      setMode: vi.fn(),
      setEqStyle: vi.fn(),
    })

    render(<LiveTab settings={deriveFreshStartDetectorSettings()} />)

    const speechSensitivity = screen.getByTestId('slider-sensitivity')
    expect(speechSensitivity.dataset.defaultValue).toBe('26')
    expect(speechSensitivity.dataset.defaultLabel).toBe('Reset to default (26dB)')
    expect(screen.queryByRole('button', { name: 'reset-sensitivity' })).toBeNull()
  })

  it('keeps non-Speech sensitivity reset tied to the selected mode baseline', () => {
    const setSensitivityOffset = vi.fn()
    mockUseSettings.mockReturnValue({
      session: {
        ...FRESH_START_SESSION_STATE,
        modeId: 'liveMusic',
        environment: DEFAULT_ENVIRONMENT,
        liveOverrides: {
          ...FRESH_START_SESSION_STATE.liveOverrides,
          sensitivityOffsetDb: 3,
        },
      },
      setSensitivityOffset,
      setFocusRange: vi.fn(),
      setMode: vi.fn(),
      setEqStyle: vi.fn(),
    })

    render(<LiveTab settings={{ ...deriveDefaultDetectorSettings('liveMusic'), feedbackThresholdDb: 45 }} />)

    const liveMusicSensitivity = screen.getByTestId('slider-sensitivity')
    expect(liveMusicSensitivity.dataset.defaultValue).toBe('10')
    expect(liveMusicSensitivity.dataset.defaultLabel).toBe('Reset to default (42dB)')

    fireEvent.click(screen.getByRole('button', { name: 'reset-sensitivity' }))

    expect(setSensitivityOffset).toHaveBeenCalledWith(0)
  })
})

describe('mode table alignment invariants', () => {
  const SHARED_FIELDS = [
    'label',
    'description',
    'feedbackThresholdDb',
    'ringThresholdDb',
    'growthRateThreshold',
    'fftSize',
    'minFrequency',
    'maxFrequency',
    'sustainMs',
    'clearMs',
    'confidenceThreshold',
    'prominenceDb',
    'eqPreset',
    'aWeightingEnabled',
    'ignoreWhistle',
  ] as const

  it.each(Object.keys(OPERATION_MODES))(
    'OPERATION_MODES[%s] agrees with MODE_BASELINES on every shared field',
    (modeId) => {
      const preset = OPERATION_MODES[modeId as keyof typeof OPERATION_MODES]
      const baseline = MODE_BASELINES[modeId as keyof typeof MODE_BASELINES]

      const presetRecord = preset as unknown as Record<string, unknown>
      const baselineRecord = baseline as unknown as Record<string, unknown>
      for (const field of SHARED_FIELDS) {
        expect(
          presetRecord[field],
          `${modeId}.${field} drift`,
        ).toBe(baselineRecord[field])
      }
    },
  )

  // Regression guard: speech mode stays at 20 dB,
  // while the fresh-start snapshot starts at the operator default.
  it('keeps speech mode defaults separate from the fresh-start snapshot', () => {
    expect(MODE_BASELINES.speech.feedbackThresholdDb).toBe(20)
    expect(OPERATION_MODES.speech.feedbackThresholdDb).toBe(20)
    expect(deriveDefaultDetectorSettings('speech').feedbackThresholdDb).toBe(20)
    expect(DEFAULT_SETTINGS.feedbackThresholdDb).toBe(26)
    expect(DEFAULT_SETTINGS.inputGainDb).toBe(0)
  })
})
