// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFaderControlState } from '@/hooks/useFaderControlState'

describe('useFaderControlState', () => {
  it('uses the auto gain display value for gain mode', () => {
    const trackRef = { current: null as HTMLDivElement | null }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 5,
        onChange: vi.fn(),
        min: -40,
        max: 40,
        trackRef,
        autoGainEnabled: true,
        autoGainDb: 8,
      }),
    )

    expect(result.current.displayValue).toBe(8)
    expect(result.current.valueLabel).toBe('+8')
  })

  it('steps sensitivity in the inverted direction', () => {
    const onChange = vi.fn()
    const trackRef = { current: null as HTMLDivElement | null }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'sensitivity',
        value: 20,
        onChange,
        min: 2,
        max: 50,
        trackRef,
      }),
    )

    act(() => {
      result.current.handleKeyStep(1)
    })

    expect(onChange).toHaveBeenCalledWith(19)
  })

  it('clamps typed gain edits and disables auto gain first', () => {
    const onChange = vi.fn()
    const onAutoGainToggle = vi.fn()
    const trackRef = { current: null as HTMLDivElement | null }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 0,
        onChange,
        min: -40,
        max: 40,
        trackRef,
        autoGainEnabled: true,
        autoGainDb: 12,
        onAutoGainToggle,
      }),
    )

    act(() => {
      result.current.setEditing(true)
    })

    act(() => {
      result.current.commitEdit('99')
    })

    expect(onAutoGainToggle).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledWith(40)
    expect(result.current.editing).toBe(false)
  })

  it('ignores invalid edits while still closing edit mode', () => {
    const onChange = vi.fn()
    const trackRef = { current: null as HTMLDivElement | null }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 0,
        onChange,
        min: -40,
        max: 40,
        trackRef,
      }),
    )

    act(() => {
      result.current.setEditing(true)
      result.current.commitEdit('not-a-number')
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.editing).toBe(false)
  })

  it('rejects partially numeric typed edits', () => {
    const onChange = vi.fn()
    const trackRef = { current: null as HTMLDivElement | null }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 0,
        onChange,
        min: -40,
        max: 40,
        trackRef,
      }),
    )

    act(() => {
      result.current.commitEdit('12db')
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('updates from pointer drag and coalesces through animation frame', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onChange = vi.fn()
    const track = document.createElement('div')
    track.getBoundingClientRect = vi.fn(() => ({
      top: 10,
      height: 100,
      left: 0,
      width: 20,
      right: 20,
      bottom: 110,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    }))
    const trackRef = { current: track }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 0,
        onChange,
        min: -40,
        max: 40,
        trackRef,
      }),
    )

    act(() => {
      result.current.beginPointerDrag(60)
    })

    expect(onChange).toHaveBeenCalledWith(0)
    vi.unstubAllGlobals()
  })

  it('does not start pointer drag while editing', () => {
    const onChange = vi.fn()
    const track = document.createElement('div')
    track.getBoundingClientRect = vi.fn()
    const trackRef = { current: track }

    const { result } = renderHook(() =>
      useFaderControlState({
        mode: 'gain',
        value: 0,
        onChange,
        min: -40,
        max: 40,
        trackRef,
      }),
    )

    act(() => {
      result.current.setEditing(true)
    })
    act(() => {
      result.current.beginPointerDrag(60)
    })

    expect(track.getBoundingClientRect).not.toHaveBeenCalled()
  })
})
