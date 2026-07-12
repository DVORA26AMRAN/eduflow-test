import { useEffect, useRef, useState } from 'react'
import type { RequestPayload, RequestType } from '../../types/request'
import { REQUEST_ATTACHMENT_ACCEPT } from '../../types/attachment'
import { validateRequestAttachment } from '../../services/attachments'
import {
  buildAbsenceDescription,
  validateAbsenceForm,
  type AbsenceFormFields,
} from '../../utils/absence'
import {
  buildBudgetDescription,
  validateBudgetForm,
  type BudgetFormFields,
} from '../../utils/budget'
import { isCreateRequestFormDirty } from '../../utils/createRequestForm'
import { isRequestType } from '../../utils/requests'
import { TeacherAbsenceRequestFields } from './TeacherAbsenceRequestFields'
import { TeacherBudgetRequestFields } from './TeacherBudgetRequestFields'
import { TeacherRequestCategorySelector } from './TeacherRequestCategorySelector'

type CreateRequestFormProps = {
  isSubmitting: boolean
  submitMessage: string
  initialRequestType?: RequestType
  hideCategorySelector?: boolean
  onCancel?: () => void
  onDirtyChange?: (isDirty: boolean) => void
  onSubmit: (input: {
    requestType: RequestType
    description: string
    requestPayload?: RequestPayload
    attachmentFile: File | null
  }) => void
}

const emptyAbsenceFields: AbsenceFormFields = {
  absenceDate: '',
  absenceReason: '',
  absenceReasonOther: '',
  replacedBy: '',
}

const emptyBudgetFields: BudgetFormFields = {
  budgetDetails: '',
  requestedAmount: '',
  bankAccountDetails: '',
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
  initialRequestType,
  hideCategorySelector = false,
  onCancel,
  onDirtyChange,
  onSubmit,
}: CreateRequestFormProps) {
  const [requestType, setRequestType] = useState<RequestType | ''>(initialRequestType ?? '')
  const [description, setDescription] = useState('')
  const [absenceFields, setAbsenceFields] = useState<AbsenceFormFields>(emptyAbsenceFields)
  const [budgetFields, setBudgetFields] = useState<BudgetFormFields>(emptyBudgetFields)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [validationMessage, setValidationMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onDirtyChange?.(
      isCreateRequestFormDirty({
        description,
        absenceFields,
        budgetFields,
        attachmentFile,
      }),
    )
  }, [description, absenceFields, budgetFields, attachmentFile, onDirtyChange])

  function handleSubmit() {
    setValidationMessage('')

    if (!requestType || !isRequestType(requestType)) {
      setValidationMessage('נא לבחור סוג בקשה.')
      return
    }

    if (attachmentFile) {
      const attachmentValidation = validateRequestAttachment(attachmentFile)
      if (!attachmentValidation.ok) {
        setValidationMessage(attachmentValidation.errorMessage)
        return
      }
    }

    if (requestType === 'absence') {
      const absenceValidation = validateAbsenceForm(absenceFields)
      if (!absenceValidation.ok) {
        setValidationMessage(absenceValidation.errorMessage)
        return
      }

      onSubmit({
        requestType,
        description: buildAbsenceDescription(absenceValidation.payload),
        requestPayload: absenceValidation.payload,
        attachmentFile,
      })
      return
    }

    if (requestType === 'budget_or_equipment') {
      const budgetValidation = validateBudgetForm(budgetFields)
      if (!budgetValidation.ok) {
        setValidationMessage(budgetValidation.errorMessage)
        return
      }

      onSubmit({
        requestType,
        description: buildBudgetDescription(budgetValidation.payload),
        requestPayload: budgetValidation.payload,
        attachmentFile,
      })
      return
    }

    if (!description.trim()) {
      setValidationMessage('נא להזין תיאור בקשה.')
      return
    }

    onSubmit({
      requestType,
      description: description.trim(),
      attachmentFile,
    })
  }

  function handleRequestTypeSelect(value: RequestType) {
    setRequestType(value)
    setValidationMessage('')

    if (value !== 'absence') {
      setAbsenceFields(emptyAbsenceFields)
    }

    if (value !== 'budget_or_equipment') {
      setBudgetFields(emptyBudgetFields)
    }
  }

  function updateAbsenceField<K extends keyof AbsenceFormFields>(
    key: K,
    value: AbsenceFormFields[K],
  ) {
    setAbsenceFields((currentFields) => {
      const nextFields = {
        ...currentFields,
        [key]: value,
      }

      if (key === 'absenceReason' && value !== 'other') {
        nextFields.absenceReasonOther = ''
      }

      return nextFields
    })
    setValidationMessage('')
  }

  function updateBudgetField<K extends keyof BudgetFormFields>(
    key: K,
    value: BudgetFormFields[K],
  ) {
    setBudgetFields((currentFields) => ({
      ...currentFields,
      [key]: value,
    }))
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
      {!hideCategorySelector && (
        <>
          <h3 className="teacher-dashboard__subsection-title">פתיחת בקשה חדשה</h3>

          <TeacherRequestCategorySelector
            selectedType={requestType}
            isDisabled={isSubmitting}
            onSelect={handleRequestTypeSelect}
          />
        </>
      )}

      {hideCategorySelector && requestType === 'absence' && (
        <TeacherAbsenceRequestFields
          absenceDate={absenceFields.absenceDate}
          absenceReason={absenceFields.absenceReason}
          absenceReasonOther={absenceFields.absenceReasonOther}
          replacedBy={absenceFields.replacedBy}
          isDisabled={isSubmitting}
          onAbsenceDateChange={(value) => updateAbsenceField('absenceDate', value)}
          onAbsenceReasonChange={(value) => updateAbsenceField('absenceReason', value)}
          onAbsenceReasonOtherChange={(value) =>
            updateAbsenceField('absenceReasonOther', value)
          }
          onReplacedByChange={(value) => updateAbsenceField('replacedBy', value)}
        />
      )}

      {hideCategorySelector && requestType === 'budget_or_equipment' && (
        <TeacherBudgetRequestFields
          budgetDetails={budgetFields.budgetDetails}
          requestedAmount={budgetFields.requestedAmount}
          bankAccountDetails={budgetFields.bankAccountDetails}
          isDisabled={isSubmitting}
          onBudgetDetailsChange={(value) => updateBudgetField('budgetDetails', value)}
          onRequestedAmountChange={(value) => updateBudgetField('requestedAmount', value)}
          onBankAccountDetailsChange={(value) =>
            updateBudgetField('bankAccountDetails', value)
          }
        />
      )}

      {hideCategorySelector && requestType === 'substitute_teacher' && (
        <div className="ds-fieldset">
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
        </div>
      )}

      {hideCategorySelector && requestType !== '' && (
        <div className="ds-fieldset teacher-dashboard__upload-fieldset">
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
            <p className="ds-helper-text">אפשר לצרף מסמך תומך אם יש צורך.</p>
          </label>
        </div>
      )}

      {hideCategorySelector && requestType !== '' && (
        <div className="ds-form-actions">
          {onCancel && (
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              ביטול
            </button>
          )}
          <button
            type="button"
            className="ds-btn ds-btn--primary teacher-dashboard__submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            שליחת בקשה
          </button>
        </div>
      )}

      {validationMessage && (
        <p className="ds-form-message ds-form-message--error">{validationMessage}</p>
      )}

      {submitMessage && (
        <p className={getSubmitMessageClassName(submitMessage)}>{submitMessage}</p>
      )}
    </>
  )
}
