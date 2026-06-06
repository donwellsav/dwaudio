// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLowSignal } from '@/hooks/useLowSignal'

describe('useLowSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requires sustained low input before entering low-signal state', () => {
    const { result } = renderHook(() => useLowSignal(true, -60))

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(3499)
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('requires sustained recovery before clearing low-signal state', () => {
    const { result, rerender } = renderHook(
      ({ inputLevel }) => useLowSignal(true, inputLevel),
      { initialProps: { inputLevel: -60 } },
    )

    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(result.current).toBe(true)

    rerender({ inputLevel: -20 })
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)
  })

  it('clears pending low-signal state when analysis stops', () => {
    const { result, rerender } = renderHook(
      ({ isRunning }) => useLowSignal(isRunning, -60),
      { initialProps: { isRunning: true } },
    )

    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(result.current).toBe(true)

    rerender({ isRunning: false })
    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(result.current).toBe(false)
  })
})
