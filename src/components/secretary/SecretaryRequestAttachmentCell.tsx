import { useState } from 'react'
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

type SecretaryRequestAttachmentCellProps = {
  requestId: string
  hasAttachment: boolean
}

export function SecretaryRequestAttachmentCell({
  requestId,
  hasAttachment,
}: SecretaryRequestAttachmentCellProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  if (!hasAttachment) {
    return (
      <span className="secretary-dashboard__attachment-empty">{NO_ATTACHMENT_MESSAGE}</span>
    )
  }

  async function handleViewAttachment() {
    setIsLoading(true)
    setErrorMessage('')

    const attachmentsResult = await loadRequestAttachments(requestId)

    if (!attachmentsResult.ok) {
      setIsLoading(false)
      setErrorMessage(attachmentsResult.errorMessage)
      return
    }

    const attachment = attachmentsResult.attachments[0]

    if (!attachment) {
      setIsLoading(false)
      setErrorMessage(ATTACHMENT_LOAD_ERROR_MESSAGE)
      return
    }

    const signedUrlResult = await createAttachmentSignedUrl(attachment.storage_path)

    setIsLoading(false)

    if (!signedUrlResult.ok) {
      setErrorMessage(signedUrlResult.errorMessage)
      return
    }

    window.open(signedUrlResult.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="secretary-dashboard__attachment-cell">
      <button
        type="button"
        className="ds-btn ds-btn--secondary secretary-dashboard__attachment-button"
        onClick={() => void handleViewAttachment()}
        disabled={isLoading}
      >
        {isLoading ? ATTACHMENT_LOADING_MESSAGE : VIEW_ATTACHMENT_BUTTON_LABEL}
      </button>

      {errorMessage && (
        <p className="secretary-dashboard__attachment-error">{errorMessage}</p>
      )}
    </div>
  )
}
