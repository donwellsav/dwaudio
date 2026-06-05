'use client'

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useEngine } from '@/contexts/EngineContext'
import { useGeneralUIState } from '@/hooks/useGeneralUIState'
import { useRtaFullscreenState } from '@/hooks/useRtaFullscreenState'

export interface UIContextValue {
  mobileTab: 'issues' | 'settings'
  setMobileTab: (tab: 'issues' | 'settings') => void
  isFrozen: boolean
  toggleFreeze: () => void
  rtaContainerRef: (node: HTMLDivElement | null) => void
  isRtaFullscreen: boolean
  toggleRtaFullscreen: () => void
}

const UIContext = createContext<UIContextValue | null>(null)

interface UIProviderProps {
  children: ReactNode
}

export function UIProvider({ children }: UIProviderProps) {
  const { isRunning } = useEngine()
  const generalState = useGeneralUIState(isRunning)
  const rtaFullscreenState = useRtaFullscreenState()

  const value = useMemo<UIContextValue>(() => ({
    ...generalState,
    ...rtaFullscreenState,
  }), [generalState, rtaFullscreenState])

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within <UIProvider>')
  return ctx
}
