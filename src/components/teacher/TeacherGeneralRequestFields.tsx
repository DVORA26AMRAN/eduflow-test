import type { GeneralRequestRecipientRole } from '../../types/request'
import { GENERAL_REQUEST_RECIPIENT_OPTIONS } from '../../utils/generalRequestDisplay'

type TeacherGeneralRequestFieldsProps = {
  recipientRole: GeneralRequestRecipientRole | ''
  subject: string
  message: string
  isDisabled: boolean
  onRecipientRoleChange: (value: GeneralRequestRecipientRole | '') => void
  onSubjectChange: (value: string) => void
  onMessageChange: (value: string) => void
}

export function TeacherGeneralRequestFields({
  recipientRole,
  subject,
  message,
  isDisabled,
  onRecipientRoleChange,
  onSubjectChange,
  onMessageChange,
}: TeacherGeneralRequestFieldsProps) {
  return (
    <div className="ds-fieldset">
      <fieldset className="ds-field">
        <legend className="ds-label">נמען הבקשה</legend>
        <div className="teacher-dashboard__recipient-options">
          {GENERAL_REQUEST_RECIPIENT_OPTIONS.map((option) => (
            <label key={option.value} className="teacher-dashboard__recipient-option">
              <input
                type="radio"
                name="general-request-recipient"
                value={option.value}
                checked={recipientRole === option.value}
                onChange={() => onRecipientRoleChange(option.value)}
                disabled={isDisabled}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="ds-field" htmlFor="general-request-subject">
        <span className="ds-label">נושא</span>
        <input
          id="general-request-subject"
          type="text"
          className="ds-input"
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          disabled={isDisabled}
          maxLength={200}
        />
      </label>

      <label className="ds-field" htmlFor="general-request-message">
        <span className="ds-label">הודעה</span>
        <textarea
          id="general-request-message"
          className="ds-textarea"
          rows={5}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          disabled={isDisabled}
          maxLength={2000}
        />
      </label>
    </div>
  )
}
