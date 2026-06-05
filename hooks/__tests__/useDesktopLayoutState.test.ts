import { describe, expect, it } from 'vitest'
import {
  buildDesktopLinkModePatch,
  getDesktopSidebarViewState,
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
})
