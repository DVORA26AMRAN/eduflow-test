import { useEffect, useId, useRef } from 'react'
import { REQUEST_ATTACHMENT_ACCEPT } from '../../types/attachment'
import './RequestAttachmentPicker.css'

export const REQUEST_ATTACHMENT_PICK_BUTTON_LABEL = 'בחירת קובץ'

type RequestAttachmentPickerProps = {
  /** Selected file owned by the parent form. */
  selectedFile: File | null
  disabled?: boolean
  accept?: string
  label?: string
  helperText?: string
  /** Optional id for aria-describedby (e.g. validation error element). */
  errorId?: string
  inputId?: string
  onSelectedFileChange: (file: File | null) => void
}

/**
 * Shared EduFlow-styled attachment picker for teacher request forms.
 * Hides the native file control chrome; does not perform upload/validation.
 */
export function RequestAttachmentPicker({
  selectedFile,
  disabled = false,
  accept = REQUEST_ATTACHMENT_ACCEPT,
  label = 'קובץ מצורף',
  helperText = 'אפשר לצרף מסמך תומך אם יש צורך.',
  errorId,
  inputId,
  onSelectedFileChange,
}: RequestAttachmentPickerProps) {
  const generatedId = useId()
  const id = inputId ?? `request-attachment-${generatedId}`
  const labelId = `${id}-label`
  const helperId = helperText ? `${id}-helper` : undefined
  const filenameId = selectedFile ? `${id}-filename` : undefined
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectedFile && inputRef.current) {
      inputRef.current.value = ''
    }
  }, [selectedFile])

  const describedBy = [helperId, filenameId, errorId].filter(Boolean).join(' ') || undefined

  function handlePickClick() {
    inputRef.current?.click()
  }

  return (
    <div className="ds-fieldset request-attachment-picker">
      <div className="ds-field">
        <span className="ds-label" id={labelId}>
          {label}
        </span>

        <input
          ref={inputRef}
          id={id}
          type="file"
          className="request-attachment-picker__input"
          accept={accept}
          disabled={disabled}
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          onChange={(event) => {
            onSelectedFileChange(event.target.files?.[0] ?? null)
          }}
        />

        <div className="request-attachment-picker__row">
          <button
            type="button"
            className="ds-btn ds-btn--secondary request-attachment-picker__button"
            disabled={disabled}
            onClick={handlePickClick}
            aria-controls={id}
          >
            {REQUEST_ATTACHMENT_PICK_BUTTON_LABEL}
          </button>

          {selectedFile ? (
            <p
              id={filenameId}
              className="request-attachment-picker__filename"
              aria-live="polite"
            >
              {selectedFile.name}
            </p>
          ) : null}
        </div>

        {helperText ? (
          <p id={helperId} className="ds-helper-text">
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  )
}
