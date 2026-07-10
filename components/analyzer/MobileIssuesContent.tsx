'use client'

import { memo, type ComponentProps } from 'react'
import { EarlyWarningPanel } from '@/components/analyzer/EarlyWarningPanel'
import { ErrorBoundary } from '@/components/analyzer/ErrorBoundary'
import { IssuesList } from '@/components/analyzer/IssuesList'
import { MOBILE_MAX_DISPLAYED_ISSUES } from '@/lib/dsp/constants'
import type { Advisory } from '@/types/advisory'

type IssuesListBaseProps = Pick<
  ComponentProps<typeof IssuesList>,
  | 'dismissedIds'
  | 'lastDismissedId'
  | 'isRunning'
  | 'onStart'
  | 'isLowSignal'
  | 'showAlgorithmScores'
  | 'showPeqDetails'
  | 'onDismiss'
  | 'onRestoreDismissed'
>

interface MobileIssuesContentProps {
  advisories: Advisory[]
  earlyWarning: ComponentProps<typeof EarlyWarningPanel>['earlyWarning']
  issuesListBaseProps: IssuesListBaseProps
  onClearAll: () => void
  onClearResolved: () => void
}

export const MobileIssuesContent = memo(function MobileIssuesContent({
  advisories,
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
          advisories={advisories}
          maxIssues={MOBILE_MAX_DISPLAYED_ISSUES}
          onClearAll={onClearAll}
          onClearResolved={onClearResolved}
          touchFriendly
        />
      </ErrorBoundary>
      <EarlyWarningPanel earlyWarning={earlyWarning} />
    </>
  )
})
