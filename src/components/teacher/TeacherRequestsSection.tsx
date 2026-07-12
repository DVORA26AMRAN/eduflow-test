import { useCallback, useEffect, useState } from 'react'
import type { RequestPayload, RequestType, TeacherRequest } from '../../types/request'
import { REQUEST_CREATED_ATTACHMENT_UPLOAD_FAILED_MESSAGE } from '../../types/attachment'
import { uploadRequestAttachment } from '../../services/attachments'
import { archiveRequest, createTeacherRequest, loadTeacherRequests } from '../../services/requests'
import { NavClipboardIcon, NavInboxIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { TeacherCreateRequestModal } from './TeacherCreateRequestModal'
import { TeacherRequestCategorySelector } from './TeacherRequestCategorySelector'
import { TeacherRequestsList } from './TeacherRequestsList'

type TeacherRequestsSectionProps = {
  refreshToken: number
  onArchived: () => void
}

function getSubmitMessageClassName(message: string): string {
  if (message.includes('בהצלחה')) {
    return 'ds-form-message ds-form-message--success'
  }

  if (message.includes('נכשל')) {
    return 'ds-form-message ds-form-message--error'
  }

  return 'ds-form-message'
}

export function TeacherRequestsSection({ refreshToken, onArchived }: TeacherRequestsSectionProps) {
  const [requests, setRequests] = useState<TeacherRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [requestsListVersion, setRequestsListVersion] = useState(0)
  const [formKey, setFormKey] = useState(0)
  const [activeRequestType, setActiveRequestType] = useState<RequestType | null>(null)
  const [selectedCategoryType, setSelectedCategoryType] = useState<RequestType | ''>('')
  const [archivingRequestId, setArchivingRequestId] = useState<string | null>(null)
  const [archiveDialogRequest, setArchiveDialogRequest] = useState<TeacherRequest | null>(null)

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadTeacherRequests()

    if (!result.ok) {
      setRequests([])
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRequests()
    })
  }, [fetchRequests, requestsListVersion, refreshToken])

  function handleSelectRequestType(requestType: RequestType) {
    if (isSubmitting || activeRequestType !== null) {
      return
    }

    setSelectedCategoryType(requestType)
    setSubmitMessage('')
    setActiveRequestType(requestType)
  }

  function handleCloseCreateModal() {
    if (isSubmitting) {
      return
    }

    setActiveRequestType(null)
    setFormKey((key) => key + 1)
  }

  async function handleCreateRequest(input: {
    requestType: RequestType
    description: string
    requestPayload?: RequestPayload
    attachmentFile: File | null
  }) {
    setSubmitMessage('')
    setIsSubmitting(true)

    const result = await createTeacherRequest({
      requestType: input.requestType,
      description: input.description,
      requestPayload: input.requestPayload,
    })

    if (!result.ok) {
      setIsSubmitting(false)
      setSubmitMessage(result.errorMessage)
      return
    }

    if (input.attachmentFile) {
      const uploadResult = await uploadRequestAttachment({
        requestId: result.requestId,
        file: input.attachmentFile,
      })

      setIsSubmitting(false)

      if (!uploadResult.ok) {
        setSubmitMessage(REQUEST_CREATED_ATTACHMENT_UPLOAD_FAILED_MESSAGE)
        setFormKey((key) => key + 1)
        setRequestsListVersion((version) => version + 1)
        setActiveRequestType(null)
        return
      }
    } else {
      setIsSubmitting(false)
    }

    setSubmitMessage('בקשה נשלחה בהצלחה.')
    setFormKey((key) => key + 1)
    setRequestsListVersion((version) => version + 1)
    setActiveRequestType(null)
    setSelectedCategoryType('')
  }

  function handleOpenArchiveDialog(request: TeacherRequest) {
    setSubmitMessage('')
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

    setSubmitMessage('')
    setArchivingRequestId(archiveDialogRequest.id)

    const result = await archiveRequest(archiveDialogRequest.id)

    setArchivingRequestId(null)

    if (!result.ok) {
      setSubmitMessage(result.errorMessage)
      setArchiveDialogRequest(null)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== archiveDialogRequest.id),
    )
    setSubmitMessage('הבקשה הועברה לארכיון בהצלחה.')
    setArchiveDialogRequest(null)
    onArchived()
  }

  return (
    <section className="teacher-dashboard__requests">
      <DashboardCollapsibleSection title="הבקשות שלי" icon={<NavClipboardIcon />}>
        <div className="ds-card teacher-dashboard__create-card">
          <h3 className="teacher-dashboard__subsection-title">פתיחת בקשה חדשה</h3>

          <TeacherRequestCategorySelector
            selectedType={selectedCategoryType}
            isDisabled={isSubmitting || activeRequestType !== null}
            onSelect={handleSelectRequestType}
          />

          {submitMessage && activeRequestType === null && (
            <p className={getSubmitMessageClassName(submitMessage)}>{submitMessage}</p>
          )}
        </div>

        <div className="ds-card teacher-dashboard__list-card">
          <h3 className="teacher-dashboard__subsection-title">
            <span className="dashboard-card__title-icon" aria-hidden="true">
              <NavInboxIcon />
            </span>
            רשימת בקשות
          </h3>

          {isLoading && <p className="ds-form-message">טוען בקשות...</p>}

          {!isLoading && loadError && (
            <p className="ds-form-message ds-form-message--error">{loadError}</p>
          )}

          {!isLoading && !loadError && (
            <TeacherRequestsList
              requests={requests}
              archivingRequestId={archivingRequestId}
              onArchive={handleOpenArchiveDialog}
            />
          )}
        </div>
      </DashboardCollapsibleSection>

      {activeRequestType && (
        <TeacherCreateRequestModal
          requestType={activeRequestType}
          formKey={formKey}
          isSubmitting={isSubmitting}
          submitMessage={submitMessage}
          onClose={handleCloseCreateModal}
          onSubmit={handleCreateRequest}
        />
      )}

      {archiveDialogRequest && (
        <div
          className="teacher-dashboard__archive-confirm-overlay"
          onClick={handleCloseArchiveDialog}
          role="presentation"
        >
          <div
            className="teacher-dashboard__archive-confirm-panel ds-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-archive-confirm-title"
          >
            <h3 id="teacher-archive-confirm-title" className="teacher-dashboard__subsection-title">
              להעביר לארכיון?
            </h3>
            <p className="ds-form-message">
              הבקשה תוסר מרשימת הבקשות הפעילות ותופיע ב&quot;הארכיון שלי&quot;.
            </p>
            <div className="teacher-dashboard__archive-confirm-actions">
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
