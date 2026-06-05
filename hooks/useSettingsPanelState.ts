'use client'

import { useCallback, useState } from 'react'
import { useSettings } from '@/contexts/SettingsContext'
import { hasCustomGateOverrides } from '@/hooks/useAnalyzerLayoutState'
import type { SettingsTab } from '@/components/analyzer/settings/settingsPanelTypes'

interface UseSettingsPanelStateParams {
  activeTab?: SettingsTab
  onTabChange?: (tab: SettingsTab) => void
}

interface UseSettingsPanelStateReturn {
  activeTab: SettingsTab
  setActiveTab: (tab: SettingsTab) => void
  hasCustomGates: boolean
  resetSettings: ReturnType<typeof useSettings>['resetSettings']
}

export function useSettingsPanelState({
  activeTab: controlledTab,
  onTabChange,
}: UseSettingsPanelStateParams): UseSettingsPanelStateReturn {
  const ctx = useSettings()

  const [internalTab, setInternalTab] = useState<SettingsTab>('live')
  const activeTab = controlledTab ?? internalTab
  const setActiveTab = useCallback((tab: SettingsTab) => {
    if (onTabChange) {
      onTabChange(tab)
      return
    }
    setInternalTab(tab)
  }, [onTabChange])

  return {
    activeTab,
    setActiveTab,
    hasCustomGates: hasCustomGateOverrides(ctx.session),
    resetSettings: ctx.resetSettings,
  }
}
