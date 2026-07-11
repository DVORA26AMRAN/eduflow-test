import { useCallback, useEffect, useState } from 'react'
import type { SubstituteBoardPendingApproval } from '../../types/substituteBoard'
import {
  SECRETARY_SUBSTITUTE_APPROVALS_EMPTY_MESSAGE,
  SECRETARY_SUBSTITUTE_APPROVALS_LOADING_MESSAGE,
  SECRETARY_SUBSTITUTE_APPROVAL_SUCCESS_MESSAGE,
} from '../../types/substituteBoard'
import {
  approveSubstituteBoardPost,
  loadPendingSubstituteBoardApprovals,
} from '../../services/substituteBoard'
import { NavUsersIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { SecretarySubstituteApprovalsTable } from './SecretarySubstituteApprovalsTable'

export function SecretarySubstituteApprovalsSection() {
  const [approvals, setApprovals] = useState<SubstituteBoardPendingApproval[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [approvingPostId, setApprovingPostId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)

  const fetchApprovals = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadPendingSubstituteBoardApprovals()

    if (!result.ok) {
      setApprovals([])
      setLoadError(result.errorMessage)
    } else {
      setApprovals(result.approvals)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchApprovals()
    })
  }, [fetchApprovals])

  async function handleApprove(postId: string) {
    setStatusMessage('')
    setApprovingPostId(postId)

    const result = await approveSubstituteBoardPost(postId)

    setApprovingPostId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      return
    }

    setApprovals((currentApprovals) =>
      currentApprovals.filter((approval) => approval.id !== postId),
    )
    setStatusMessage(SECRETARY_SUBSTITUTE_APPROVAL_SUCCESS_MESSAGE)
    setStatusMessageIsError(false)
  }

  return (
    <section className="ds-card secretary-dashboard__substitute-approvals">
      <DashboardCollapsibleSection
        title="מילויי מקום ממתינים לאישור"
        icon={<NavUsersIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
        {statusMessage && (
          <p
            className={
              statusMessageIsError
                ? 'ds-form-message ds-form-message--error'
                : 'ds-form-message ds-form-message--success'
            }
          >
            {statusMessage}
          </p>
        )}

        {isLoading && (
          <p className="ds-form-message">
            {SECRETARY_SUBSTITUTE_APPROVALS_LOADING_MESSAGE}
          </p>
        )}

        {!isLoading && loadError && (
          <p className="ds-form-message ds-form-message--error">{loadError}</p>
        )}

        {!isLoading && !loadError && (
          <SecretarySubstituteApprovalsTable
            approvals={approvals}
            emptyMessage={SECRETARY_SUBSTITUTE_APPROVALS_EMPTY_MESSAGE}
            approvingPostId={approvingPostId}
            onApprove={(postId) => void handleApprove(postId)}
          />
        )}
      </DashboardCollapsibleSection>
    </section>
  )
}
