// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
  toggleFreeze: vi.fn(),
}))

vi.mock('@/contexts/EngineContext', () => ({
  useEngine: () => ({
    isRunning: false,
    isStarting: false,
    start: mocks.start,
    stop: mocks.stop,
  }),
}))

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ toggleFreeze: mocks.toggleFreeze }),
}))

import { AnalyzerKeyboardShortcuts } from '../AnalyzerKeyboardShortcuts'

describe('AnalyzerKeyboardShortcuts', () => {
  beforeEach(() => {
    mocks.start.mockClear()
    mocks.stop.mockClear()
    mocks.toggleFreeze.mockClear()
  })

  it('leaves Space to interactive controls and keeps the background shortcut', () => {
    render(
      <>
        <AnalyzerKeyboardShortcuts />
        <button type="button">Action</button>
        <a href="#main">Skip link</a>
        <select aria-label="Input device"><option>Default</option></select>
        <div role="button" aria-label="Start overlay" tabIndex={0} />
        <div role="slider" aria-label="Gain" aria-valuenow={0} tabIndex={0} />
        <div role="tab" aria-label="Settings" tabIndex={0} />
        <details>
          <summary><span data-testid="summary-child">Display options</span></summary>
        </details>
        <div contentEditable suppressContentEditableWarning>
          <span data-testid="editable-child">Editable</span>
        </div>
      </>,
    )

    const targets = [
      screen.getByRole('button', { name: 'Action' }),
      screen.getByRole('link', { name: 'Skip link' }),
      screen.getByRole('combobox', { name: 'Input device' }),
      screen.getByRole('button', { name: 'Start overlay' }),
      screen.getByRole('slider', { name: 'Gain' }),
      screen.getByRole('tab', { name: 'Settings' }),
      screen.getByTestId('summary-child'),
      screen.getByTestId('editable-child'),
    ]

    for (const target of targets) {
      const event = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }

    expect(mocks.start).not.toHaveBeenCalled()

    const backgroundEvent = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(backgroundEvent)

    expect(backgroundEvent.defaultPrevented).toBe(true)
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
})
