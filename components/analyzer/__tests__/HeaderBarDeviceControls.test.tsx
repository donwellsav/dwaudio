// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeaderBarDeviceControls } from '../HeaderBarDeviceControls'

describe('HeaderBarDeviceControls', () => {
  it('keeps device selection out of the header', () => {
    const onToggleAnalysis = vi.fn()
    render(
      <HeaderBarDeviceControls
        isRunning={false}
        isStarting={false}
        inputLevel={-60}
        onToggleAnalysis={onToggleAnalysis}
      />,
    )

    expect(screen.queryByRole('combobox', { name: 'Select audio input' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start analysis' }))
    expect(onToggleAnalysis).toHaveBeenCalledTimes(1)
  })
})
