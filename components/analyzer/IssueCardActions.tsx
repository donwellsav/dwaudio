'use client'

import { memo } from 'react'
import { Check, Copy, X } from 'lucide-react'

const COPY_BTN = 'rounded btn-glow flex items-center justify-center cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

export interface IssueCardActionsProps {
  advisoryId: string
  exactFreqStr: string
  onDismiss?: (id: string) => void
  onCopy: () => void
  copied: boolean
  layout: 'desktop' | 'mobile' | 'copy-only'
}

export const IssueCardActions = memo(function IssueCardActions({
  advisoryId,
  exactFreqStr,
  onDismiss,
  onCopy,
  copied,
  layout,
}: IssueCardActionsProps) {
  if (layout === 'copy-only') {
    return (
      <button
        onClick={onCopy}
        aria-label={`Copy ${exactFreqStr} frequency info`}
        className={`${COPY_BTN} size-11 flex-shrink-0 self-center ${
          copied
            ? 'text-[var(--console-amber)]'
            : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/60'
        }`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    )
  }

  if (layout === 'desktop') {
    return (
      <div className="flex items-center gap-0 flex-shrink-0 flex-wrap">
        {onDismiss ? (
          <button
            onClick={() => onDismiss(advisoryId)}
            aria-label={`Dismiss ${exactFreqStr}`}
            className="rounded flex items-center justify-center cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-muted-foreground/55 hover:text-muted-foreground hover:bg-muted/60 transition-colors w-6 h-6"
          >
            <X className="w-3 h-3" />
          </button>
        ) : null}
        <button
          onClick={onCopy}
          aria-label={`Copy ${exactFreqStr} frequency info`}
          className={`${COPY_BTN} h-6 w-6 ${
            copied
              ? 'text-[var(--console-amber)]'
              : 'text-muted-foreground/55 hover:text-muted-foreground hover:bg-muted/60'
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
        {copied ? <span className="sr-only" role="status">Frequency info copied</span> : null}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-0 flex-nowrap leading-none">
      {onDismiss ? (
        <button
          onClick={() => onDismiss(advisoryId)}
          aria-label={`Dismiss ${exactFreqStr}`}
          className="rounded-sm inline-flex items-center justify-center p-0 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-muted-foreground/55 hover:text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      ) : null}
      <button
        onClick={onCopy}
        aria-label={`Copy ${exactFreqStr}`}
        className={`${COPY_BTN} p-0 ${
          copied
            ? 'text-[var(--console-amber)]'
            : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/60'
        }`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {copied ? <span className="sr-only" role="status">Frequency info copied</span> : null}
    </div>
  )
})
