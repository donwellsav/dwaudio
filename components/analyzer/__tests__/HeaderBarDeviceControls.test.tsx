// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeaderBarDeviceControls } from '../HeaderBarDeviceControls'

const devices = [
  { deviceId: 'stage-left', label: 'Stage Left Mic' },
  { deviceId: 'stage-right', label: 'Stage Right Mic' },
]

describe('HeaderBarDeviceControls', () => {
  it('shows the active input at tablet sizes while keeping the native select behavior', () => {
    const handleDeviceChange = vi.fn()
    const props = {
      isRunning: false,
      isStarting: false,
      inputLevel: -60,
      devices,
      selectedDeviceId: 'stage-left',
      handleDeviceChange,
      onToggleAnalysis: vi.fn(),
    }
    const { rerender } = render(<HeaderBarDeviceControls {...props} />)

    const select = screen.getByRole('combobox', { name: 'Select audio input' })

    expect((select as HTMLSelectElement).value).toBe('stage-left')
    expect(select.getAttribute('title')).toBe('Audio input: Stage Left Mic')
    expect(select.className).toContain('text-transparent')
    expect(select.className).toContain('min-h-[44px]')
    expect(select.className).toContain('min-w-[44px]')
    expect(select.className).toContain('tablet:text-foreground')
    expect(select.className).toContain('tablet:w-auto')
    expect(select.parentElement?.className).toContain('min-h-[44px]')
    expect(select.parentElement?.className).toContain('min-w-[44px]')

    fireEvent.change(select, { target: { value: 'stage-right' } })
    expect(handleDeviceChange).toHaveBeenCalledWith('stage-right')

    rerender(<HeaderBarDeviceControls {...props} selectedDeviceId="" />)
    expect(screen.getByRole('combobox', { name: 'Select audio input' }).getAttribute('title'))
      .toBe('Audio input: Default (System)')
  })
})
