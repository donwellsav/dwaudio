'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { InputMeterSlider } from '@/components/analyzer/InputMeterSlider'
import { haptic } from '@/components/analyzer/MobileLayoutCommon'
import {
  MobileBottomNav,
  MobileFullscreenOverlay,
  MobileIssuesContent,
  MobileLandscapeLayout,
  MobilePortraitLayout,
} from '@/components/analyzer/MobileLayoutSections'
import { MobileSidecarFader } from '@/components/analyzer/MobileSidecarFader'
import { SettingsPanel } from '@/components/analyzer/settings/SettingsPanel'
import { useUI } from '@/contexts/UIContext'
import { useAnalyzerLayoutState } from '@/hooks/useAnalyzerLayoutState'
import { useMobileFaderState } from '@/hooks/useMobileFaderState'
import { useMobileGraphState } from '@/hooks/useMobileGraphState'
import { useMobileTabNavigation } from '@/hooks/useMobileTabNavigation'
import { MOBILE_MAX_DISPLAYED_ISSUES } from '@/lib/dsp/constants'
import { PriorityAlertBanner } from '@/components/analyzer/PriorityAlertBanner'

export const MobileLayout = memo(function MobileLayout() {
  const {
    isRunning,
    settings,
    handleFreqRangeChange,
    setInputGain,
    setAutoGain,
    spectrumRef,
    spectrumStatus,
    inputLevel,
    isAutoGain,
    autoGainDb,
    autoGainLocked,
    noiseFloorDb,
    handleThresholdChange,
    spectrumDisplay,
    spectrumRange,
    spectrumLifecycle,
    spectrumLifecycleWithStart,
    issuesListBaseProps,
    advisories,
    activeAdvisoryCount,
    earlyWarning,
    onClearAll,
    onClearResolved,
    rtaClearedIds,
    geqClearedIds,
    hasActiveRTAMarkers,
    hasActiveGEQBars,
    onClearRTA,
    onClearGEQ,
    isLowSignal,
  } = useAnalyzerLayoutState()

  const {
    isFrozen,
    toggleFreeze,
    mobileTab,
    setMobileTab,
    rtaContainerRef,
    isRtaFullscreen,
    toggleRtaFullscreen,
  } = useUI()

  const [landscapePanel, setLandscapePanel] = useState<'issues' | 'settings'>('issues')

  const showPriorityIssue = useCallback(() => {
    if (isRtaFullscreen) toggleRtaFullscreen()
    setMobileTab('issues')
    setLandscapePanel('issues')
  }, [isRtaFullscreen, setMobileTab, toggleRtaFullscreen])

  const {
    mobileFaderMode,
    mobileFaderValue,
    mobileGuidance,
    mobileFaderOnChange,
    toggleMobileFaderMode,
  } = useMobileFaderState({
    settings,
    isRunning,
    inputLevel,
    activeAdvisoryCount,
    isAutoGain,
    handleThresholdChange,
    setInputGain,
    setAutoGain,
  })

  const {
    inlineGraphMode,
    graphHeightVh,
    setInlineGraphMode,
    onGraphTouchStart,
    onGraphTouchEnd,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    nudgeGraphHeight,
  } = useMobileGraphState()

  const {
    tabIndex,
    tabRefs,
    handleTabKeyDown,
    onTouchStart,
    onTouchEnd,
  } = useMobileTabNavigation({
    mobileTab,
    setMobileTab,
  })

  const mobileAdvisories = useMemo(
    () => advisories.slice(0, MOBILE_MAX_DISPLAYED_ISSUES),
    [advisories],
  )

  const sharedSpectrumProps = useMemo(
    () => ({
      spectrumRef,
      advisories: mobileAdvisories,
      earlyWarning,
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
    }),
    [
      earlyWarning,
      handleFreqRangeChange,
      handleThresholdChange,
      isFrozen,
      isRtaFullscreen,
      mobileAdvisories,
      showPriorityIssue,
      spectrumDisplay,
      spectrumRange,
      spectrumRef,
    ],
  )

  const portraitRtaProps = useMemo(
    () => ({
      ...sharedSpectrumProps,
      lifecycle: spectrumLifecycle,
      clearedIds: rtaClearedIds,
    }),
    [rtaClearedIds, sharedSpectrumProps, spectrumLifecycle],
  )

  const landscapeRtaProps = useMemo(
    () => ({
      ...sharedSpectrumProps,
      lifecycle: spectrumLifecycleWithStart,
      clearedIds: rtaClearedIds,
    }),
    [rtaClearedIds, sharedSpectrumProps, spectrumLifecycleWithStart],
  )

  const geqProps = useMemo(
    () => ({
      advisories: mobileAdvisories,
      graphFontSize: settings.graphFontSize,
      clearedIds: geqClearedIds,
      isRunning,
      isLowSignal,
      spectrumStatus,
    }),
    [geqClearedIds, isLowSignal, isRunning, mobileAdvisories, settings.graphFontSize, spectrumStatus],
  )

  const issuesContent = useMemo(
    () => (
      <MobileIssuesContent
        advisories={advisories}
        earlyWarning={earlyWarning}
        issuesListBaseProps={issuesListBaseProps}
        onClearAll={onClearAll}
        onClearResolved={onClearResolved}
      />
    ),
    [
      earlyWarning,
      issuesListBaseProps,
      advisories,
      onClearAll,
      onClearResolved,
    ],
  )

  const portraitSettingsContent = useMemo(
    () => (
      <>
        <section className="border-b border-border/40 px-2 pb-2">
          <h3 className="section-label mb-1">Input Gain</h3>
          <InputMeterSlider
            value={settings.inputGainDb}
            onChange={(value) => setInputGain(value)}
            level={inputLevel}
            fullWidth
            autoGainEnabled={isAutoGain}
            autoGainDb={autoGainDb}
            autoGainLocked={autoGainLocked}
            onAutoGainToggle={(enabled) => setAutoGain(enabled)}
          />
        </section>
        <div className="px-2">
          <SettingsPanel
            settings={settings}
            onViewIssues={showPriorityIssue}
          />
        </div>
      </>
    ),
    [
      autoGainDb,
      autoGainLocked,
      inputLevel,
      isAutoGain,
      setAutoGain,
      setInputGain,
      showPriorityIssue,
      settings,
    ],
  )

  const landscapeSettingsContent = useMemo(
    () => (
      <div className="space-y-2">
        <section className="border-b border-border/40 px-1 pb-2">
          <h3 className="section-label mb-1 text-dwa-sm">Input Gain</h3>
          <InputMeterSlider
            value={settings.inputGainDb}
            onChange={(value) => setInputGain(value)}
            level={inputLevel}
            fullWidth
            compact
            autoGainEnabled={isAutoGain}
            autoGainDb={autoGainDb}
            autoGainLocked={autoGainLocked}
            onAutoGainToggle={(enabled) => setAutoGain(enabled)}
          />
        </section>
        <div className="px-1">
          <SettingsPanel
            settings={settings}
            onViewIssues={showPriorityIssue}
          />
        </div>
      </div>
    ),
    [
      autoGainDb,
      autoGainLocked,
      inputLevel,
      isAutoGain,
      setAutoGain,
      setInputGain,
      showPriorityIssue,
      settings,
    ],
  )

  const portraitSidecarFader = useMemo(
    () => (
      <MobileSidecarFader
        mobileFaderMode={mobileFaderMode}
        mobileFaderValue={mobileFaderValue}
        mobileFaderOnChange={mobileFaderOnChange}
        toggleMobileFaderMode={() => {
          haptic()
          toggleMobileFaderMode()
        }}
        inputLevel={inputLevel}
        isAutoGain={isAutoGain}
        autoGainDb={autoGainDb}
        autoGainLocked={autoGainLocked}
        setAutoGain={setAutoGain}
        noiseFloorDb={noiseFloorDb}
        mobileGuidance={mobileGuidance}
        homeValue={mobileFaderMode === 'sensitivity' ? settings.faderLinkCenterSensDb : settings.faderLinkCenterGainDb}
      />
    ),
    [
      autoGainDb,
      autoGainLocked,
      inputLevel,
      isAutoGain,
      mobileFaderMode,
      mobileFaderOnChange,
      mobileFaderValue,
      mobileGuidance,
      noiseFloorDb,
      setAutoGain,
      settings.faderLinkCenterGainDb,
      settings.faderLinkCenterSensDb,
      toggleMobileFaderMode,
    ],
  )

  const landscapeSidecarFader = useMemo(
    () => (
      <MobileSidecarFader
        mobileFaderMode={mobileFaderMode}
        mobileFaderValue={mobileFaderValue}
        mobileFaderOnChange={mobileFaderOnChange}
        toggleMobileFaderMode={() => {
          haptic()
          toggleMobileFaderMode()
        }}
        inputLevel={inputLevel}
        isAutoGain={isAutoGain}
        autoGainDb={autoGainDb}
        autoGainLocked={autoGainLocked}
        setAutoGain={setAutoGain}
        noiseFloorDb={noiseFloorDb}
        mobileGuidance={mobileGuidance}
        compact
        homeValue={mobileFaderMode === 'sensitivity' ? settings.faderLinkCenterSensDb : settings.faderLinkCenterGainDb}
      />
    ),
    [
      autoGainDb,
      autoGainLocked,
      inputLevel,
      isAutoGain,
      mobileFaderMode,
      mobileFaderOnChange,
      mobileFaderValue,
      mobileGuidance,
      noiseFloorDb,
      setAutoGain,
      settings.faderLinkCenterGainDb,
      settings.faderLinkCenterSensDb,
      toggleMobileFaderMode,
    ],
  )

  return (
    <>
      <MobilePortraitLayout
        graphHeightVh={graphHeightVh}
        geqProps={geqProps}
        inlineGraphMode={inlineGraphMode}
        issuesContent={issuesContent}
        mobileTab={mobileTab}
        onGraphTouchEnd={onGraphTouchEnd}
        onGraphTouchStart={onGraphTouchStart}
        onResizeEnd={onResizeEnd}
        onResizeMove={onResizeMove}
        onResizeStart={onResizeStart}
        onTouchEnd={onTouchEnd}
        onTouchStart={onTouchStart}
        portraitRtaProps={portraitRtaProps}
        rtaContainerRef={rtaContainerRef}
        settingsContent={portraitSettingsContent}
        setInlineGraphMode={setInlineGraphMode}
        sidecarFader={portraitSidecarFader}
        tabIndex={tabIndex}
        toggleRtaFullscreen={toggleRtaFullscreen}
        nudgeGraphHeight={nudgeGraphHeight}
      />

      {isRtaFullscreen ? (
        <MobileFullscreenOverlay
          fullscreenRtaProps={portraitRtaProps}
          geqProps={geqProps}
          toggleRtaFullscreen={toggleRtaFullscreen}
        />
      ) : null}

      <MobileLandscapeLayout
        activeAdvisoryCount={activeAdvisoryCount}
        geqProps={geqProps}
        hasActiveGEQBars={hasActiveGEQBars}
        hasActiveRTAMarkers={hasActiveRTAMarkers}
        inlineGraphMode={inlineGraphMode}
        isFrozen={isFrozen}
        isRtaFullscreen={isRtaFullscreen}
        isRunning={isRunning}
        issuesContent={issuesContent}
        landscapePanel={landscapePanel}
        landscapeRtaProps={landscapeRtaProps}
        onClearGEQ={onClearGEQ}
        onClearRTA={onClearRTA}
        rtaContainerRef={rtaContainerRef}
        setInlineGraphMode={setInlineGraphMode}
        setLandscapePanel={setLandscapePanel}
        settingsContent={landscapeSettingsContent}
        sidecarFader={landscapeSidecarFader}
        toggleFreeze={toggleFreeze}
        toggleRtaFullscreen={toggleRtaFullscreen}
      />

      <MobileBottomNav
        activeAdvisoryCount={activeAdvisoryCount}
        handleTabKeyDown={handleTabKeyDown}
        mobileTab={mobileTab}
        setMobileTab={setMobileTab}
        tabIndex={tabIndex}
        tabRefs={tabRefs}
      />
    </>
  )
})
