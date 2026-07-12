import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ManagerRecentRequest } from '../../types/analytics'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import { loadRecentRequests } from '../../services/analytics'
import { archiveRequestForManager } from '../../services/managerPersonalArchive'
import { loadInstitutionRequestReminderSummaries, subscribeToInstitutionRequestReminders, unsubscribeFromInstitutionRequestReminders, upsertReminderSummary } from '../../services/requestReminders'
import type { RequestReminderSummary } from '../../types/requestReminder'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavClipboardIcon } from '../dashboard/dashboardNav'
import type { RequestDetailsManagerRequest } from '../../types/requestDetails'
import { RequestArchiveTrashButton } from '../requests/RequestArchiveTrashButton'
import { RequestDetailsModal } from '../requests/RequestDetailsModal'
import { DashboardSection } from '../dashboard/DashboardSection'
import { ConfirmDialog } from '../ui/Modal'
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
  const [detailsRequest, setDetailsRequest] = useState<RequestDetailsManagerRequest | null>(null)
  const [detailsReturnFocusElement, setDetailsReturnFocusElement] = useState<HTMLElement | null>(
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

  function handleOpenDetails(request: ManagerRecentRequest, rowElement: HTMLTableRowElement) {
    setDetailsReturnFocusElement(rowElement)
    setDetailsRequest({ ...request, role: 'manager' })
  }

  function handleCloseDetails() {
    setDetailsRequest(null)
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
    setDetailsRequest((current) =>
      current?.id === archiveDialogRequest.id ? null : current,
    )
    onArchived()
  }

  return (
    <section className="ds-card manager-dashboard__insight-card" aria-label="בקשות אחרונות">
      <DashboardSection
        title="בקשות אחרונות"
        icon={<NavClipboardIcon />}
        className="dashboard-section--flush-header"
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
            onOpenDetails={handleOpenDetails}
          />
        )}
      </DashboardSection>

      {archiveDialogRequest && (
        <ConfirmDialog
          isOpen
          title="להעביר לארכיון האישי?"
          message='הבקשה תוסר מתצוגת הבקשות הפעילות שלך בלבד ותופיע ב"הארכיון שלי". הבקשה תישאר פעילה עבור שאר המשתמשים במערכת.'
          continueLabel="ביטול"
          confirmLabel={archivingRequestId !== null ? 'מעביר...' : 'כן, להעביר לארכיון'}
          closeOnBackdropClick
          continueDisabled={archivingRequestId !== null}
          confirmDisabled={archivingRequestId !== null}
          onContinue={handleCloseArchiveDialog}
          onConfirm={handleConfirmArchive}
        />
      )}

      {detailsRequest && (
        <RequestDetailsModal
          isOpen
          request={detailsRequest}
          returnFocusElement={detailsReturnFocusElement}
          reminderSummary={reminderSummariesByRequestId.get(detailsRequest.id)}
          hasUnreadReminder={unreadReminderRequestIds.has(detailsRequest.id)}
          showHistory
          showNotes={false}
          onClose={handleCloseDetails}
          actions={
            <RequestArchiveTrashButton
              teacherName={detailsRequest.teacher_full_name}
              isArchiving={archivingRequestId === detailsRequest.id}
              isDisabled={archivingRequestId !== null && archivingRequestId !== detailsRequest.id}
              onArchive={() => handleOpenArchiveDialog(detailsRequest)}
            />
          }
        />
      )}
    </section>
  )
}
