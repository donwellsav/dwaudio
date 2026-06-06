// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWheelStep } from '@/hooks/useWheelStep'

describe('useWheelStep', () => {
  it('ignores wheel events until the control has focus', () => {
    const element = document.createElement('div')
    const onChange = vi.fn()

    renderHook(() => useWheelStep(
      { current: element },
      { value: 5, min: 0, max: 10, step: 1, onChange },
    ))

    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('steps and clamps while focused', () => {
    const element = document.createElement('div')
    const onChange = vi.fn()

    renderHook(() => useWheelStep(
      { current: element },
      { value: 5, min: 0, max: 10, step: 1, onChange },
    ))

    element.dispatchEvent(new Event('focusin'))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
    expect(onChange).toHaveBeenLastCalledWith(6)

    const callCount = onChange.mock.calls.length
    element.dispatchEvent(new WheelEvent('focusout'))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
    expect(onChange).toHaveBeenCalledTimes(callCount)
  })

  it('supports inverted direction while focused', () => {
    const element = document.createElement('div')
    const onChange = vi.fn()

    renderHook(() => useWheelStep(
      { current: element },
      { value: 5, min: 0, max: 10, step: 1, onChange, inverted: true },
    ))

    element.dispatchEvent(new Event('focusin'))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
    expect(onChange).toHaveBeenLastCalledWith(4)
  })
})
