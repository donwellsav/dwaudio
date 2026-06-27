'use client'

import { memo, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Moon,
  MoreVertical,
  Pause,
  Play,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  getThemeMenuLabel,
  isDarkResolvedTheme,
} from '@/components/analyzer/headerBarRightControlsUtils'

interface HeaderBarMobileMenuProps {
  isRunning: boolean
  isFrozen: boolean
  hasClearableContent: boolean
  resolvedTheme: string | undefined
  onToggleFreeze: () => void
  onClearDisplays: () => void
  onToggleTheme: () => void
}

const mobileMenuItemClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50'

export const HeaderBarMobileMenu = memo(function HeaderBarMobileMenu({
  isRunning,
  isFrozen,
  hasClearableContent,
  resolvedTheme,
  onToggleFreeze,
  onClearDisplays,
  onToggleTheme,
}: HeaderBarMobileMenuProps) {
  const isDarkTheme = isDarkResolvedTheme(resolvedTheme)
  const [isOpen, setIsOpen] = useState(false)
  const runMenuAction = (action: () => void) => {
    action()
    setIsOpen(false)
  }
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget
    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
      setIsOpen(false)
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      event.stopPropagation()
    }
  }

  return (
    <div
      className="relative flex tablet:hidden items-center"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-muted-foreground hover:text-foreground relative"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <MoreVertical className="size-5" />
        {isRunning ? (
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
            aria-hidden
          />
        ) : null}
      </Button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded border border-border/40 bg-popover p-1 text-popover-foreground shadow-md"
        >
          {isRunning ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => runMenuAction(onToggleFreeze)}
              className={mobileMenuItemClass}
            >
              {isFrozen ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
              {isFrozen ? 'Unfreeze (P)' : 'Freeze (P)'}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(onClearDisplays)}
            disabled={!hasClearableContent}
            className={mobileMenuItemClass}
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
          <div className="bg-border my-1 h-px" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(onToggleTheme)}
            className={mobileMenuItemClass}
          >
            {isDarkTheme ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
            {getThemeMenuLabel(resolvedTheme)}
          </button>
        </div>
      ) : null}
    </div>
  )
})
