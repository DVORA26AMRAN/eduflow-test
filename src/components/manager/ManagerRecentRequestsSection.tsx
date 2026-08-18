import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  canOrdinaryStatusUpdate,
  canShowHandlerStatusSelect,
  isEligibleHandlerRole,
} from '../../domain/requestOwnership'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { archiveRequestForManager } from '../../services/managerPersonalArchive'
import { claimRequest } from '../../services/requestOwnership'
import { loadOperatorInboxRequests, updateRequestStatus } from '../../services/requests'
import {
  loadInstitutionRequestReminderSummaries,
  subscribeToInstitutionRequestReminders,
  unsubscribeFromInstitutionRequestReminders,
  upsertReminderSummary,
} from '../../services/requestReminders'
import type { ManagerRecentRequest } from '../../types/analytics'
import type { RequestDetailsManagerRequest } from '../../types/requestDetails'
import type { RequestStatus } from '../../types/request'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import type { RequestReminderSummary } from '../../types/requestReminder'
import {
  isRequestOwnershipConflictCode,
  type RequestHandlerAssignedPatch,
} from '../../types/requestOwnership'
import type { PrimaryRole } from '../../types/user'
import { NavClipboardIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { RequestArchiveTrashButton } from '../requests/RequestArchiveTrashButton'
import { RequestDetailsModal } from '../requests/RequestDetailsModal'
import { ConfirmDialog } from '../ui/Modal'
import { ManagerRecentRequestsTable } from './ManagerRecentRequestsTable'

type ManagerRecentRequestsSectionProps = {
  refreshToken: number
  onArchived: () => void
  actorUserId: string
  actorRole: PrimaryRole
  actorFullName: string
  institutionId?: string | null
  canChangeStatus?: boolean
  unreadReminderRequestIds?: ReadonlySet<string>
  unreadMessageRequestIds?: ReadonlySet<string>
  requestIdsWithMessages?: ReadonlySet<string>
  onConversationOpened?: (requestId: string) => void | Promise<boolean>
  reminderNavigationIntent?: ReminderNavigationIntent | null
  highlightedRequestId?: string | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
}

export function ManagerRecentRequestsSection({
  refreshToken,
  onArchived,
  actorUserId,
  actorRole,
  actorFullName,
  institutionId,
  canChangeStatus = true,
  unreadReminderRequestIds = new Set(),
  unreadMessageRequestIds = new Set(),
  requestIdsWithMessages = new Set(),
  onConversationOpened,
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
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
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
      loadOperatorInboxRequests(),
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

  async function handleStatusChange(requestId: string, status: RequestStatus) {
    if (!canChangeStatus) {
      return
    }

    const currentRequest = requests.find((request) => request.id === requestId)
    if (!currentRequest || currentRequest.status === status) {
      return
    }

    if (
      !canShowHandlerStatusSelect({
        actorUserId,
        handledByUserId: currentRequest.handled_by_user_id,
      }) ||
      !canOrdinaryStatusUpdate({
        actorUserId,
        handledByUserId: currentRequest.handled_by_user_id,
        currentStatus: currentRequest.status,
        nextStatus: status,
      })
    ) {
      return
    }

    setStatusMessage('')
    setUpdatingRequestId(requestId)

    const result = await updateRequestStatus(requestId, status)

    setUpdatingRequestId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === requestId ? { ...request, status } : request,
      ),
    )
    setDetailsRequest((current) =>
      current?.id === requestId ? { ...current, status } : current,
    )
    setStatusMessage('סטטוס הבקשה עודכן בהצלחה.')
    setStatusMessageIsError(false)
  }

  function applyAssignmentPatch(patch: RequestHandlerAssignedPatch) {
    const assignment = {
      handled_by_user_id: patch.handledByUserId,
      handled_by_full_name: patch.handledByFullName,
      handled_by_primary_role: patch.handledByPrimaryRole,
      status: patch.status,
    }

    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === patch.requestId ? { ...request, ...assignment } : request,
      ),
    )
    setDetailsRequest((current) =>
      current?.id === patch.requestId ? { ...current, ...assignment } : current,
    )
  }

  async function handleOwnershipError(message: string, errorCode?: string) {
    setStatusMessage(message)
    setStatusMessageIsError(true)
    if (isRequestOwnershipConflictCode(errorCode)) {
      await fetchRequests()
    }
  }

  async function handleClaim(requestId: string) {
    setStatusMessage('')
    setUpdatingRequestId(requestId)
    const result = await claimRequest(requestId)
    setUpdatingRequestId(null)

    if (!result.ok) {
      await handleOwnershipError(result.errorMessage, result.errorCode)
      return
    }

    applyAssignmentPatch({
      requestId,
      handledByUserId: result.handledByUserId,
      handledByFullName: actorFullName,
      handledByPrimaryRole: isEligibleHandlerRole(actorRole) ? actorRole : 'institution_manager',
      status: result.status,
    })
    setStatusMessage('הבקשה נלקחה לטיפול.')
    setStatusMessageIsError(false)
  }

  function handleHandlerAssigned(patch: RequestHandlerAssignedPatch) {
    applyAssignmentPatch(patch)
    setStatusMessage('הטיפול הועבר בהצלחה.')
    setStatusMessageIsError(false)
  }

  function handleHandlerReleased(requestId: string, status: RequestStatus) {
    const assignment = {
      handled_by_user_id: null,
      handled_by_full_name: null,
      handled_by_primary_role: null,
      status,
    }
    setRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === requestId ? { ...request, ...assignment } : request,
      ),
    )
    setDetailsRequest((current) =>
      current?.id === requestId ? { ...current, ...assignment } : current,
    )
    setStatusMessage('הטיפול שוחרר.')
    setStatusMessageIsError(false)
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
    <section className="ds-card manager-dashboard__requests-card" aria-label="בקשות מורים">
      <DashboardSection
        title="בקשות מורים"
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
            actorUserId={actorUserId}
            actorRole={actorRole}
            institutionId={institutionId}
            archivingRequestId={archivingRequestId}
            updatingRequestId={updatingRequestId}
            canChangeStatus={canChangeStatus}
            unreadReminderRequestIds={unreadReminderRequestIds}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            highlightedRequestId={highlightedRequestId}
            onArchive={handleOpenArchiveDialog}
            onOpenDetails={handleOpenDetails}
            onStatusChange={canChangeStatus ? handleStatusChange : undefined}
            onClaim={(requestId) => void handleClaim(requestId)}
            onHandlerAssigned={handleHandlerAssigned}
            onHandlerReleased={handleHandlerReleased}
            onHandlerError={(message, errorCode) => {
              void handleOwnershipError(message, errorCode)
            }}
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
          onConversationOpened={() => void onConversationOpened?.(detailsRequest.id)}
          showHistory
          showNotes={false}
          ownership={{
            actorUserId,
            actorRole,
            institutionId,
            isBusy: updatingRequestId === detailsRequest.id || archivingRequestId !== null,
            onClaim: (requestId) => void handleClaim(requestId),
            onAssigned: handleHandlerAssigned,
            onReleased: handleHandlerReleased,
            onError: (message, errorCode) => {
              void handleOwnershipError(message, errorCode)
            },
          }}
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
