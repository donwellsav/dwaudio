'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  return (
    <div className="flex tablet:hidden items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground hover:text-foreground relative"
            aria-label="More actions"
          >
            <MoreVertical className="size-5" />
            {isRunning ? (
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
                aria-hidden
              />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {isRunning ? (
            <DropdownMenuItem
              onClick={onToggleFreeze}
              className="text-sm gap-2 cursor-pointer"
            >
              {isFrozen ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
              {isFrozen ? 'Unfreeze (P)' : 'Freeze (P)'}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={onClearDisplays}
            disabled={!hasClearableContent}
            className="text-sm gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onToggleTheme}
            className="text-sm gap-2 cursor-pointer"
          >
            {isDarkTheme ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
            {getThemeMenuLabel(resolvedTheme)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
