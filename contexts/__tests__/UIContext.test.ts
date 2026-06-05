// @vitest-environment jsdom
/**
 * Tests for UIContext.tsx — UI state management context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// ── Mock dependencies ─────────────────────────────────────────────────────────

let mockIsRunning = false

vi.mock('@/contexts/EngineContext', () => ({
  useEngine: () => ({ isRunning: mockIsRunning }),
}))

import { UIProvider, useUI } from '../UIContext'

// ── Wrapper ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  // eslint-disable-next-line react/no-children-prop
  return createElement(UIProvider, { children })
}

beforeEach(() => {
  mockIsRunning = false
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UIContext', () => {
  it('provides initial state values', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    expect(result.current.mobileTab).toBe('issues')
    expect(result.current.isFrozen).toBe(false)
    expect(result.current.isRtaFullscreen).toBe(false)
  })

  it('setMobileTab changes the active tab', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => result.current.setMobileTab('settings'))
    expect(result.current.mobileTab).toBe('settings')
  })

  it('toggleFreeze toggles frozen state', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => result.current.toggleFreeze())
    expect(result.current.isFrozen).toBe(true)
    act(() => result.current.toggleFreeze())
    expect(result.current.isFrozen).toBe(false)
  })

  it('throws when used outside UIProvider', () => {
    expect(() => {
      renderHook(() => useUI())
    }).toThrow('useUI must be used within <UIProvider>')
  })
})
