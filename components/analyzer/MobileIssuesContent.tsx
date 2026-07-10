'use client'

import { memo, type ComponentProps } from 'react'
import { EarlyWarningPanel } from '@/components/analyzer/EarlyWarningPanel'
import { ErrorBoundary } from '@/components/analyzer/ErrorBoundary'
import { IssuesList } from '@/components/analyzer/IssuesList'
import type { Advisory } from '@/types/advisory'

type IssuesListBaseProps = Pick<
  ComponentProps<typeof IssuesList>,
  | 'dismissedIds'
  | 'isRunning'
  | 'onStart'
  | 'isLowSignal'
  | 'showAlgorithmScores'
  | 'showPeqDetails'
  | 'onDismiss'
  | 'onRestoreDismissed'
>

interface MobileIssuesContentProps {
  mobileAdvisories: Advisory[]
  earlyWarning: ComponentProps<typeof EarlyWarningPanel>['earlyWarning']
  issuesListBaseProps: IssuesListBaseProps
  onClearAll: () => void
  onClearResolved: () => void
}

export const MobileIssuesContent = memo(function MobileIssuesContent({
  mobileAdvisories,
  earlyWarning,
  issuesListBaseProps,
  onClearAll,
  onClearResolved,
}: MobileIssuesContentProps) {
  return (
    <>
      <ErrorBoundary>
        <IssuesList
          {...issuesListBaseProps}
          advisories={mobileAdvisories}
          maxIssues={mobileAdvisories.length}
          onClearAll={onClearAll}
          onClearResolved={onClearResolved}
          touchFriendly
        />
      </ErrorBoundary>
      <EarlyWarningPanel earlyWarning={earlyWarning} />
    </>
  )
})
