// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMobileTabNavigation } from '@/hooks/useMobileTabNavigation'

function makeTouchEvent(clientX: number, clientY: number): React.TouchEvent {
  return {
    touches: [{ clientX, clientY }] as unknown as React.TouchList,
    changedTouches: [{ clientX, clientY }] as unknown as React.TouchList,
    preventDefault: vi.fn(),
  } as unknown as React.TouchEvent
}

function makeKeyEvent(key: string): React.KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent
}

describe('useMobileTabNavigation', () => {
  it('moves between tabs with keyboard navigation', () => {
    const setMobileTab = vi.fn()
    const { result } = renderHook(() => useMobileTabNavigation({
      mobileTab: 'issues',
      setMobileTab,
    }))

    act(() => {
      result.current.handleTabKeyDown(makeKeyEvent('ArrowRight'))
    })

    expect(setMobileTab).toHaveBeenCalledWith('settings')
  })

  it('wraps keyboard navigation and supports home/end keys', () => {
    const setMobileTab = vi.fn()
    const issuesButton = document.createElement('button')
    const settingsButton = document.createElement('button')
    document.body.append(issuesButton, settingsButton)
    const { result, rerender } = renderHook(
      ({ mobileTab }) => useMobileTabNavigation({ mobileTab, setMobileTab }),
      { initialProps: { mobileTab: 'issues' as 'issues' | 'settings' } },
    )
    result.current.tabRefs.current = [issuesButton, settingsButton]

    act(() => {
      result.current.handleTabKeyDown(makeKeyEvent('ArrowLeft'))
    })
    expect(setMobileTab).toHaveBeenLastCalledWith('settings')
    expect(document.activeElement).toBe(settingsButton)

    rerender({ mobileTab: 'settings' })
    result.current.tabRefs.current = [issuesButton, settingsButton]
    act(() => {
      result.current.handleTabKeyDown(makeKeyEvent('Home'))
    })
    expect(setMobileTab).toHaveBeenLastCalledWith('issues')
    expect(document.activeElement).toBe(issuesButton)

    act(() => {
      result.current.handleTabKeyDown(makeKeyEvent('End'))
    })
    expect(setMobileTab).toHaveBeenLastCalledWith('settings')

    issuesButton.remove()
    settingsButton.remove()
  })

  it('ignores unrelated keyboard keys', () => {
    const setMobileTab = vi.fn()
    const event = makeKeyEvent('Enter')
    const { result } = renderHook(() => useMobileTabNavigation({
      mobileTab: 'issues',
      setMobileTab,
    }))

    act(() => {
      result.current.handleTabKeyDown(event)
    })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(setMobileTab).not.toHaveBeenCalled()
  })

  it('swipes from settings back to issues', () => {
    const setMobileTab = vi.fn()
    const { result } = renderHook(() => useMobileTabNavigation({
      mobileTab: 'settings',
      setMobileTab,
    }))

    act(() => {
      result.current.onTouchStart(makeTouchEvent(100, 100))
      result.current.onTouchEnd(makeTouchEvent(170, 100))
    })

    expect(setMobileTab).toHaveBeenCalledWith('issues')
  })

  it('does not swipe away from the issues tab', () => {
    const setMobileTab = vi.fn()
    const { result } = renderHook(() => useMobileTabNavigation({
      mobileTab: 'issues',
      setMobileTab,
    }))

    act(() => {
      result.current.onTouchStart(makeTouchEvent(100, 100))
      result.current.onTouchEnd(makeTouchEvent(20, 100))
    })

    expect(setMobileTab).not.toHaveBeenCalled()
  })

  it('ignores incomplete and mostly-vertical swipes', () => {
    const setMobileTab = vi.fn()
    const { result } = renderHook(() => useMobileTabNavigation({
      mobileTab: 'settings',
      setMobileTab,
    }))

    act(() => {
      result.current.onTouchEnd(makeTouchEvent(170, 100))
      result.current.onTouchStart({
        touches: [] as unknown as React.TouchList,
      } as React.TouchEvent)
      result.current.onTouchStart(makeTouchEvent(100, 100))
      result.current.onTouchEnd(makeTouchEvent(120, 180))
    })

    expect(setMobileTab).not.toHaveBeenCalled()
  })
})
