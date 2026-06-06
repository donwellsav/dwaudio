'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Advisory } from '@/types/advisory'

export interface AdvisoryClearState {
  dismissed: Set<string>
  geqCleared: Set<string>
  rtaCleared: Set<string>
}

export interface AdvisoryClearStateHandle {
  clearState: AdvisoryClearState
  activeAdvisoryCount: number
  hasActiveGEQBars: boolean
  hasActiveRTAMarkers: boolean
  onDismiss: (id: string) => void
  restoreDismissed: (id: string) => void
  onClearAll: () => void
  onClearResolved: () => void
  onClearGEQ: () => void
  onClearRTA: () => void
}

function createEmptyClearState(): AdvisoryClearState {
  return {
    dismissed: new Set(),
    geqCleared: new Set(),
    rtaCleared: new Set(),
  }
}

function copyWithAddedId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids)
  next.add(id)
  return next
}

function copyWithRemovedId(ids: ReadonlySet<string>, id: string): Set<string> {
  if (!ids.has(id)) return ids as Set<string>
  const next = new Set(ids)
  next.delete(id)
  return next
}

function makeAdvisoryIdSet(advisories: readonly Advisory[]): Set<string> {
  return new Set(advisories.map((advisory) => advisory.id))
}

/**
 * Prune IDs not in liveIds. Returns the SAME Set reference if nothing
 * was removed (stable identity for downstream memo deps).
 */
function pruneIds(ids: ReadonlySet<string>, liveIds: ReadonlySet<string>): Set<string> {
  let anyRemoved = false
  const next = new Set<string>()
  ids.forEach((id) => {
    if (liveIds.has(id)) {
      next.add(id)
    } else {
      anyRemoved = true
    }
  })
  return anyRemoved ? next : (ids as Set<string>)
}

export function useAdvisoryClearState(
  advisories: readonly Advisory[],
): AdvisoryClearStateHandle {
  const [clearState, setClearState] = useState<AdvisoryClearState>(createEmptyClearState)

  // Derive pruned clear state via useMemo instead of useEffect+setState.
  // This eliminates a render→effect→setState→re-render cycle: the pruned
  // sets are computed synchronously during render with no wasted frame.
  // pruneIds returns the same Set reference when nothing was removed,
  // so downstream memos only recompute when contents actually change.
  const liveIds = useMemo(() => makeAdvisoryIdSet(advisories), [advisories])
  const effectiveClearState = useMemo<AdvisoryClearState>(() => ({
    dismissed: pruneIds(clearState.dismissed, liveIds),
    geqCleared: pruneIds(clearState.geqCleared, liveIds),
    rtaCleared: pruneIds(clearState.rtaCleared, liveIds),
  }), [clearState.dismissed, clearState.geqCleared, clearState.rtaCleared, liveIds])

  // Periodically flush dead IDs from the backing state so they don't
  // accumulate in long-running sessions. Runs in useEffect (commit phase)
  // to avoid render-phase state updates that conflict with React 19
  // concurrent rendering. Fires at most once per 100 liveIds changes.
  const pruneCounterRef = useRef(0)
  useEffect(() => {
    if (++pruneCounterRef.current < 100) return
    pruneCounterRef.current = 0

    const timeoutId = window.setTimeout(() => {
      setClearState((prev) => {
        if (prev.dismissed.size === 0 && prev.geqCleared.size === 0 && prev.rtaCleared.size === 0) {
          return prev
        }
        const dismissed = pruneIds(prev.dismissed, liveIds)
        const geqCleared = pruneIds(prev.geqCleared, liveIds)
        const rtaCleared = pruneIds(prev.rtaCleared, liveIds)
        if (dismissed === prev.dismissed && geqCleared === prev.geqCleared && rtaCleared === prev.rtaCleared) {
          return prev
        }
        return { dismissed, geqCleared, rtaCleared }
      })
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [liveIds])

  const activeAdvisoryCount = useMemo(
    () =>
      advisories.filter(
        (advisory) =>
          !advisory.resolved && !effectiveClearState.dismissed.has(advisory.id),
      ).length,
    [advisories, effectiveClearState.dismissed],
  )

  const hasActiveGEQBars = useMemo(
    () =>
      advisories.some(
        (advisory) =>
          advisory.lifecycle !== 'provisional' &&
          !effectiveClearState.geqCleared.has(advisory.id) &&
          Boolean(advisory.advisory?.geq),
      ),
    [advisories, effectiveClearState.geqCleared],
  )

  const hasActiveRTAMarkers = useMemo(
    () => advisories.some(
      (advisory) =>
        advisory.lifecycle !== 'provisional' &&
        !effectiveClearState.rtaCleared.has(advisory.id),
    ),
    [advisories, effectiveClearState.rtaCleared],
  )

  const onDismiss = useCallback((id: string) => {
    setClearState((prev) => ({
      ...prev,
      dismissed: copyWithAddedId(prev.dismissed, id),
    }))
  }, [])

  const restoreDismissed = useCallback((id: string) => {
    setClearState((prev) => {
      const dismissed = copyWithRemovedId(prev.dismissed, id)
      return dismissed === prev.dismissed ? prev : { ...prev, dismissed }
    })
  }, [])

  const onClearAll = useCallback(() => {
    setClearState((prev) => ({
      ...prev,
      dismissed: makeAdvisoryIdSet(advisories),
    }))
  }, [advisories])

  const onClearResolved = useCallback(() => {
    setClearState((prev) => {
      const dismissed = new Set(prev.dismissed)
      advisories.forEach((advisory) => {
        if (advisory.resolved) {
          dismissed.add(advisory.id)
        }
      })
      return { ...prev, dismissed }
    })
  }, [advisories])

  const onClearGEQ = useCallback(() => {
    setClearState((prev) => ({
      ...prev,
      geqCleared: makeAdvisoryIdSet(advisories),
    }))
  }, [advisories])

  const onClearRTA = useCallback(() => {
    setClearState((prev) => ({
      ...prev,
      rtaCleared: makeAdvisoryIdSet(advisories),
    }))
  }, [advisories])

  return {
    clearState: effectiveClearState,
    activeAdvisoryCount,
    hasActiveGEQBars,
    hasActiveRTAMarkers,
    onDismiss,
    restoreDismissed,
    onClearAll,
    onClearResolved,
    onClearGEQ,
    onClearRTA,
  }
}
