'use client'

import { memo } from 'react'
import { SettingsGrid } from './SettingsShared'
import {
  AdvancedAlgorithmsSection,
  AdvancedDetectionPolicySection,
  AdvancedDspSection,
  AdvancedNoiseFloorSection,
  AdvancedPeakDetectionSection,
  AdvancedTimingSection,
  AdvancedTrackManagementSection,
} from './AdvancedTabSections'
import { useAdvancedTabState } from '@/hooks/useAdvancedTabState'
import type { DetectorSettings } from '@/types/advisory'

export interface AdvancedTabProps {
  settings: DetectorSettings
}

export const AdvancedTab = memo(function AdvancedTab({
  settings,
}: AdvancedTabProps) {
  const actions = useAdvancedTabState({
    settings,
  })

  return (
    <div className="space-y-1">
      <SettingsGrid>
        <AdvancedDetectionPolicySection settings={settings} actions={actions} />
        <AdvancedTimingSection settings={settings} actions={actions} />
        <AdvancedAlgorithmsSection settings={settings} actions={actions} />
        <AdvancedNoiseFloorSection settings={settings} actions={actions} />
        <AdvancedPeakDetectionSection settings={settings} actions={actions} />
        <AdvancedTrackManagementSection settings={settings} actions={actions} />
        <AdvancedDspSection settings={settings} actions={actions} />
      </SettingsGrid>
    </div>
  )
})
