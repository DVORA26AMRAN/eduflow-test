import { useEffect, useState } from 'react'
import type { RequestAttachment } from '../../types/attachment'
import {
  ATTACHMENT_LOAD_ERROR_MESSAGE,
  ATTACHMENT_LOADING_MESSAGE,
  NO_ATTACHMENT_MESSAGE,
  VIEW_ATTACHMENT_BUTTON_LABEL,
} from '../../types/attachment'
import {
  createAttachmentSignedUrl,
  loadRequestAttachments,
} from '../../services/attachments'

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
  const [viewError, setViewError] = useState('')
  const [viewingAttachmentId, setViewingAttachmentId] = useState<string | null>(null)

  useEffect(() => {
    if (!isActive || knownHasAttachment === false) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        setLoadError('')

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

  async function handleViewAttachment(attachment: RequestAttachment) {
    setViewError('')
    setViewingAttachmentId(attachment.id)

    const signedUrlResult = await createAttachmentSignedUrl(attachment.storage_path)

    setViewingAttachmentId(null)

    if (!signedUrlResult.ok) {
      setViewError(signedUrlResult.errorMessage)
      return
    }

    window.open(signedUrlResult.signedUrl, '_blank', 'noopener,noreferrer')
  }

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
              <span className="request-details__attachment-name">{attachment.file_name}</span>
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={() => void handleViewAttachment(attachment)}
                disabled={viewingAttachmentId === attachment.id}
              >
                {viewingAttachmentId === attachment.id
                  ? ATTACHMENT_LOADING_MESSAGE
                  : VIEW_ATTACHMENT_BUTTON_LABEL}
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewError && <p className="ds-form-message ds-form-message--error">{viewError}</p>}
      {!showKnownEmpty && !isLoading && !loadError && attachments.length === 0 && knownHasAttachment && (
        <p className="ds-form-message ds-form-message--error">{ATTACHMENT_LOAD_ERROR_MESSAGE}</p>
      )}
    </section>
  )
}
