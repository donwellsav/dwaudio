// @vitest-environment jsdom

import { type PropsWithChildren } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DisplayTab } from '@/components/analyzer/settings/DisplayTab'
import { deriveFreshStartDetectorSettings } from '@/lib/settings/defaultDetectorSettings'

const { updateDisplayField } = vi.hoisted(() => ({
  updateDisplayField: vi.fn(),
}))

vi.mock('@/hooks/useAdvancedTabState', () => ({
  useAdvancedTabState: () => ({
    updateDisplayField,
    updateDiagnosticField: vi.fn(),
    toggleAlgorithmMode: vi.fn(),
    toggleAlgorithm: vi.fn(),
  }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipContent: ({ children }: PropsWithChildren) => <>{children}</>,
}))

describe('DisplayTab', () => {
  beforeEach(() => {
    updateDisplayField.mockReset()
  })

  it('exposes and accepts the full linked-center gain range', () => {
    render(<DisplayTab settings={deriveFreshStartDetectorSettings()} />)

    const slider = screen.getByLabelText('Center Gain') as HTMLInputElement
    expect(slider.getAttribute('min')).toBe('-40')
    expect(slider.getAttribute('max')).toBe('40')
    expect(slider.getAttribute('step')).toBe('1')

    fireEvent.change(slider, { target: { value: '-40' } })
    fireEvent.change(slider, { target: { value: '40' } })

    expect(updateDisplayField).toHaveBeenNthCalledWith(1, 'faderLinkCenterGainDb', -40)
    expect(updateDisplayField).toHaveBeenNthCalledWith(2, 'faderLinkCenterGainDb', 40)
  })

  it('omits the detection label legend', () => {
    render(<DisplayTab settings={deriveFreshStartDetectorSettings()} />)

    expect(screen.queryByText('Help: Detection Labels')).toBeNull()
    expect(screen.queryByText('RUNAWAY')).toBeNull()
    expect(screen.queryByText('Instrument')).toBeNull()
  })
})
