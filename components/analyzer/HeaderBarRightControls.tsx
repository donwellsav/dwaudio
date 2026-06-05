'use client'

import { memo } from 'react'
import { HeaderBarDesktopActions } from '@/components/analyzer/HeaderBarDesktopActions'
import { HeaderBarMobileMenu } from '@/components/analyzer/HeaderBarMobileMenu'

interface HeaderBarRightControlsProps {
  isRunning: boolean
  isFrozen: boolean
  hasClearableContent: boolean
  resolvedTheme: string | undefined
  onToggleFreeze: () => void
  onClearDisplays: () => void
  onToggleTheme: () => void
}

export const HeaderBarRightControls = memo(function HeaderBarRightControls({
  isRunning,
  isFrozen,
  hasClearableContent,
  resolvedTheme,
  onToggleFreeze,
  onClearDisplays,
  onToggleTheme,
}: HeaderBarRightControlsProps) {
  return (
    <div className="flex items-center justify-end gap-0 sm:gap-1 text-sm text-muted-foreground flex-1 min-w-0">
      <HeaderBarDesktopActions
        resolvedTheme={resolvedTheme}
        onToggleTheme={onToggleTheme}
      />

      <HeaderBarMobileMenu
        isRunning={isRunning}
        isFrozen={isFrozen}
        hasClearableContent={hasClearableContent}
        resolvedTheme={resolvedTheme}
        onToggleFreeze={onToggleFreeze}
        onClearDisplays={onClearDisplays}
        onToggleTheme={onToggleTheme}
      />
    </div>
  )
})
