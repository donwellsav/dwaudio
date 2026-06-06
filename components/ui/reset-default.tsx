'use client'

import { memo } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ResetDefaultProps {
  /** Current value */
  current: number
  /** Default value to reset to */
  defaultValue: number
  /** Called when the reset button is clicked */
  onReset: () => void
  /** Comparison tolerance for floating-point (default: step/2 or 0.001) */
  tolerance?: number
  /** Label shown in tooltip (default: "Reset to default ({defaultValue})") */
  label?: string
}

/**
 * Tiny reset-to-default icon button. Only renders when `current` differs
 * from `defaultValue` (within tolerance). Zero visual noise at defaults.
 *
 * Designed to sit inline next to a ConsoleSlider label or Input header.
 */
export const ResetDefault = memo(function ResetDefault({
  current,
  defaultValue,
  onReset,
  tolerance = 0.001,
  label,
}: ResetDefaultProps) {
  const isDefault = Math.abs(current - defaultValue) < tolerance
  if (isDefault) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer flex-shrink-0 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          aria-label={label ?? `Reset to default (${defaultValue})`}
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-mono">
        {label ?? `Default: ${defaultValue}`}
      </TooltipContent>
    </Tooltip>
  )
})
