import { useRef, useState } from 'react'
import type { RequestType } from '../../types/request'
import { REQUEST_ATTACHMENT_ACCEPT } from '../../types/attachment'
import { validateRequestAttachment } from '../../services/attachments'
import { isRequestType } from '../../utils/requests'

type CreateRequestFormProps = {
  isSubmitting: boolean
  submitMessage: string
  onSubmit: (input: {
    requestType: RequestType
    description: string
    attachmentFile: File | null
  }) => void
}

function getSubmitMessageClassName(message: string): string {
  if (!message) {
    return 'ds-form-message'
  }

  if (message.includes('בהצלחה')) {
    return 'ds-form-message ds-form-message--success'
  }

  if (message.includes('נכשל')) {
    return 'ds-form-message ds-form-message--error'
  }

  return 'ds-form-message'
}

export function CreateRequestForm({
  isSubmitting,
  submitMessage,
  onSubmit,
}: CreateRequestFormProps) {
  const [requestType, setRequestType] = useState('')
  const [description, setDescription] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [validationMessage, setValidationMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleSubmit() {
    setValidationMessage('')

    if (!requestType || !isRequestType(requestType)) {
      setValidationMessage('נא לבחור סוג בקשה.')
      return
    }

    if (!description.trim()) {
      setValidationMessage('נא להזין תיאור בקשה.')
      return
    }

    if (attachmentFile) {
      const attachmentValidation = validateRequestAttachment(attachmentFile)
      if (!attachmentValidation.ok) {
        setValidationMessage(attachmentValidation.errorMessage)
        return
      }
    }

    onSubmit({
      requestType,
      description: description.trim(),
      attachmentFile,
    })
  }

  function handleRequestTypeChange(value: string) {
    setRequestType(value)
    setValidationMessage('')
  }

  function handleDescriptionChange(value: string) {
    setDescription(value)
    setValidationMessage('')
  }

  function handleAttachmentChange(file: File | null) {
    setValidationMessage('')

    if (!file) {
      setAttachmentFile(null)
      return
    }

    const attachmentValidation = validateRequestAttachment(file)
    if (!attachmentValidation.ok) {
      setAttachmentFile(null)
      setValidationMessage(attachmentValidation.errorMessage)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    setAttachmentFile(file)
  }

  return (
    <>
      <h3 className="teacher-dashboard__subsection-title">פתיחת בקשה חדשה</h3>

      <label className="ds-field" htmlFor="request-type">
        <span className="ds-label">סוג בקשה</span>
        <select
          id="request-type"
          className="ds-select"
          value={requestType}
          onChange={(e) => handleRequestTypeChange(e.target.value)}
          disabled={isSubmitting}
        >
          <option value="">בחרי סוג בקשה</option>
          <option value="equipment">ציוד</option>
          <option value="maintenance">תחזוקה</option>
          <option value="pedagogical">פדגוגי</option>
          <option value="other">אחר</option>
        </select>
      </label>

      <label className="ds-field" htmlFor="request-description">
        <span className="ds-label">תיאור הבקשה</span>
        <textarea
          id="request-description"
          className="ds-textarea"
          rows={4}
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          disabled={isSubmitting}
          placeholder="פרטי הבקשה"
        />
      </label>

      <label className="ds-field" htmlFor="request-attachment">
        <span className="ds-label">קובץ מצורף</span>
        <input
          ref={fileInputRef}
          id="request-attachment"
          type="file"
          className="ds-input teacher-dashboard__file-input"
          accept={REQUEST_ATTACHMENT_ACCEPT}
          onChange={(e) => handleAttachmentChange(e.target.files?.[0] ?? null)}
          disabled={isSubmitting}
        />
      </label>

      <button
        type="button"
        className="ds-btn ds-btn--primary teacher-dashboard__submit"
        onClick={handleSubmit}
        disabled={isSubmitting}
      >
        שליחת בקשה
      </button>

      {validationMessage && (
        <p className="ds-form-message ds-form-message--error">{validationMessage}</p>
      )}

      {submitMessage && (
        <p className={getSubmitMessageClassName(submitMessage)}>{submitMessage}</p>
      )}
    </>
  )
}
