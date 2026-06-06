// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  buildDesktopLinkModePatch,
  getDesktopSidebarViewState,
  useDesktopLayoutState,
} from '@/hooks/useDesktopLayoutState'

describe('useDesktopLayoutState helpers', () => {
  it('shows sidebar issues only when split view is closed', () => {
    expect(getDesktopSidebarViewState('issues', false)).toEqual({
      showSidebarIssues: true,
      showSidebarControls: false,
    })

    expect(getDesktopSidebarViewState('issues', true)).toEqual({
      showSidebarIssues: false,
      showSidebarControls: true,
    })

    expect(getDesktopSidebarViewState('controls', false)).toEqual({
      showSidebarIssues: false,
      showSidebarControls: true,
    })
  })

  it('snaps link centers to the current fader positions when linking is enabled', () => {
    expect(buildDesktopLinkModePatch('linked', 6, 23)).toEqual({
      faderLinkMode: 'linked',
      faderLinkCenterGainDb: 6,
      faderLinkCenterSensDb: 23,
    })
  })

  it('leaves existing centers alone when link mode is set back to unlinked', () => {
    expect(buildDesktopLinkModePatch('unlinked', 6, 23)).toEqual({
      faderLinkMode: 'unlinked',
    })
  })

  it('tracks controls tab state and writes link-mode display patches', () => {
    const updateDisplay = vi.fn()
    const { result } = renderHook(() => useDesktopLayoutState({
      activeSidebarTab: 'controls',
      issuesPanelOpen: false,
      inputGainDb: 4,
      feedbackThresholdDb: 28,
      updateDisplay,
    }))

    expect(result.current.controlsTab).toBe('live')
    expect(result.current.showSidebarControls).toBe(true)

    act(() => {
      result.current.setControlsTab('expert')
      result.current.handleLinkModeChange('linked')
    })

    expect(result.current.controlsTab).toBe('expert')
    expect(updateDisplay).toHaveBeenCalledWith({
      faderLinkMode: 'linked',
      faderLinkCenterGainDb: 4,
      faderLinkCenterSensDb: 28,
    })
  })
})
