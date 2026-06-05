// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAnalyzerShellState } from '@/hooks/useAnalyzerShellState'

describe('useAnalyzerShellState', () => {
  it('opens controls and issues by default on desktop', () => {
    const { result } = renderHook(() => useAnalyzerShellState(null, vi.fn()))

    expect(result.current.activeSidebarTab).toBe('controls')
    expect(result.current.issuesPanelOpen).toBe(true)
  })
})
