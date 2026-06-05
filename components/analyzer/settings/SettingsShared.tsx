'use client'

import { memo } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export const SettingsGrid = memo(function SettingsGrid({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-3 gap-x-3 gap-y-1.5', className)}>
      {children}
    </div>
  )
})

type SectionColor = 'amber' | 'blue' | 'green'

const COLOR_VAR: Record<SectionColor, string> = {
  amber: 'var(--console-amber)',
  blue: 'var(--console-blue)',
  green: 'var(--console-green)',
}

export const Section = memo(function Section({ title, tooltip, showTooltip = true, fullWidth, color, children }: {
  title: string
  tooltip?: string
  showTooltip?: boolean
  fullWidth?: boolean
  color?: SectionColor
  children: React.ReactNode
}) {
  const labelStyle = color ? { color: COLOR_VAR[color] } : undefined

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('space-y-1', fullWidth && 'sm:col-span-full')}>
        <div className="flex min-h-4 items-center gap-1">
          <h3 className="section-label" style={labelStyle}>{title}</h3>
          {tooltip && showTooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-[rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.45)] hover:text-[var(--console-amber)] cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[280px] text-sm">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {children}
      </div>
    </TooltipProvider>
  )
})

export const SectionGroup = memo(function SectionGroup({ title, children }: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="py-1 section-label panel-groove">
        {title}
      </div>
      <div className="grid grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-3 gap-x-3 gap-y-1.5 pt-1.5">
        {children}
      </div>
    </div>
  )
})
