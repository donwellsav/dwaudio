// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTabKeyboardNav } from '@/hooks/useTabKeyboardNav'

function makeKeyboardEvent(key: string, currentTarget: HTMLButtonElement) {
  return {
    key,
    currentTarget,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLButtonElement>
}

describe('useTabKeyboardNav', () => {
  it('moves focus across enabled sibling tabs and wraps at the ends', () => {
    const { result } = renderHook(() => useTabKeyboardNav())
    const container = document.createElement('div')
    const first = document.createElement('button')
    const disabled = document.createElement('button')
    const second = document.createElement('button')
    disabled.disabled = true
    container.append(first, disabled, second)
    document.body.append(container)

    result.current(makeKeyboardEvent('ArrowRight', first))
    expect(document.activeElement).toBe(second)

    result.current(makeKeyboardEvent('ArrowRight', second))
    expect(document.activeElement).toBe(first)

    result.current(makeKeyboardEvent('End', first))
    expect(document.activeElement).toBe(second)

    container.remove()
  })

  it('leaves unrelated keys alone', () => {
    const { result } = renderHook(() => useTabKeyboardNav())
    const button = document.createElement('button')
    const event = makeKeyboardEvent('Enter', button)

    result.current(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
