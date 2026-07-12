import { useEffect, useState } from 'react'
import type { RequestAttachment } from '../../types/attachment'
import {
  ATTACHMENT_LOAD_ERROR_MESSAGE,
  ATTACHMENT_LOADING_MESSAGE,
  NO_ATTACHMENT_MESSAGE,
} from '../../types/attachment'
import { loadRequestAttachments } from '../../services/attachments'
import { RequestAttachmentActions } from '../requests/RequestAttachmentActions'

type SecretaryRequestAttachmentCellProps = {
  requestId: string
  hasAttachment: boolean
}

export function SecretaryRequestAttachmentCell({
  requestId,
  hasAttachment,
}: SecretaryRequestAttachmentCellProps) {
  const [attachment, setAttachment] = useState<RequestAttachment | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!hasAttachment) {
      return
    }

    let isCancelled = false

    queueMicrotask(() => {
      void (async () => {
        setIsLoading(true)
        setLoadError('')
        setActionError('')

        const attachmentsResult = await loadRequestAttachments(requestId)

        if (isCancelled) {
          return
        }

        setIsLoading(false)

        if (!attachmentsResult.ok) {
          setAttachment(null)
          setLoadError(attachmentsResult.errorMessage)
          return
        }

        setAttachment(attachmentsResult.attachments[0] ?? null)

        if (!attachmentsResult.attachments[0]) {
          setLoadError(ATTACHMENT_LOAD_ERROR_MESSAGE)
        }
      })()
    })

    return () => {
      isCancelled = true
    }
  }, [hasAttachment, requestId])

  if (!hasAttachment) {
    return (
      <span className="secretary-dashboard__attachment-empty">{NO_ATTACHMENT_MESSAGE}</span>
    )
  }

  if (isLoading) {
    return <span className="secretary-dashboard__attachment-loading">{ATTACHMENT_LOADING_MESSAGE}</span>
  }

  if (loadError || !attachment) {
    return <p className="secretary-dashboard__attachment-error">{loadError || ATTACHMENT_LOAD_ERROR_MESSAGE}</p>
  }

  return (
    <div className="secretary-dashboard__attachment-cell">
      <RequestAttachmentActions
        attachment={attachment}
        onError={setActionError}
        className="request-attachment__actions--compact"
      />

      {actionError && (
        <p className="secretary-dashboard__attachment-error">{actionError}</p>
      )}
    </div>
  )
}
