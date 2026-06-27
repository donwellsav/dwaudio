// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HeaderBarMobileMenu } from '@/components/analyzer/HeaderBarMobileMenu'

function renderMobileMenu(overrides: Partial<ComponentProps<typeof HeaderBarMobileMenu>> = {}) {
  const props = {
    isRunning: true,
    isFrozen: false,
    hasClearableContent: true,
    resolvedTheme: 'dark',
    onToggleFreeze: vi.fn(),
    onClearDisplays: vi.fn(),
    onToggleTheme: vi.fn(),
    ...overrides,
  }

  render(<HeaderBarMobileMenu {...props} />)

  return props
}

describe('HeaderBarMobileMenu', () => {
  it('runs an item action after a touch-style blur without a related target', () => {
    const props = renderMobileMenu()

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))

    const menu = screen.getByRole('menu')
    const freezeItem = screen.getByRole('menuitem', { name: /freeze/i })
    fireEvent.pointerDown(menu)
    fireEvent.blur(screen.getByRole('button', { name: /more actions/i }), {
      relatedTarget: null,
    })
    fireEvent.click(freezeItem)

    expect(props.onToggleFreeze).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when focus leaves without a menu item pointer action pending', () => {
    renderMobileMenu()

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    fireEvent.blur(screen.getByRole('button', { name: /more actions/i }), {
      relatedTarget: null,
    })

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
