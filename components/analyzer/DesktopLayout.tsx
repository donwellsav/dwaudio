'use client'

import { memo, useCallback } from 'react'
import { AlertTriangle, Columns2, PanelLeftClose } from 'lucide-react'
import { DesktopGraphPanels } from './DesktopGraphPanels'
import { DesktopIssuesContent } from './DesktopIssuesContent'
import { DualFaderStrip } from './DualFaderStrip'
import { SettingsPanel, SETTINGS_TABS } from './settings/SettingsPanel'
import { useUI } from '@/contexts/UIContext'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { usePanelRef } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAnalyzerLayoutState } from '@/hooks/useAnalyzerLayoutState'
import { useDesktopLayoutState } from '@/hooks/useDesktopLayoutState'
import { useTabKeyboardNav } from '@/hooks/useTabKeyboardNav'
import { PriorityAlertBanner } from './PriorityAlertBanner'

interface DesktopLayoutProps {
  issuesPanelOpen: boolean
  issuesPanelRef: ReturnType<typeof usePanelRef>
  activeSidebarTab: 'issues' | 'controls'
  setActiveSidebarTab: (tab: 'issues' | 'controls') => void
  openIssuesPanel: () => void
  closeIssuesPanel: () => void
  closeIssuesPanelToIssues: () => void
  setIssuesPanelOpen: (open: boolean) => void
}

