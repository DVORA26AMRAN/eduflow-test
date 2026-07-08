import { useCallback, useEffect, useState } from 'react'
import type { RequestPayload, RequestType, TeacherRequest } from '../../types/request'
import { REQUEST_CREATED_ATTACHMENT_UPLOAD_FAILED_MESSAGE } from '../../types/attachment'
import { uploadRequestAttachment } from '../../services/attachments'
import { createTeacherRequest, loadTeacherRequests } from '../../services/requests'
import { NavClipboardIcon, NavInboxIcon } from '../dashboard/dashboardNav'
import { CreateRequestForm } from './CreateRequestForm'
import { TeacherRequestsList } from './TeacherRequestsList'

export function TeacherRequestsSection() {
  const [requests, setRequests] = useState<TeacherRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [requestsListVersion, setRequestsListVersion] = useState(0)
  const [formKey, setFormKey] = useState(0)

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
  }, [fetchRequests, requestsListVersion])

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
        return
      }
    } else {
      setIsSubmitting(false)
    }

    setSubmitMessage('בקשה נשלחה בהצלחה.')
    setFormKey((key) => key + 1)
    setRequestsListVersion((version) => version + 1)
  }

  return (
    <section className="teacher-dashboard__requests">
      <h2 className="teacher-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavClipboardIcon />
        </span>
        הבקשות שלי
      </h2>

      <div className="ds-card teacher-dashboard__create-card">
        <CreateRequestForm
          key={formKey}
          isSubmitting={isSubmitting}
          submitMessage={submitMessage}
          onSubmit={handleCreateRequest}
        />
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

        {!isLoading && !loadError && <TeacherRequestsList requests={requests} />}
      </div>
    </section>
  )
}
