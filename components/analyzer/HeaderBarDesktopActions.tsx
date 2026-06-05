'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Moon,
  Sun,
} from 'lucide-react'
import {
  getThemeTooltipLabel,
  isDarkResolvedTheme,
} from '@/components/analyzer/headerBarRightControlsUtils'

interface HeaderBarDesktopActionsProps {
  resolvedTheme: string | undefined
  onToggleTheme: () => void
}

export const HeaderBarDesktopActions = memo(function HeaderBarDesktopActions({
  resolvedTheme,
  onToggleTheme,
}: HeaderBarDesktopActionsProps) {
  const isDarkTheme = isDarkResolvedTheme(resolvedTheme)

  return (
    <div className="hidden tablet:flex items-center gap-0 icon-cluster">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="h-10 w-10 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {isDarkTheme ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-sm">
          {getThemeTooltipLabel(resolvedTheme)}
        </TooltipContent>
      </Tooltip>
    </div>
  )
})