export const DesktopLayout = memo(function DesktopLayout({
  issuesPanelOpen,
  issuesPanelRef,
  activeSidebarTab,
  setActiveSidebarTab,
  openIssuesPanel,
  closeIssuesPanel,
  closeIssuesPanelToIssues,
  setIssuesPanelOpen,
}: DesktopLayoutProps) {
  const {
    isRunning,
    settings,
    handleFreqRangeChange,
    setInputGain,
    setAutoGain,
    updateDisplay,
    spectrumRef,
    spectrumStatus,
    noiseFloorDb,
    inputLevel,
    isLowSignal,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
    handleThresholdChange,
    spectrumDisplay,
    spectrumRange,
    spectrumLifecycleWithStart,
    issuesListBaseProps,
    advisories,
    activeAdvisoryCount,
    earlyWarning,
    onClearAll,
    rtaClearedIds,
    geqClearedIds,
    hasActiveRTAMarkers,
    hasActiveGEQBars,
    onClearRTA,
    onClearGEQ,
    hasCustomGates,
    activeGeqCutCount,
  } = useAnalyzerLayoutState()

  const {
    controlsTab,
    setControlsTab,
    showSidebarIssues,
    showSidebarControls,
    handleLinkModeChange,
  } = useDesktopLayoutState({
    activeSidebarTab,
    issuesPanelOpen,
    inputGainDb: settings.inputGainDb,
    feedbackThresholdDb: settings.feedbackThresholdDb,
    updateDisplay,
  })

  const {
    isFrozen,
    toggleFreeze,
    rtaContainerRef,
    isRtaFullscreen,
    toggleRtaFullscreen,
  } = useUI()

  const showPriorityIssue = useCallback(() => {
    if (isRtaFullscreen) toggleRtaFullscreen()
    if (!issuesPanelOpen) setActiveSidebarTab('issues')
  }, [isRtaFullscreen, issuesPanelOpen, setActiveSidebarTab, toggleRtaFullscreen])

  const handleTabKeyDown = useTabKeyboardNav()

  const desktopIssuesListProps = {
    ...issuesListBaseProps,
    maxIssues: settings.maxDisplayedIssues,
    onClearAll,
  }

  return (
    <div className="hidden xl:flex flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel
          defaultSize={issuesPanelOpen ? '16%' : '14%'}
          minSize={showSidebarControls ? '16%' : '8%'}
          maxSize="30%"
        >
          <div className="flex flex-col h-full amber-sidecar overflow-hidden">
            <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 amber-panel-header">
              <div
                className="flex flex-1 tab-track"
                role="tablist"
                aria-label="Sidebar sections"
              >
                {!issuesPanelOpen ? (
                  <button type="button"
                    onClick={() => setActiveSidebarTab('issues')}
                    onKeyDown={handleTabKeyDown}
                    role="tab"
                    aria-selected={activeSidebarTab === 'issues'}
                    tabIndex={activeSidebarTab === 'issues' ? 0 : -1}
                    data-active={activeSidebarTab === 'issues' ? 'true' : 'false'}
                    className={`tab-track-item flex-1 py-0.5 text-dwa-sm font-mono font-bold uppercase tracking-[0.2em] cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      activeSidebarTab === 'issues'
                        ? 'text-[var(--console-amber)]'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Issues
                    {activeAdvisoryCount > 0 ? (
                      <span className="ml-1 font-mono text-[var(--console-amber)]">
                        {activeAdvisoryCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                <button type="button"
                  onClick={() => setActiveSidebarTab('controls')}
                  onKeyDown={handleTabKeyDown}
                  role="tab"
                  aria-selected={activeSidebarTab === 'controls'}
                  tabIndex={activeSidebarTab === 'controls' ? 0 : -1}
                  data-active={activeSidebarTab === 'controls' ? 'true' : 'false'}
                  className={`tab-track-item flex-1 py-0.5 text-dwa-sm font-mono font-bold uppercase tracking-[0.2em] cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    activeSidebarTab === 'controls'
                      ? 'text-[var(--console-amber)]'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Controls
                </button>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button"
                    onClick={issuesPanelOpen ? closeIssuesPanel : openIssuesPanel}
                    className={`flex-shrink-0 px-2 py-1 rounded transition-colors cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      issuesPanelOpen
                        ? 'text-[var(--console-amber)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.08)] ring-1 ring-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.20)]'
                    }`}
                    aria-label={issuesPanelOpen ? 'Show Controls only' : 'Open split view'}
                  >
                    <Columns2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-sm">
                  {issuesPanelOpen ? 'Show Controls only' : 'Split: Issues'}
                </TooltipContent>
              </Tooltip>
            </div>

            {showSidebarControls ? (
              <div
                className="flex-shrink-0 flex gap-0 bg-card/80 border-b border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.14)]"
                role="tablist"
                aria-label="Settings sections"
              >
                {SETTINGS_TABS.map(({ id, label, shortLabel, Icon }) => (
                  <button type="button"
                    key={id}
                    id={`sidebar-settings-tab-${id}`}
                    onClick={() => setControlsTab(id)}
                    onKeyDown={handleTabKeyDown}
                    aria-label={label}
                    role="tab"
                    aria-selected={controlsTab === id}
                    aria-controls={`sidebar-settings-panel-${id}`}
                    tabIndex={controlsTab === id ? 0 : -1}
                    data-active={controlsTab === id}
                    className={`tab-track-item relative flex-1 min-h-[30px] flex items-center justify-center gap-1 text-dwa-sm font-bold uppercase tracking-[0.08em] cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      controlsTab === id
                        ? 'bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.08)] text-[var(--console-amber)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.04)]'
                    }`}
                  >
                    <Icon
                      className="w-3 h-3 flex-shrink-0"
                      style={
                        controlsTab === id
                          ? {
                              color:
                                id === 'live'
                                  ? 'var(--console-amber)'
                                  : 'var(--console-cyan)',
                            }
                          : undefined
                      }
                    />
                    <span className="truncate">{shortLabel ?? label}</span>
                    {id === 'expert' && hasCustomGates ? (
                      <span
                        className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400"
                        title="Custom gate overrides active"
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2">
                {showSidebarIssues ? (
                  <div className="animate-in fade-in-0 duration-150">
                    <DesktopIssuesContent
                      issuesListProps={desktopIssuesListProps}
                      earlyWarning={earlyWarning}
                      withErrorBoundary
                    />
                  </div>
                ) : null}
                {showSidebarControls ? (
                  <div className="animate-in fade-in-0 duration-150">
                    <SettingsPanel
                      settings={settings}
                      activeTab={controlsTab}
                      onTabChange={setControlsTab}
                      tabIdPrefix="sidebar-settings-tab"
                      panelIdPrefix="sidebar-settings-panel"
                      onViewIssues={!issuesPanelOpen ? showPriorityIssue : undefined}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </ResizablePanel>

        {issuesPanelOpen ? (
          <>
            <ResizableHandle withHandle />

            <ResizablePanel
              panelRef={issuesPanelRef}
              defaultSize="22%"
              collapsedSize="0%"
              minSize="10%"
              maxSize="30%"
              collapsible
              onResize={(panelSize) => {
                setIssuesPanelOpen(panelSize.asPercentage > 0)
              }}
            >
              <div className="flex flex-col h-full amber-sidecar overflow-hidden">
                <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 amber-panel-header">
                  <h2 className="section-label flex items-center gap-1.5 text-[var(--console-amber)]">
                    <AlertTriangle className="w-3 h-3 text-[var(--console-amber)]" />
                    Issues
                    {activeAdvisoryCount > 0 ? (
                      <span className="font-mono text-[var(--console-amber)]">{activeAdvisoryCount}</span>
                    ) : null}
                  </h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={closeIssuesPanelToIssues}
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        aria-label="Show Issues in sidebar"
                      >
                        <PanelLeftClose className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-sm">
                      Show Issues only
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  <DesktopIssuesContent
                    issuesListProps={desktopIssuesListProps}
                    earlyWarning={earlyWarning}
                  />
                </div>
              </div>
            </ResizablePanel>
          </>
        ) : null}

        <ResizableHandle withHandle />

        <DesktopGraphPanels
          defaultSize={issuesPanelOpen ? '62%' : '86%'}
          rtaContainerRef={rtaContainerRef}
          isRunning={isRunning}
          noiseFloorDb={noiseFloorDb}
          isFrozen={isFrozen}
          isRtaFullscreen={isRtaFullscreen}
          toggleFreeze={toggleFreeze}
          toggleRtaFullscreen={toggleRtaFullscreen}
          onClearRTA={onClearRTA}
          onClearGEQ={onClearGEQ}
          hasActiveRTAMarkers={hasActiveRTAMarkers}
          hasActiveGEQBars={hasActiveGEQBars}
          activeGeqCutCount={activeGeqCutCount}
          spectrumCanvasProps={{
            spectrumRef,
            advisories,
            lifecycle: spectrumLifecycleWithStart,
            earlyWarning,
            clearedIds: rtaClearedIds,
            isFrozen,
            display: spectrumDisplay,
            range: spectrumRange,
            onFreqRangeChange: handleFreqRangeChange,
            onThresholdChange: handleThresholdChange,
            overlay: isRtaFullscreen ? (
              <PriorityAlertBanner
                onViewIssues={showPriorityIssue}
                className="absolute inset-x-2 top-2 z-30"
              />
            ) : null,
          }}
          geqBarViewProps={{
            advisories,
            graphFontSize: Math.max(10, settings.graphFontSize - 4),
            clearedIds: geqClearedIds,
            isRunning,
            isLowSignal,
            spectrumStatus,
          }}
        />
      </ResizablePanelGroup>

      <div className="flex-shrink-0 w-[136px] border-l border-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.18)] channel-strip amber-sidecar">
        <DualFaderStrip
          gainDb={settings.inputGainDb}
          onGainChange={(value) => setInputGain(value)}
          level={inputLevel}
          autoGainEnabled={isAutoGain}
          autoGainDb={autoGainDb}
          autoGainLocked={autoGainLocked}
          onAutoGainToggle={(enabled) => setAutoGain(enabled)}
          noiseFloorDb={noiseFloorDb}
          sensitivityDb={settings.feedbackThresholdDb}
          onSensitivityChange={handleThresholdChange}
          activeAdvisoryCount={activeAdvisoryCount}
          linkMode={settings.faderLinkMode}
          linkRatio={settings.faderLinkRatio}
          linkCenterGainDb={settings.faderLinkCenterGainDb}
          linkCenterSensDb={settings.faderLinkCenterSensDb}
          onLinkModeChange={handleLinkModeChange}
          isRunning={isRunning}
        />
      </div>
    </div>
  )
})
