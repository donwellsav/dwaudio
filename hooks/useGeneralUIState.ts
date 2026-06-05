'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

export interface GeneralUIState {
  mobileTab: 'issues' | 'settings'
  setMobileTab: (tab: 'issues' | 'settings') => void
  isFrozen: boolean
  toggleFreeze: () => void
}

export function useGeneralUIState(
  isRunning: boolean,
): GeneralUIState {
  const [mobileTab, setMobileTab] = useState<'issues' | 'settings'>('issues')
  const [isFrozen, setIsFrozen] = useState(false)

  const toggleFreeze = useCallback(() => {
    setIsFrozen((previous) => !previous)
  }, [])

  useEffect(() => {
    if (isRunning) return

    const timeoutId = window.setTimeout(() => {
      setIsFrozen(false)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [isRunning])

  return useMemo(() => ({
    mobileTab,
    setMobileTab,
    isFrozen,
    toggleFreeze,
  }), [
    mobileTab,
    setMobileTab,
    isFrozen,
    toggleFreeze,
  ])
}
