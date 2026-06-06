'use client'

import { useEffect, useRef, useState } from 'react'
import { getSeverityText } from '@/lib/utils/advisoryDisplay'
import { formatFrequency } from '@/lib/utils/pitchUtils'
import type { Advisory } from '@/types/advisory'
import type { IssueListEntry } from '@/hooks/useIssuesListEntries'

const ISSUE_ANNOUNCEMENT_THROTTLE_MS = 3000
const ISSUE_ANNOUNCEMENT_PRUNE_LIMIT = 200
const ISSUE_ANNOUNCEMENT_RETAIN_COUNT = 100

export function formatIssueAnnouncement(advisory: Advisory): string {
  const frequency = formatFrequency(advisory.trueFrequencyHz)
  if (advisory.lifecycle === 'provisional') {
    return `Possible feedback at ${frequency}`
  }
  const severity = getSeverityText(advisory.severity)
  const peq = advisory.advisory?.peq
  const cutDetail = peq
    ? `, cut ${Math.abs(peq.gainDb).toFixed(0)} dB at Q ${peq.q.toFixed(0)}`
    : ''

  return `Feedback detected at ${frequency}, severity ${severity}${cutDetail}`
}

export function useIssueAnnouncement(entries: IssueListEntry[]): string {
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const announcedIdsRef = useRef(new Set<string>())
  const lastAnnounceTimeRef = useRef(0)

  useEffect(() => {
    const now = Date.now()
    if (now - lastAnnounceTimeRef.current < ISSUE_ANNOUNCEMENT_THROTTLE_MS) return

    if (announcedIdsRef.current.size > ISSUE_ANNOUNCEMENT_PRUNE_LIMIT) {
      const retainedIds = [...announcedIdsRef.current].slice(-ISSUE_ANNOUNCEMENT_RETAIN_COUNT)
      announcedIdsRef.current = new Set(retainedIds)
    }

    let nextAnnouncement: string | null = null

    for (const entry of entries) {
      const { advisory } = entry
      if (
        entry.isHeld ||
        announcedIdsRef.current.has(advisory.id) ||
        advisory.resolved ||
        advisory.lifecycle === 'provisional'
      ) continue

      announcedIdsRef.current.add(advisory.id)
      lastAnnounceTimeRef.current = now
      nextAnnouncement = formatIssueAnnouncement(advisory)
      break
    }

    if (nextAnnouncement === null) return

    const timeoutId = window.setTimeout(() => {
      setLiveAnnouncement(nextAnnouncement)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [entries])

  return liveAnnouncement
}
