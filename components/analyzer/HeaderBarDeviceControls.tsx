'use client'

import { memo } from 'react'
import type { AudioDevice } from '@/hooks/useAudioDevices'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Mic } from 'lucide-react'
import { DwaLogo } from './DwaLogo'

interface HeaderBarDeviceControlsProps {
  isRunning: boolean
  inputLevel: number
  devices: AudioDevice[]
  selectedDeviceId: string
  handleDeviceChange: (deviceId: string) => void
  onToggleAnalysis: () => void
}

export const HeaderBarDeviceControls = memo(function HeaderBarDeviceControls({
  isRunning,
  inputLevel,
  devices,
  selectedDeviceId,
  handleDeviceChange,
  onToggleAnalysis,
}: HeaderBarDeviceControlsProps) {
  return (
    <div className="flex items-center gap-2 sm:gap-2.5 flex-1 min-w-0">
      <div className="relative">
        <button
          onClick={onToggleAnalysis}
          aria-label={isRunning ? 'Stop analysis' : 'Start analysis'}
          className="relative flex items-center justify-center flex-shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary rounded"
        >
          <DwaLogo
            className={`size-10 tablet:size-16 ${
              isRunning
                ? 'text-foreground drop-shadow-[0_0_8px_rgba(var(--tint-r),var(--tint-g),var(--tint-b),0.5)]'
                : 'text-foreground/70 hover:text-foreground'
            }`}
            audioLevel={isRunning ? Math.max(0, Math.min(1, (inputLevel + 60) / 60)) : undefined}
          />
        </button>
        <div
          className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full tablet:hidden transition-colors duration-500 ${
            isRunning
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
              : 'bg-muted-foreground/20'
          }`}
          aria-hidden
        />
      </div>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-foreground/70 hover:text-foreground btn-glow relative"
                aria-label="Select audio input"
              >
                <Mic className="size-5 tablet:size-6" />
                <ChevronDown className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 text-muted-foreground/50" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-sm">
            Audio input
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="max-w-[min(360px,90vw)]">
          <DropdownMenuRadioGroup value={selectedDeviceId} onValueChange={handleDeviceChange}>
            <DropdownMenuRadioItem value="" className="text-sm">
              Default (System)
            </DropdownMenuRadioItem>
            {devices.map((device) => (
              <DropdownMenuRadioItem
                key={device.deviceId}
                value={device.deviceId}
                className="text-sm truncate"
              >
                {device.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
