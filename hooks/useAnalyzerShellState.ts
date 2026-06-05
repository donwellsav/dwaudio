'use client'

import { useCallback, useState } from 'react'
import { usePanelRef } from '@/components/ui/resizable'

export interface AnalyzerShellState {
  activeSidebarTab: 'issues' | 'controls'
  setActiveSidebarTab: (tab: 'issues' | 'controls') => void
  issuesPanelOpen: boolean
  setIssuesPanelOpen: (open: boolean) => void
  issuesPanelRef: ReturnType<typeof usePanelRef>
  openIssuesPanel: () => void
  closeIssuesPanel: () => void
  closeIssuesPanelToIssues: () => void
  isErrorDismissed: boolean
  setIsErrorDismissed: (dismissed: boolean) => void
  handleRetry: () => void
}

export function useAnalyzerShellState(
  error: string | null,
  start: () => Promise<void>,
): AnalyzerShellState {
  const [activeSidebarTab, setActiveSidebarTab] = useState<'issues' | 'controls'>('controls')
  const [issuesPanelOpen, setIssuesPanelOpen] = useState(true)
  const issuesPanelRef = usePanelRef()

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const isErrorDismissed = error !== null && dismissedError === error
  const setIsErrorDismissed = useCallback((dismissed: boolean) => {
    setDismissedError(dismissed && error !== null ? error : null)
  }, [error])

  const handleRetry = useCallback(() => {
    setDismissedError(null)
    void start()
  }, [start])

  const openIssuesPanel = useCallback(() => {
    setIssuesPanelOpen(true)
    setActiveSidebarTab(prev => (prev === 'issues' ? 'controls' : prev))
    requestAnimationFrame(() => issuesPanelRef.current?.resize('22%'))
  }, [issuesPanelRef])

  const closeIssuesPanel = useCallback(() => {
    issuesPanelRef.current?.collapse()
  }, [issuesPanelRef])

  const closeIssuesPanelToIssues = useCallback(() => {
    setActiveSidebarTab('issues')
    issuesPanelRef.current?.collapse()
  }, [issuesPanelRef])

  return {
    activeSidebarTab,
    setActiveSidebarTab,
    issuesPanelOpen,
    setIssuesPanelOpen,
    issuesPanelRef,
    openIssuesPanel,
    closeIssuesPanel,
    closeIssuesPanelToIssues,
    isErrorDismissed,
    setIsErrorDismissed,
    handleRetry,
  }
}
