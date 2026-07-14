'use client'

import { memo } from 'react'
import { HeaderBarMobileMenu } from '@/components/analyzer/HeaderBarMobileMenu'

interface HeaderBarRightControlsProps {
  isRunning: boolean
  isFrozen: boolean
  hasClearableContent: boolean
  onToggleFreeze: () => void
  onClearDisplays: () => void
}

export const HeaderBarRightControls = memo(function HeaderBarRightControls({
  isRunning,
  isFrozen,
  hasClearableContent,
  onToggleFreeze,
  onClearDisplays,
}: HeaderBarRightControlsProps) {
  return (
    <div className="flex items-center justify-end gap-0 sm:gap-1 text-sm text-muted-foreground flex-1 min-w-0">
      <HeaderBarMobileMenu
        isRunning={isRunning}
        isFrozen={isFrozen}
        hasClearableContent={hasClearableContent}
        onToggleFreeze={onToggleFreeze}
        onClearDisplays={onClearDisplays}
      />
    </div>
  )
})
