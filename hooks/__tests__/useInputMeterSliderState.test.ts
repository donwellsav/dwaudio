// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInputMeterSliderState } from '@/hooks/useInputMeterSliderState'

describe('useInputMeterSliderState', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('edits, clamps, and disables auto-gain when committing readout text', () => {
    const onChange = vi.fn()
    const onAutoGainToggle = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 12,
      autoGainEnabled: true,
      autoGainDb: 6,
      onAutoGainToggle,
    }))

    act(() => {
      result.current.handleReadoutClick()
    })
    expect(result.current.editing).toBe(true)

    act(() => {
      result.current.handleEditBlur({
        target: { value: '200' },
      } as React.FocusEvent<HTMLInputElement>)
    })

    expect(onAutoGainToggle).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledWith(12)
    expect(result.current.editing).toBe(false)
  })

  it('handles keyboard stepping in edit mode', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 12,
      autoGainEnabled: false,
    }))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleEditKeyDown({
        key: 'ArrowUp',
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>)
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(-19)
  })

  it('toggles auto-gain and handles track keyboard steps', () => {
    const onChange = vi.fn()
    const onAutoGainToggle = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 12,
      autoGainEnabled: true,
      onAutoGainToggle,
    }))

    act(() => {
      result.current.handleToggleAutoGain?.()
      result.current.handleTrackKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>)
      result.current.handleTrackKeyDown({
        key: 'ArrowLeft',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>)
    })

    expect(onAutoGainToggle).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledWith(-19)
    expect(onChange).toHaveBeenCalledWith(-21)
  })

  it('commits, cancels, and clamps edit-mode keyboard input', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 12,
      autoGainEnabled: false,
    }))

    act(() => {
      result.current.handleReadoutClick()
      result.current.handleEditKeyDown({
        key: 'Enter',
        currentTarget: { value: '-999' },
      } as React.KeyboardEvent<HTMLInputElement>)
    })
    expect(onChange).toHaveBeenCalledWith(-60)
    expect(result.current.editing).toBe(false)

    act(() => {
      result.current.handleReadoutClick()
      result.current.handleEditKeyDown({
        key: 'Escape',
      } as React.KeyboardEvent<HTMLInputElement>)
    })
    expect(result.current.editing).toBe(false)
  })

  it('rejects partially numeric typed input', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 12,
      autoGainEnabled: false,
    }))

    act(() => {
      result.current.handleEditBlur({
        target: { value: '12abc' },
      } as React.FocusEvent<HTMLInputElement>)
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.editing).toBe(false)
  })

  it('updates from pointer position while dragging the track', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 0,
      autoGainEnabled: false,
    }))
    const slider = document.createElement('div')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      width: 100,
      top: 0,
      height: 20,
      right: 110,
      bottom: 20,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    }))
    result.current.sliderRef.current = slider

    act(() => {
      result.current.handleTrackMouseDown({
        clientX: 60,
      } as React.MouseEvent<HTMLDivElement>)
    })

    expect(onChange).toHaveBeenCalledWith(-30)
  })

  it('handles touch dragging from the track', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useInputMeterSliderState({
      value: -20,
      onChange,
      min: -60,
      max: 0,
      autoGainEnabled: false,
    }))
    const slider = document.createElement('div')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      width: 100,
      top: 0,
      height: 20,
      right: 110,
      bottom: 20,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    }))
    result.current.sliderRef.current = slider

    act(() => {
      result.current.handleTrackTouchStart({
        touches: [{ clientX: 110 }],
      } as unknown as React.TouchEvent<HTMLDivElement>)
    })

    expect(onChange).toHaveBeenCalledWith(0)
  })
})
