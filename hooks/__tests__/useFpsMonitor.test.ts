/**
 * Tests for CircularTimestampBuffer from useFpsMonitor.ts.
 *
 * The buffer is pure data structure logic — no React or DOM needed.
 * Testing the hook itself would require RAF mocking; we focus on the
 * core O(1) circular buffer which is the critical correctness concern.
 */

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { CircularTimestampBuffer, useFpsMonitor } from '../useFpsMonitor'

describe('CircularTimestampBuffer', () => {
  it('starts empty with count 0', () => {
    const buf = new CircularTimestampBuffer()
    expect(buf.count).toBe(0)
  })

  it('push increments count and stores values', () => {
    const buf = new CircularTimestampBuffer()
    buf.push(100)
    buf.push(200)
    buf.push(300)
    expect(buf.count).toBe(3)
    expect(buf.get(0)).toBe(100)
    expect(buf.get(1)).toBe(200)
    expect(buf.get(2)).toBe(300)
  })

  it('oldest and newest return correct values', () => {
    const buf = new CircularTimestampBuffer()
    buf.push(10)
    buf.push(20)
    buf.push(30)
    expect(buf.oldest()).toBe(10)
    expect(buf.newest()).toBe(30)
  })

  it('wraps around when capacity exceeded, evicting oldest', () => {
    const buf = new CircularTimestampBuffer()
    // CAPACITY = WINDOW_SIZE + 1 = 61
    // Push 62 values — first should be evicted
    for (let i = 0; i < 62; i++) {
      buf.push(i * 16.67) // ~60fps timestamps
    }
    // Count caps at capacity (61)
    expect(buf.count).toBe(61)
    // Oldest should be the 2nd value pushed (index 1), not 0
    expect(buf.oldest()).toBeCloseTo(16.67, 1)
    expect(buf.newest()).toBeCloseTo(61 * 16.67, 1)
  })

  it('reset clears the buffer', () => {
    const buf = new CircularTimestampBuffer()
    buf.push(100)
    buf.push(200)
    buf.reset()
    expect(buf.count).toBe(0)
  })

  it('supports FPS calculation from timestamps', () => {
    const buf = new CircularTimestampBuffer()
    // Simulate 30 frames at exactly 60fps (16.67ms apart)
    const interval = 1000 / 60
    for (let i = 0; i < 30; i++) {
      buf.push(i * interval)
    }
    const span = buf.newest() - buf.oldest()
    const frameCount = buf.count - 1
    const fps = (frameCount / span) * 1000
    expect(fps).toBeCloseTo(60, 0)
  })
})

describe('useFpsMonitor', () => {
  const frames: FrameRequestCallback[] = []

  beforeEach(() => {
    frames.length = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns zeroed stats and does not schedule frames while disabled', () => {
    const { result } = renderHook(() => useFpsMonitor(false, 60))

    expect(result.current).toEqual({ actualFps: 0, droppedPercent: 0 })
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('updates measured FPS and dropped-frame percentage from RAF timestamps', () => {
    const { result } = renderHook(() => useFpsMonitor(true, 60))

    act(() => {
      frames[0](0)
      frames[1](16)
      frames[2](600)
    })

    expect(result.current.actualFps).toBe(3)
    expect(result.current.droppedPercent).toBe(50)
  })

  it('cancels the RAF loop on unmount', () => {
    const { unmount } = renderHook(() => useFpsMonitor(true, 60))

    unmount()

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })
})
