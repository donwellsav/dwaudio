'use client'

import { memo, type ComponentProps, type Ref } from 'react'
import { ErrorBoundary } from '@/components/analyzer/ErrorBoundary'
import { SpectrumCanvas } from '@/components/analyzer/SpectrumCanvas'

export type GraphMode = 'rta' | 'geq'
export type SpectrumCanvasProps = ComponentProps<typeof SpectrumCanvas>

interface MobileSpectrumGraphProps {
  spectrumProps: SpectrumCanvasProps
  containerRef?: Ref<HTMLDivElement>
  wrapInErrorBoundary?: boolean
}

interface MobileGraphModeToggleProps {
  mode: GraphMode
  onModeChange: (mode: GraphMode) => void
  buttonClassName?: string
}

export function haptic(ms = 10) {
  try {
    navigator?.vibrate?.(ms)
  } catch {
    // unsupported
  }
}

export const MobileSpectrumGraph = memo(function MobileSpectrumGraph({
  spectrumProps,
  containerRef,
  wrapInErrorBoundary = false,
}: MobileSpectrumGraphProps) {
  const content = <SpectrumCanvas {...spectrumProps} />
  const wrappedContent = wrapInErrorBoundary ? <ErrorBoundary>{content}</ErrorBoundary> : content

  if (!containerRef) {
    return wrappedContent
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {wrappedContent}
    </div>
  )
})

export const MobileGraphModeToggle = memo(function MobileGraphModeToggle({
  mode,
  onModeChange,
  buttonClassName = 'px-2.5 py-0.5 text-dwa-sm',
}: MobileGraphModeToggleProps) {
  return (
    <div
      className="flex rounded-full bg-background/60 backdrop-blur-sm border border-border/40 overflow-hidden"
      role="group"
      aria-label="Graph mode"
    >
      <button type="button"
        onClick={() => {
          haptic()
          onModeChange('rta')
        }}
        aria-pressed={mode === 'rta'}
        className={`${buttonClassName} font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
          mode === 'rta' ? 'bg-primary/20 text-primary' : 'text-muted-foreground/50'
        }`}
        aria-label="Show Real-Time Analyzer"
      >
        RTA
      </button>
      <button type="button"
        onClick={() => {
          haptic()
          onModeChange('geq')
        }}
        aria-pressed={mode === 'geq'}
        className={`${buttonClassName} font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
          mode === 'geq' ? 'bg-primary/20 text-primary' : 'text-muted-foreground/50'
        }`}
        aria-label="Show Graphic Equalizer"
      >
        GEQ
      </button>
    </div>
  )
})
