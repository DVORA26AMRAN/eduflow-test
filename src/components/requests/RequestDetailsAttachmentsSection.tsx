import { useEffect, useState } from 'react'
import type { RequestAttachment } from '../../types/attachment'
import {
  ATTACHMENT_LOAD_ERROR_MESSAGE,
  ATTACHMENT_LOADING_MESSAGE,
  NO_ATTACHMENT_MESSAGE,
} from '../../types/attachment'
import { loadRequestAttachments } from '../../services/attachments'
import { formatAttachmentFileSize } from '../../utils/attachmentDisplay'
import { formatRequestDate } from '../../utils/requests'
import { RequestAttachmentActions } from './RequestAttachmentActions'
import { RequestAttachmentFileIcon } from './RequestAttachmentFileIcon'

type RequestDetailsAttachmentsSectionProps = {
  requestId: string
  isActive: boolean
  knownHasAttachment?: boolean
}

export function RequestDetailsAttachmentsSection({
  requestId,
  isActive,
  knownHasAttachment,
}: RequestDetailsAttachmentsSectionProps) {
  const [attachments, setAttachments] = useState<RequestAttachment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!isActive || knownHasAttachment === false) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        setLoadError('')
        setActionError('')

        const result = await loadRequestAttachments(requestId)

        if (isCancelled) {
          return
        }

        setIsLoading(false)

        if (!result.ok) {
          setAttachments([])
          setLoadError(result.errorMessage)
          return
        }

        setAttachments(result.attachments)
      })()
    })

    return () => {
      isCancelled = true
    }
  }, [isActive, knownHasAttachment, requestId])

  const showKnownEmpty = knownHasAttachment === false

  return (
    <section className="request-details__section" aria-label="קבצים מצורפים">
      <h3 className="request-details__section-title">קבצים מצורפים</h3>

      {showKnownEmpty && <p className="request-details__empty">{NO_ATTACHMENT_MESSAGE}</p>}

      {!showKnownEmpty && isLoading && <p className="ds-form-message">{ATTACHMENT_LOADING_MESSAGE}</p>}

      {!showKnownEmpty && !isLoading && loadError && (
        <p className="ds-form-message ds-form-message--error">{loadError}</p>
      )}

      {!showKnownEmpty && !isLoading && !loadError && attachments.length === 0 && (
        <p className="request-details__empty">{NO_ATTACHMENT_MESSAGE}</p>
      )}

      {!showKnownEmpty && !isLoading && !loadError && attachments.length > 0 && (
        <ul className="request-details__attachments-list">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="request-details__attachment-item">
              <div className="request-details__attachment-info">
                <RequestAttachmentFileIcon fileType={attachment.file_type} />
                <div className="request-details__attachment-meta">
                  <span className="request-details__attachment-name">{attachment.file_name}</span>
                  <span className="request-details__attachment-details">
                    {formatAttachmentFileSize(attachment.file_size_bytes)}
                    {' · '}
                    {formatRequestDate(attachment.created_at)}
                  </span>
                </div>
              </div>
              <RequestAttachmentActions
                attachment={attachment}
                onError={setActionError}
              />
            </li>
          ))}
        </ul>
      )}

      {actionError && <p className="ds-form-message ds-form-message--error">{actionError}</p>}
      {!showKnownEmpty && !isLoading && !loadError && attachments.length === 0 && knownHasAttachment && (
        <p className="ds-form-message ds-form-message--error">{ATTACHMENT_LOAD_ERROR_MESSAGE}</p>
      )}
    </section>
  )
}
