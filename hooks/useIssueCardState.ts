'use client'

import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { getSeverityColor } from '@/lib/utils/advisoryDisplay'
import {
  formatFrequency,
  formatFrequencyRange,
  formatPitch,
} from '@/lib/utils/pitchUtils'
import {
  RUNAWAY_VELOCITY_THRESHOLD,
  WARNING_VELOCITY_THRESHOLD,
} from '@/components/analyzer/issueCardConfig'
import type { Advisory } from '@/types/advisory'

export type IssueCardActionsLayout = 'desktop' | 'mobile' | 'copy-only' | null

export interface IssueCardDerivedState {
  pitchStr: string | null
  exactFreqStr: string
  isClustered: boolean
  velocity: number
  isRunaway: boolean
  isWarning: boolean
  isResolved: boolean
  peqNotchSvgPath: string | null
}

export function resolveIssueCardActionsLayout(
  touchFriendly?: boolean,
): IssueCardActionsLayout {
  if (!touchFriendly) return 'desktop'
  if (touchFriendly) return 'mobile'
  return null
}

export function buildIssueCardDerivedState(advisory: Advisory): IssueCardDerivedState {
  const pitchStr = advisory.advisory?.pitch ? formatPitch(advisory.advisory.pitch) : null
  const isClustered =
    (advisory.clusterCount ?? 1) > 1 &&
    advisory.clusterMinHz != null &&
    advisory.clusterMaxHz != null
  const exactFreqStr = isClustered
    ? formatFrequencyRange(advisory.clusterMinHz!, advisory.clusterMaxHz!)
    : formatFrequency(advisory.trueFrequencyHz)
  const velocity = advisory.velocityDbPerSec ?? 0
  const isRunaway = velocity >= RUNAWAY_VELOCITY_THRESHOLD || advisory.isRunaway === true
  const isWarning = velocity >= WARNING_VELOCITY_THRESHOLD && !isRunaway
  const isResolved = advisory.resolved === true

  const peq = advisory.advisory?.peq
  if (!peq) {
    return {
      pitchStr,
      exactFreqStr,
      isClustered,
      velocity,
      isRunaway,
      isWarning,
      isResolved,
      peqNotchSvgPath: null,
    }
  }

  const logMin = Math.log10(20)
  const logMax = Math.log10(20000)
  const centerX = ((Math.log10(Math.max(20, peq.hz)) - logMin) / (logMax - logMin)) * 40
  const depth = Math.min(10, (Math.abs(peq.gainDb) / 12) * 10)
  const halfWidth = Math.max(2, Math.min(14, 20 / peq.q))
  const x1 = Math.max(0, centerX - halfWidth)
  const x2 = Math.min(40, centerX + halfWidth)
  const baseline = 5
  const peqNotchSvgPath = `M 0 ${baseline} L ${x1.toFixed(1)} ${baseline} Q ${centerX.toFixed(1)} ${(baseline + depth).toFixed(1)} ${x2.toFixed(1)} ${baseline} L 40 ${baseline}`

  return {
    pitchStr,
    exactFreqStr,
    isClustered,
    velocity,
    isRunaway,
    isWarning,
    isResolved,
    peqNotchSvgPath,
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const writeText = globalThis.navigator?.clipboard?.writeText

  if (writeText) {
    try {
      await writeText.call(globalThis.navigator.clipboard, text)
      return true
    } catch {
      // Fall through to the local DOM copy path below.
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    return false
  }

  const execCommand = document.execCommand
  if (typeof execCommand !== 'function') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    return execCommand.call(document, 'copy') === true
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

interface UseIssueCardStateParams {
  advisory: Advisory
  touchFriendly?: boolean
}

export function useIssueCardState({
  advisory,
  touchFriendly,
}: UseIssueCardStateParams) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const derivedState = useMemo(() => buildIssueCardDerivedState(advisory), [advisory])
  const severityColor = useMemo(
    () => getSeverityColor(advisory.severity, isDark),
    [advisory.severity, isDark],
  )

  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const parts = [derivedState.exactFreqStr]
    if (derivedState.pitchStr) parts.push(`(${derivedState.pitchStr})`)

    copyTextToClipboard(parts.join(' ')).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [derivedState.exactFreqStr, derivedState.pitchStr])

  return {
    ...derivedState,
    severityColor,
    copied,
    handleCopy,
    actionsLayout: resolveIssueCardActionsLayout(touchFriendly),
  }
}
