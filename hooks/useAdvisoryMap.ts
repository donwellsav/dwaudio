/**
 * useAdvisoryMap owns the advisory Map, sorting, dedup, and cache.
 *
 * Data flow:
 *   Worker -> onAdvisory/onAdvisoryCleared -> Map update -> sort -> setAdvisories -> React
 *
 * Key design choices:
 *   - O(1) Map lookup for per-advisory updates
 *   - Sorted cache with dirty flag so only structural changes force a full re-sort
 *   - Frequency-proximity dedup to prevent duplicate cards for the same feedback band
 *   - Identity-stable callbacks because useAudioAnalyzer stores them once for the DSP worker
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { getSeverityUrgency } from '@/lib/dsp/classifier'
import type { Advisory } from '@/types/advisory'

const PROVISIONAL_RESOLVED_DISMISS_MS = 1600

export interface UseAdvisoryMapReturn {
  advisories: Advisory[]
  onAdvisory: (advisory: Advisory) => void
  onAdvisoryCleared: (advisoryId: string) => void
  clearMap: () => void
}

export function useAdvisoryMap(
  maxDisplayedIssues: number,
  frozenRef?: React.RefObject<boolean>,
): UseAdvisoryMapReturn {
  const [advisories, setAdvisories] = useState<Advisory[]>([])

  const mapRef = useRef<Map<string, Advisory>>(new Map())
  const sortedCacheRef = useRef<Advisory[]>([])
  const dirtyRef = useRef(false)
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const frozenBufferRef = useRef<{ updates: Advisory[]; clears: string[] }>({
    updates: [],
    clears: [],
  })
  const wasFrozenRef = useRef(false)

  const buildSorted = useCallback(() => {
    const sorted = Array.from(mapRef.current.values())
      .sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? 1 : -1

        const urgencyA = getSeverityUrgency(a.severity)
        const urgencyB = getSeverityUrgency(b.severity)
        if (urgencyA !== urgencyB) return urgencyB - urgencyA

        return b.trueAmplitudeDb - a.trueAmplitudeDb
      })
      .slice(0, maxDisplayedIssues)

    sortedCacheRef.current = sorted
    dirtyRef.current = false
    return sorted
  }, [maxDisplayedIssues])

  const buildSortedRef = useRef(buildSorted)
  useEffect(() => {
    buildSortedRef.current = buildSorted
  }, [buildSorted])

  const applyToMap = useCallback((advisory: Advisory) => {
    const map = mapRef.current
    const existing = map.get(advisory.id)

    if (existing) {
      map.set(advisory.id, advisory)
      if (
        existing.resolved !== advisory.resolved ||
        getSeverityUrgency(existing.severity) !== getSeverityUrgency(advisory.severity) ||
        existing.trueAmplitudeDb !== advisory.trueAmplitudeDb
      ) {
        dirtyRef.current = true
      }
      return
    }

    let replacedKey: string | null = null
    for (const [key, current] of map) {
      const cents = Math.abs(1200 * Math.log2(advisory.trueFrequencyHz / current.trueFrequencyHz))
      if (cents <= 100) {
        replacedKey = key
        break
      }
    }

    if (replacedKey) map.delete(replacedKey)
    map.set(advisory.id, advisory)
    dirtyRef.current = true
  }, [])

  const flushToReact = useCallback(() => {
    if (dirtyRef.current) {
      setAdvisories(buildSortedRef.current())
      return
    }

    // Non-structural update: only advisory fields changed, not sort order.
    // Build new array but skip setAdvisories if no visible advisory actually changed
    // (prevents unnecessary IssuesList/IssueCard re-render cascade).
    const prev = sortedCacheRef.current
    let anyChanged = false
    const sorted = prev.map(advisory => {
      const latest = mapRef.current.get(advisory.id)
      if (latest && latest !== advisory) anyChanged = true
      return latest ?? advisory
    })
    if (!anyChanged) return // Identity-stable — no React update needed
    sortedCacheRef.current = sorted
    setAdvisories(sorted)
  }, [])

  const clearRemovalTimer = useCallback((advisoryId: string) => {
    const timerId = removalTimersRef.current.get(advisoryId)
    if (!timerId) return
    clearTimeout(timerId)
    removalTimersRef.current.delete(advisoryId)
  }, [])

  const scheduleProvisionalRemoval = useCallback((advisoryId: string) => {
    clearRemovalTimer(advisoryId)
    const timerId = setTimeout(() => {
      removalTimersRef.current.delete(advisoryId)
      const current = mapRef.current.get(advisoryId)
      if (!current?.resolved || current.lifecycle !== 'provisional') return

      mapRef.current.delete(advisoryId)
      dirtyRef.current = true
      if (frozenRef?.current ?? false) return
      setAdvisories(buildSortedRef.current())
    }, PROVISIONAL_RESOLVED_DISMISS_MS)
    removalTimersRef.current.set(advisoryId, timerId)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- frozenRef is a stable ref, read imperatively
  }, [clearRemovalTimer])

  const onAdvisory = useCallback((advisory: Advisory) => {
    clearRemovalTimer(advisory.id)
    const isFrozen = frozenRef?.current ?? false

    if (isFrozen && advisory.severity !== 'RUNAWAY' && advisory.severity !== 'GROWING') {
      frozenBufferRef.current.updates.push(advisory)
      applyToMap(advisory)
      return
    }

    applyToMap(advisory)
    flushToReact()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- frozenRef is a stable ref, read imperatively
  }, [applyToMap, clearRemovalTimer, flushToReact])

  const onAdvisoryCleared = useCallback((advisoryId: string) => {
    const existing = mapRef.current.get(advisoryId)
    if (!existing || existing.resolved) return

    mapRef.current.set(advisoryId, {
      ...existing,
      resolved: true,
      resolvedAt: Date.now(),
    })
    dirtyRef.current = true
    if (existing.lifecycle === 'provisional') {
      scheduleProvisionalRemoval(advisoryId)
    }

    const isFrozen = frozenRef?.current ?? false
    if (isFrozen) {
      frozenBufferRef.current.clears.push(advisoryId)
      return
    }

    setAdvisories(buildSortedRef.current())
  // eslint-disable-next-line react-hooks/exhaustive-deps -- frozenRef is a stable ref, read imperatively
  }, [scheduleProvisionalRemoval])

  useEffect(() => {
    const timers = removalTimersRef.current
    return () => {
      for (const timerId of timers.values()) {
        clearTimeout(timerId)
      }
      timers.clear()
    }
  }, [])

  // frozenRef.current is imperative state, so this needs to run after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const currentlyFrozen = frozenRef?.current ?? false
    if (wasFrozenRef.current && !currentlyFrozen) {
      frozenBufferRef.current = { updates: [], clears: [] }
      dirtyRef.current = true
      setAdvisories(buildSortedRef.current())
    }
    wasFrozenRef.current = currentlyFrozen
  })

  // frozenRef is a stable RefObject — read imperatively, not as a dependency.
  // Including it caused variable-length dep arrays when frozenRef is undefined vs defined.
  useEffect(() => {
    if (mapRef.current.size === 0) return
    dirtyRef.current = true
    if (frozenRef?.current ?? false) return
    setAdvisories(buildSortedRef.current())
  // eslint-disable-next-line react-hooks/exhaustive-deps -- frozenRef is a stable ref, read imperatively
  }, [buildSorted])

  const clearMap = useCallback(() => {
    for (const timerId of removalTimersRef.current.values()) {
      clearTimeout(timerId)
    }
    removalTimersRef.current.clear()
    mapRef.current.clear()
    sortedCacheRef.current = []
    dirtyRef.current = false
    frozenBufferRef.current = { updates: [], clears: [] }
    setAdvisories([])
  }, [])

  return {
    advisories,
    onAdvisory,
    onAdvisoryCleared,
    clearMap,
  }
}
