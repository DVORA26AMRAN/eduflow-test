import { useEffect, useState } from 'react'
import type { RequestPayload, RequestType, GeneralRequestFormFields, GeneralRequestRecipientRole } from '../../types/request'
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
import {
  buildGeneralRequestDescription,
  validateGeneralRequestForm,
} from '../../utils/generalRequest'
import { isCreateRequestFormDirty } from '../../utils/createRequestForm'
import { RequestAttachmentPicker } from '../requests/RequestAttachmentPicker'
import { TeacherAbsenceRequestFields } from './TeacherAbsenceRequestFields'
import { TeacherBudgetRequestFields } from './TeacherBudgetRequestFields'
import { TeacherGeneralRequestFields } from './TeacherGeneralRequestFields'

type CreateRequestFormProps = {
  isSubmitting: boolean
  submitMessage: string
  /** Domain request type for this form instance (not a Teacher category card value). */
  initialRequestType: RequestType
  onCancel?: () => void
  onDirtyChange?: (isDirty: boolean) => void
  onSubmit: (input: {
    requestType: RequestType
    description: string
    requestPayload?: RequestPayload
    recipientRole?: GeneralRequestRecipientRole
    attachmentFile: File | null
  }) => void
}

const emptyGeneralRequestFields: GeneralRequestFormFields = {
  recipientRole: '',
  subject: '',
  message: '',
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
  onCancel,
  onDirtyChange,
  onSubmit,
}: CreateRequestFormProps) {
  const [requestType] = useState<RequestType>(initialRequestType)
  const [description, setDescription] = useState('')
  const [absenceFields, setAbsenceFields] = useState<AbsenceFormFields>(emptyAbsenceFields)
  const [budgetFields, setBudgetFields] = useState<BudgetFormFields>(emptyBudgetFields)
  const [generalRequestFields, setGeneralRequestFields] =
    useState<GeneralRequestFormFields>(emptyGeneralRequestFields)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [validationMessage, setValidationMessage] = useState('')

  useEffect(() => {
    onDirtyChange?.(
      isCreateRequestFormDirty({
        description,
        absenceFields,
        budgetFields,
        generalRequestFields,
        attachmentFile,
      }),
    )
  }, [description, absenceFields, budgetFields, generalRequestFields, attachmentFile, onDirtyChange])

  function handleSubmit() {
    setValidationMessage('')

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

    if (requestType === 'general_request') {
      const generalValidation = validateGeneralRequestForm(generalRequestFields)
      if (!generalValidation.ok) {
        setValidationMessage(generalValidation.errorMessage)
        return
      }

      onSubmit({
        requestType,
        description: buildGeneralRequestDescription(generalValidation.subject),
        requestPayload: generalValidation.payload,
        recipientRole: generalRequestFields.recipientRole as GeneralRequestRecipientRole,
        attachmentFile,
      })
      return
    }

    // Historical / separate substitute_teacher domain type (not a Teacher category card).
    if (requestType === 'substitute_teacher') {
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
      return
    }

    setAttachmentFile(file)
  }

  return (
    <>
      {requestType === 'absence' && (
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

      {requestType === 'budget_or_equipment' && (
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

      {requestType === 'general_request' && (
        <TeacherGeneralRequestFields
          recipientRole={generalRequestFields.recipientRole}
          subject={generalRequestFields.subject}
          message={generalRequestFields.message}
          isDisabled={isSubmitting}
          onRecipientRoleChange={(value) => {
            setGeneralRequestFields((currentFields) => ({
              ...currentFields,
              recipientRole: value,
            }))
            setValidationMessage('')
          }}
          onSubjectChange={(value) => {
            setGeneralRequestFields((currentFields) => ({
              ...currentFields,
              subject: value,
            }))
            setValidationMessage('')
          }}
          onMessageChange={(value) => {
            setGeneralRequestFields((currentFields) => ({
              ...currentFields,
              message: value,
            }))
            setValidationMessage('')
          }}
        />
      )}

      {requestType === 'substitute_teacher' && (
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

      <RequestAttachmentPicker
        selectedFile={attachmentFile}
        disabled={isSubmitting}
        errorId={validationMessage ? 'create-request-validation' : undefined}
        onSelectedFileChange={handleAttachmentChange}
      />

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

      {validationMessage && (
        <p
          id="create-request-validation"
          className="ds-form-message ds-form-message--error"
          role="alert"
        >
          {validationMessage}
        </p>
      )}

      {submitMessage && (
        <p className={getSubmitMessageClassName(submitMessage)}>{submitMessage}</p>
      )}
    </>
  )
}
