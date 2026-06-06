// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'

const logErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/utils/logger', () => ({
  logError: logErrorMock,
}))

describe('useAnimationFrame', () => {
  const frames: FrameRequestCallback[] = []

  beforeEach(() => {
    frames.length = 0
    logErrorMock.mockReset()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('invokes callbacks on animation frames and reports delta time', () => {
    const callback = vi.fn()

    renderHook(() => useAnimationFrame(callback))

    frames[0](100)
    frames[1](116)

    expect(callback).toHaveBeenNthCalledWith(1, 0, 100)
    expect(callback).toHaveBeenNthCalledWith(2, 16, 116)
  })

  it('throttles callbacks when a target FPS is configured', () => {
    const callback = vi.fn()

    renderHook(() => useAnimationFrame(callback, true, 10))

    frames[0](50)
    frames[1](99)
    frames[2](100)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(0, 100)
  })

  it('logs callback errors without breaking the frame loop', () => {
    renderHook(() => useAnimationFrame(() => {
      throw new Error('draw failed')
    }))

    frames[0](100)

    expect(logErrorMock).toHaveBeenCalledWith(
      '[useAnimationFrame] callback error:',
      expect.any(Error),
    )
    expect(frames).toHaveLength(2)
  })
})
