import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ManagerRecentRequest } from '../../types/analytics'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import { loadRecentRequests } from '../../services/analytics'
import { archiveRequestForManager } from '../../services/managerPersonalArchive'
import { loadInstitutionRequestReminderSummaries, subscribeToInstitutionRequestReminders, unsubscribeFromInstitutionRequestReminders, upsertReminderSummary } from '../../services/requestReminders'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavClipboardIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { ManagerRecentRequestsTable } from './ManagerRecentRequestsTable'

type ManagerRecentRequestsSectionProps = {
  refreshToken: number
  onArchived: () => void
  institutionId?: string | null
  unreadReminderRequestIds?: ReadonlySet<string>
  reminderNavigationIntent?: ReminderNavigationIntent | null
  highlightedRequestId?: string | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
}

export function ManagerRecentRequestsSection({
  refreshToken,
  onArchived,
  institutionId,
  unreadReminderRequestIds = new Set(),
  reminderNavigationIntent = null,
  highlightedRequestId = null,
  onReminderNavigationComplete,
}: ManagerRecentRequestsSectionProps) {
  const [requests, setRequests] = useState<ManagerRecentRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)
  const [archivingRequestId, setArchivingRequestId] = useState<string | null>(null)
  const [archiveDialogRequest, setArchiveDialogRequest] = useState<ManagerRecentRequest | null>(
    null,
  )
  const [reminderSummariesByRequestId, setReminderSummariesByRequestId] = useState<
    Map<string, RequestReminderSummary>
  >(new Map())

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const [requestsResult, remindersResult] = await Promise.all([
      loadRecentRequests(),
      loadInstitutionRequestReminderSummaries(),
    ])

    if (!requestsResult.ok) {
      setRequests([])
      setErrorMessage(requestsResult.errorMessage)
    } else {
      setRequests(requestsResult.requests)
    }

    if (remindersResult.ok) {
      setReminderSummariesByRequestId(
        new Map(remindersResult.summaries.map((summary) => [summary.request_id, summary])),
      )
    } else {
      setReminderSummariesByRequestId(new Map())
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRequests()
    })
  }, [fetchRequests, refreshToken])

  useEffect(() => {
    if (unreadReminderRequestIds.size === 0) {
      return
    }

    async function refreshReminderSummaries() {
      const result = await loadInstitutionRequestReminderSummaries()
      if (result.ok) {
        setReminderSummariesByRequestId(
          new Map(result.summaries.map((summary) => [summary.request_id, summary])),
        )
      }
    }

    void refreshReminderSummaries()
  }, [unreadReminderRequestIds])

  useEffect(() => {
    if (!institutionId) {
      return
    }

    const channel = subscribeToInstitutionRequestReminders(institutionId, (summary) => {
      setReminderSummariesByRequestId((currentSummaries) => upsertReminderSummary(currentSummaries, summary))
    })

    return () => {
      void unsubscribeFromInstitutionRequestReminders(channel)
    }
  }, [institutionId])

  const requestIds = useMemo(() => new Set(requests.map((request) => request.id)), [requests])

  const handleReminderNavigationComplete = useCallback(
    (token: number, found: boolean) => {
      onReminderNavigationComplete?.(token, found)
    },
    [onReminderNavigationComplete],
  )

  useRequestReminderNavigationEffect({
    intent: reminderNavigationIntent,
    expectedLocationKind: 'manager_recent',
    isReady: !isLoading && !errorMessage,
    isRequestInDataset: (requestId) => requestIds.has(requestId),
    isRequestVisible: (requestId) => requestIds.has(requestId),
    revealRequest: () => {},
    onComplete: handleReminderNavigationComplete,
  })

  function handleOpenArchiveDialog(request: ManagerRecentRequest) {
    setStatusMessage('')
    setArchiveDialogRequest(request)
  }

  function handleCloseArchiveDialog() {
    if (archivingRequestId !== null) {
      return
    }
    setArchiveDialogRequest(null)
  }

  async function handleConfirmArchive() {
    if (!archiveDialogRequest || archivingRequestId !== null) {
      return
    }

    setStatusMessage('')
    setArchivingRequestId(archiveDialogRequest.id)

    const result = await archiveRequestForManager(archiveDialogRequest.id)

    setArchivingRequestId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      setArchiveDialogRequest(null)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== archiveDialogRequest.id),
    )
    setStatusMessage('הבקשה הועברה לארכיון האישי שלך.')
    setStatusMessageIsError(false)
    setArchiveDialogRequest(null)
    onArchived()
  }

  return (
    <section className="ds-card manager-dashboard__insight-card" aria-label="בקשות אחרונות">
      <DashboardCollapsibleSection
        title="בקשות אחרונות"
        icon={<NavClipboardIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
        {statusMessage && (
          <p
            className={
              statusMessageIsError
                ? 'ds-form-message ds-form-message--error manager-dashboard__insight-status'
                : 'ds-form-message ds-form-message--success manager-dashboard__insight-status'
            }
          >
            {statusMessage}
          </p>
        )}

        {isLoading && <p className="manager-dashboard__insight-status">טוען נתונים...</p>}

        {!isLoading && errorMessage && (
          <p className="manager-dashboard__insight-status ds-form-message ds-form-message--error">
            {errorMessage}
          </p>
        )}

        {!isLoading && !errorMessage && requests.length === 0 && (
          <p className="manager-dashboard__insight-status">אין בקשות להצגה.</p>
        )}

        {!isLoading && !errorMessage && requests.length > 0 && (
          <ManagerRecentRequestsTable
            requests={requests}
            archivingRequestId={archivingRequestId}
            unreadReminderRequestIds={unreadReminderRequestIds}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            highlightedRequestId={highlightedRequestId}
            onArchive={handleOpenArchiveDialog}
          />
        )}
      </DashboardCollapsibleSection>

      {archiveDialogRequest && (
        <div
          className="manager-dashboard__archive-confirm-overlay"
          onClick={handleCloseArchiveDialog}
          role="presentation"
        >
          <div
            className="manager-dashboard__archive-confirm-panel ds-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-archive-confirm-title"
          >
            <h3 id="manager-archive-confirm-title" className="manager-dashboard__section-title">
              להעביר לארכיון האישי?
            </h3>
            <p className="ds-form-message">
              הבקשה תוסר מתצוגת הבקשות הפעילות שלך בלבד ותופיע ב&quot;הארכיון שלי&quot;.
              הבקשה תישאר פעילה עבור שאר המשתמשים במערכת.
            </p>
            <div className="manager-dashboard__archive-confirm-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={handleCloseArchiveDialog}
                disabled={archivingRequestId !== null}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={handleConfirmArchive}
                disabled={archivingRequestId !== null}
              >
                {archivingRequestId !== null ? 'מעביר...' : 'כן, להעביר לארכיון'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
