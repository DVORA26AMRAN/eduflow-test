import { useState } from 'react'
import type { RequestAttachment } from '../../types/attachment'
import {
  ATTACHMENT_LOADING_MESSAGE,
  DOWNLOAD_ATTACHMENT_ARIA_LABEL,
  DOWNLOAD_ATTACHMENT_BUTTON_LABEL,
  PREVIEW_ATTACHMENT_ARIA_LABEL,
  PREVIEW_ATTACHMENT_BUTTON_LABEL,
} from '../../types/attachment'
import { createAttachmentSignedUrl } from '../../services/attachments'
import { triggerAttachmentDownload } from '../../utils/attachmentDownload'
import './RequestAttachmentActions.css'

type RequestAttachmentActionsProps = {
  attachment: RequestAttachment
  onError?: (message: string) => void
  className?: string
}

export function RequestAttachmentActions({
  attachment,
  onError,
  className,
}: RequestAttachmentActionsProps) {
  const [loadingAction, setLoadingAction] = useState<'preview' | 'download' | null>(null)

  async function handlePreview() {
    setLoadingAction('preview')
    onError?.('')

    const signedUrlResult = await createAttachmentSignedUrl(attachment.storage_path)

    setLoadingAction(null)

    if (!signedUrlResult.ok) {
      onError?.(signedUrlResult.errorMessage)
      return
    }

    window.open(signedUrlResult.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleDownload() {
    setLoadingAction('download')
    onError?.('')

    const signedUrlResult = await createAttachmentSignedUrl(attachment.storage_path)

    if (!signedUrlResult.ok) {
      setLoadingAction(null)
      onError?.(signedUrlResult.errorMessage)
      return
    }

    const downloadResult = await triggerAttachmentDownload(
      signedUrlResult.signedUrl,
      attachment.file_name,
    )

    setLoadingAction(null)

    if (!downloadResult.ok) {
      onError?.(downloadResult.errorMessage)
    }
  }

  const isBusy = loadingAction !== null

  return (
    <div className={['request-attachment__actions', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="ds-btn ds-btn--secondary request-attachment__action-button"
        aria-label={PREVIEW_ATTACHMENT_ARIA_LABEL}
        onClick={() => void handlePreview()}
        disabled={isBusy}
      >
        {loadingAction === 'preview'
          ? ATTACHMENT_LOADING_MESSAGE
          : PREVIEW_ATTACHMENT_BUTTON_LABEL}
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--secondary request-attachment__action-button"
        aria-label={DOWNLOAD_ATTACHMENT_ARIA_LABEL}
        onClick={() => void handleDownload()}
        disabled={isBusy}
      >
        {loadingAction === 'download'
          ? ATTACHMENT_LOADING_MESSAGE
          : DOWNLOAD_ATTACHMENT_BUTTON_LABEL}
      </button>
    </div>
  )
}
