// @vitest-environment jsdom

import { type PropsWithChildren } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DisplayTab } from '@/components/analyzer/settings/DisplayTab'
import { deriveFreshStartDetectorSettings } from '@/lib/settings/defaultDetectorSettings'

const { updateDisplayField, theme } = vi.hoisted(() => ({
  updateDisplayField: vi.fn(),
  theme: {
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
  },
}))

vi.mock('next-themes', () => ({
  useTheme: () => theme,
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
    theme.resolvedTheme = 'dark'
    theme.setTheme.mockReset()
  })

  it('puts the theme toggle first and switches modes', () => {
    const { rerender } = render(<DisplayTab settings={deriveFreshStartDetectorSettings()} />)

    const toggle = screen.getByRole('button', { name: 'Switch to light mode' })
    const firstSection = screen.getByRole('heading', { name: 'RTA Display' })
    expect(toggle.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.textContent).toContain('Dark Mode')

    fireEvent.click(toggle)
    expect(theme.setTheme).toHaveBeenCalledWith('light')

    theme.resolvedTheme = 'light'
    rerender(<DisplayTab settings={deriveFreshStartDetectorSettings()} />)
    expect(screen.getByRole('button', { name: 'Switch to dark mode' }).textContent).toContain('Light Mode')
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
