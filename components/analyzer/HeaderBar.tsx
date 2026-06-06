'use client'

import { memo } from 'react'
import { useSignalTint } from '@/hooks/useSignalTint'
import { useHeaderBarState } from '@/hooks/useHeaderBarState'
import { HeaderBarDeviceControls } from './HeaderBarDeviceControls'
import { HeaderBarTransportControls } from './HeaderBarTransportControls'
import { HeaderBarRightControls } from './HeaderBarRightControls'

export const HeaderBar = memo(function HeaderBar() {
  useSignalTint()

  const {
    isRunning,
    isStarting,
    inputLevel,
    devices,
    selectedDeviceId,
    handleDeviceChange,
    isFrozen,
    resolvedTheme,
    hasClearableContent,
    handleToggleAnalysis,
    handleClearDisplays,
    toggleFreeze,
    toggleTheme,
  } = useHeaderBarState()

  return (
    <header
      className="header-glow relative flex flex-row items-center gap-2 sm:gap-4 py-1 channel-strip amber-panel-header border-b border-b-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.20)] shadow-[0_1px_16px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.1),0_1px_0_rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.06)] dark:shadow-[0_1px_16px_rgba(0,0,0,0.55),0_2px_4px_rgba(0,0,0,0.3),0_1px_0_rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.09)] sm:py-1"
      style={{
        paddingLeft: 'max(0.75rem, var(--safe-left))',
        paddingRight: 'max(0.75rem, var(--safe-right))',
        paddingTop: 'max(0.25rem, var(--safe-top))',
      }}
    >
      <HeaderBarDeviceControls
        isRunning={isRunning}
        isStarting={isStarting}
        inputLevel={inputLevel}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        handleDeviceChange={handleDeviceChange}
        onToggleAnalysis={handleToggleAnalysis}
      />

      <HeaderBarTransportControls
        isRunning={isRunning}
        isStarting={isStarting}
        isFrozen={isFrozen}
        hasClearableContent={hasClearableContent}
        onToggleAnalysis={handleToggleAnalysis}
        onToggleFreeze={toggleFreeze}
        onClearDisplays={handleClearDisplays}
      />

      <HeaderBarRightControls
        isRunning={isRunning}
        isFrozen={isFrozen}
        hasClearableContent={hasClearableContent}
        resolvedTheme={resolvedTheme}
        onToggleFreeze={toggleFreeze}
        onClearDisplays={handleClearDisplays}
        onToggleTheme={toggleTheme}
      />
    </header>
  )
})
