'use client'

import { memo, type ComponentProps } from 'react'
import { EarlyWarningPanel } from './EarlyWarningPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { IssuesList } from './IssuesList'
import type { EarlyWarning } from '@/hooks/audioAnalyzerTypes'

interface DesktopIssuesContentProps {
  issuesListProps: ComponentProps<typeof IssuesList>
  earlyWarning: EarlyWarning | null
  withErrorBoundary?: boolean
}

export const DesktopIssuesContent = memo(function DesktopIssuesContent({
  issuesListProps,
  earlyWarning,
  withErrorBoundary = false,
}: DesktopIssuesContentProps) {
  const issuesList = <IssuesList {...issuesListProps} />

  return (
    <>
      {withErrorBoundary ? <ErrorBoundary>{issuesList}</ErrorBoundary> : issuesList}
      <EarlyWarningPanel earlyWarning={earlyWarning} />
    </>
  )
})
