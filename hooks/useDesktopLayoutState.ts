'use client'

import { useCallback, useState } from 'react'
import type { SettingsTab } from '@/components/analyzer/settings/settingsPanelTypes'
import type { FaderLinkMode } from '@/hooks/useFaderLink'
import type { DisplayPrefs } from '@/types/settings'

type DesktopSidebarTab = 'issues' | 'controls'

export interface DesktopSidebarViewState {
  showSidebarIssues: boolean
  showSidebarControls: boolean
}

export function getDesktopSidebarViewState(
  activeSidebarTab: DesktopSidebarTab,
  issuesPanelOpen: boolean,
): DesktopSidebarViewState {
  return {
    showSidebarIssues: activeSidebarTab === 'issues' && !issuesPanelOpen,
    showSidebarControls: activeSidebarTab === 'controls' || issuesPanelOpen,
  }
}

export function buildDesktopLinkModePatch(
  mode: FaderLinkMode,
  inputGainDb: number,
  feedbackThresholdDb: number,
): Partial<DisplayPrefs> {
  return {
    faderLinkMode: mode,
    ...(mode !== 'unlinked'
      ? {
          faderLinkCenterGainDb: inputGainDb,
          faderLinkCenterSensDb: feedbackThresholdDb,
        }
      : {}),
  }
}

interface UseDesktopLayoutStateParams {
  activeSidebarTab: DesktopSidebarTab
  issuesPanelOpen: boolean
  inputGainDb: number
  feedbackThresholdDb: number
  updateDisplay: (partial: Partial<DisplayPrefs>) => void
}

export interface UseDesktopLayoutStateReturn extends DesktopSidebarViewState {
  controlsTab: SettingsTab
  setControlsTab: (tab: SettingsTab) => void
  handleLinkModeChange: (mode: FaderLinkMode) => void
}

export function useDesktopLayoutState({
  activeSidebarTab,
  issuesPanelOpen,
  inputGainDb,
  feedbackThresholdDb,
  updateDisplay,
}: UseDesktopLayoutStateParams): UseDesktopLayoutStateReturn {
  const [controlsTab, setControlsTab] = useState<SettingsTab>('live')

  const handleLinkModeChange = useCallback((mode: FaderLinkMode) => {
    updateDisplay(buildDesktopLinkModePatch(mode, inputGainDb, feedbackThresholdDb))
  }, [feedbackThresholdDb, inputGainDb, updateDisplay])

  return {
    ...getDesktopSidebarViewState(activeSidebarTab, issuesPanelOpen),
    controlsTab,
    setControlsTab,
    handleLinkModeChange,
  }
}
