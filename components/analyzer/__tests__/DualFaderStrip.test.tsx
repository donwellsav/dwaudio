// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DualFaderStrip } from '@/components/analyzer/DualFaderStrip'

const singleFaderProps = vi.hoisted(() => [] as Array<{
  label: string
  mode: string
  homeValue?: number
}>)

vi.mock('@/components/analyzer/SingleFader', () => ({
  SingleFader: (props: { label: string; mode: string; homeValue?: number }) => {
    singleFaderProps.push(props)
    return <div data-testid={`fader-${props.label.toLowerCase()}`}>{props.label}</div>
  },
}))

function renderStrip(overrides: Partial<React.ComponentProps<typeof DualFaderStrip>> = {}) {
  const props: React.ComponentProps<typeof DualFaderStrip> = {
    gainDb: 0,
    onGainChange: vi.fn(),
    level: -60,
    autoGainEnabled: false,
    autoGainDb: undefined,
    autoGainLocked: false,
    onAutoGainToggle: vi.fn(),
    noiseFloorDb: null,
    sensitivityDb: 26,
    onSensitivityChange: vi.fn(),
    activeAdvisoryCount: 0,
    linkMode: 'unlinked',
    linkRatio: 1,
    linkCenterGainDb: 0,
    linkCenterSensDb: 26,
    onLinkModeChange: vi.fn(),
    isRunning: false,
    ...overrides,
  }

  render(<DualFaderStrip {...props} />)
  return props
}

describe('DualFaderStrip', () => {
  beforeEach(() => {
    singleFaderProps.length = 0
  })

  it('uses operator-readable labels for fader link modes', () => {
    renderStrip()

    expect(screen.getByRole('button', {
      name: 'Use independent gain and sensitivity faders',
    }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', {
      name: 'Link gain and sensitivity faders in the same direction',
    }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', {
      name: 'Link gain and sensitivity faders in opposite directions',
    }).getAttribute('aria-pressed')).toBe('false')
  })

  it('dispatches the selected fader link mode', () => {
    const onLinkModeChange = vi.fn()
    renderStrip({ onLinkModeChange })

    fireEvent.click(screen.getByRole('button', {
      name: 'Link gain and sensitivity faders in opposite directions',
    }))

    expect(onLinkModeChange).toHaveBeenCalledWith('linked-reversed')
  })

  it('passes configured home positions into both faders', () => {
    renderStrip({
      linkCenterGainDb: -3,
      linkCenterSensDb: 26,
    })

    expect(singleFaderProps.find((props) => props.mode === 'gain')?.homeValue).toBe(-3)
    expect(singleFaderProps.find((props) => props.mode === 'sensitivity')?.homeValue).toBe(26)
  })
})
