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
    void fetchApprovals()
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
    <section className="secretary-dashboard__substitute-approvals">
      <h2 className="secretary-dashboard__section-title">מילויי מקום ממתינים לאישור</h2>

      {statusMessage && (
        <p
          className={
            statusMessageIsError
              ? 'secretary-dashboard__status secretary-dashboard__status--error'
              : 'secretary-dashboard__status secretary-dashboard__status--success'
          }
        >
          {statusMessage}
        </p>
      )}

      {isLoading && (
        <p className="secretary-dashboard__status">
          {SECRETARY_SUBSTITUTE_APPROVALS_LOADING_MESSAGE}
        </p>
      )}

      {!isLoading && loadError && (
        <p className="secretary-dashboard__status secretary-dashboard__status--error">
          {loadError}
        </p>
      )}

      {!isLoading && !loadError && (
        <SecretarySubstituteApprovalsTable
          approvals={approvals}
          emptyMessage={SECRETARY_SUBSTITUTE_APPROVALS_EMPTY_MESSAGE}
          approvingPostId={approvingPostId}
          onApprove={(postId) => void handleApprove(postId)}
        />
      )}
    </section>
  )
}
