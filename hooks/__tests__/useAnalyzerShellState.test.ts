// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnalyzerShellState } from '@/hooks/useAnalyzerShellState'

describe('useAnalyzerShellState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens controls and issues by default on desktop', () => {
    const { result } = renderHook(() => useAnalyzerShellState(null, vi.fn()))

    expect(result.current.activeSidebarTab).toBe('controls')
    expect(result.current.issuesPanelOpen).toBe(true)
  })

  it('does not leak rejected retry promises', () => {
    const start = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('permission denied'))
    const { result } = renderHook(() => useAnalyzerShellState('permission denied', start))

    act(() => {
      result.current.handleRetry()
    })

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued issues-panel resize when unmounted', () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(42)
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    const { result, unmount } = renderHook(() => useAnalyzerShellState(null, vi.fn()))

    act(() => {
      result.current.openIssuesPanel()
    })
    unmount()

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(42)
  })
})
