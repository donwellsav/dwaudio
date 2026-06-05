'use client'

import { memo } from 'react'
import { FlaskConical, RotateCcw, SlidersHorizontal, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ResetConfirmDialog } from '../ResetConfirmDialog'
import { LiveTab } from './LiveTab'
import { DisplayTab } from './DisplayTab'
import { AdvancedTab } from './AdvancedTab'
import { useSettingsPanelState } from '@/hooks/useSettingsPanelState'
import type { DetectorSettings } from '@/types/advisory'
import type { SettingsTab } from './settingsPanelTypes'

export interface SettingsPanelProps {
  settings: DetectorSettings
  activeTab?: SettingsTab
  onTabChange?: (tab: SettingsTab) => void
}

export const SETTINGS_TABS: { id: SettingsTab; label: string; shortLabel?: string; Icon: typeof Zap }[] = [
  { id: 'live', label: 'Live', Icon: Zap },
  { id: 'display', label: 'Display', shortLabel: 'Disp', Icon: SlidersHorizontal },
  { id: 'expert', label: 'Expert', shortLabel: 'Exp', Icon: FlaskConical },
]

export const SettingsPanel = memo(function SettingsPanel({
  settings,
  activeTab: controlledTab,
  onTabChange,
}: SettingsPanelProps) {
  const {
    activeTab,
    setActiveTab,
    hasCustomGates,
    resetSettings,
  } = useSettingsPanelState({
    activeTab: controlledTab,
    onTabChange,
  })

  return (
    <TooltipProvider delayDuration={400}>
      <div className="@container space-y-1">
        {!controlledTab && (
          <div className="mb-1 flex gap-1" role="tablist" aria-label="Settings tabs">
            {SETTINGS_TABS.map(({ id, label, shortLabel, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`flex-1 flex min-h-8 md:min-h-7 items-center justify-center gap-1 rounded px-1.5 py-0.5 text-dwa-sm font-mono font-bold uppercase tracking-wide transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  activeTab === id
                    ? 'bg-[var(--console-amber)]/15 text-[var(--console-amber)] border border-[var(--console-amber)]/30'
                    : 'text-muted-foreground hover:text-foreground border border-transparent'
                }`}
              >
                <Icon className="w-3 h-3" />
                {shortLabel ?? label}
                {id === 'expert' && hasCustomGates && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--console-amber)]" />
                )}
              </button>
            ))}
          </div>
        )}

        <div key={activeTab} className="tab-content-fade">
          {activeTab === 'live' && <LiveTab settings={settings} />}

          {activeTab === 'display' && <DisplayTab settings={settings} />}

          {activeTab === 'expert' && (
            <AdvancedTab
              settings={settings}
            />
          )}
        </div>

        <div className="panel-groove mt-1 pt-1">
          <ResetConfirmDialog
            onConfirm={resetSettings}
            trigger={(
              <Button variant="ghost" size="sm" className="h-6 w-full text-xs text-muted-foreground/50 hover:text-muted-foreground">
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Reset Defaults
              </Button>
            )}
          />
        </div>
      </div>
    </TooltipProvider>
  )
})

export type { SettingsTab }
