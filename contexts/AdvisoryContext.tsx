'use client'

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import type { Advisory } from '@/types/advisory'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'
import { useDetection } from '@/contexts/DetectionContext'
import { useAdvisoryClearState } from '@/hooks/useAdvisoryClearState'

/** High-frequency data — changes on every advisory update from the worker. */
export interface AdvisoryDataContextValue {
  advisories: Advisory[]
  activeAdvisoryCount: number
  earlyWarning: EarlyWarning | null
  dismissedIds: Set<string>
  lastDismissedId: string | null
  rtaClearedIds: Set<string>
  geqClearedIds: Set<string>
  hasActiveRTAMarkers: boolean
  hasActiveGEQBars: boolean
}

/** Low-frequency actions — stable callbacks, only change on user interaction. */
export interface AdvisoryActionsContextValue {
  restoreDismissedAdvisory: (advisoryId: string) => void
  onDismiss: (id: string) => void
  onClearAll: () => void
  onClearResolved: () => void
  onClearRTA: () => void
  onClearGEQ: () => void
}

/** Combined type for consumers that need both. */
export type AdvisoryContextValue = AdvisoryDataContextValue & AdvisoryActionsContextValue

const AdvisoryDataContext = createContext<AdvisoryDataContextValue | null>(null)
const AdvisoryActionsContext = createContext<AdvisoryActionsContextValue | null>(null)

interface AdvisoryProviderProps {
  children: ReactNode
}

export function AdvisoryProvider({
  children,
}: AdvisoryProviderProps) {
  const { advisories, earlyWarning } = useDetection()
  const {
    clearState,
    lastDismissedId,
    activeAdvisoryCount,
    hasActiveGEQBars,
    hasActiveRTAMarkers,
    onDismiss,
    restoreDismissed,
    onClearAll,
    onClearResolved,
    onClearGEQ,
    onClearRTA,
  } = useAdvisoryClearState(advisories)

  const dataValue = useMemo<AdvisoryDataContextValue>(
    () => ({
      advisories,
      activeAdvisoryCount,
      earlyWarning,
      dismissedIds: clearState.dismissed,
      lastDismissedId,
      rtaClearedIds: clearState.rtaCleared,
      geqClearedIds: clearState.geqCleared,
      hasActiveRTAMarkers,
      hasActiveGEQBars,
    }),
    [
      advisories,
      activeAdvisoryCount,
      earlyWarning,
      clearState.dismissed,
      lastDismissedId,
      clearState.rtaCleared,
      clearState.geqCleared,
      hasActiveRTAMarkers,
      hasActiveGEQBars,
    ],
  )

  const actionsValue = useMemo<AdvisoryActionsContextValue>(
    () => ({
      restoreDismissedAdvisory: restoreDismissed,
      onDismiss,
      onClearAll,
      onClearResolved,
      onClearRTA,
      onClearGEQ,
    }),
    [
      restoreDismissed,
      onDismiss,
      onClearAll,
      onClearResolved,
      onClearRTA,
      onClearGEQ,
    ],
  )

  return (
    <AdvisoryDataContext.Provider value={dataValue}>
      <AdvisoryActionsContext.Provider value={actionsValue}>
        {children}
      </AdvisoryActionsContext.Provider>
    </AdvisoryDataContext.Provider>
  )
}

/** Read advisory data + actions. Triggers on any advisory change. */
export function useAdvisories(): AdvisoryContextValue {
  const data = useContext(AdvisoryDataContext)
  const actions = useContext(AdvisoryActionsContext)
  if (!data || !actions) {
    throw new Error('useAdvisories must be used within <AdvisoryProvider>')
  }
  return { ...data, ...actions }
}

/** Read only actions. Does not re-render on advisory data changes. */
export function useAdvisoryActions(): AdvisoryActionsContextValue {
  const ctx = useContext(AdvisoryActionsContext)
  if (!ctx) {
    throw new Error('useAdvisoryActions must be used within <AdvisoryProvider>')
  }
  return ctx
}

/** Read only advisory data. Does not re-render on action changes. */
export function useAdvisoryData(): AdvisoryDataContextValue {
  const ctx = useContext(AdvisoryDataContext)
  if (!ctx) {
    throw new Error('useAdvisoryData must be used within <AdvisoryProvider>')
  }
  return ctx
}
