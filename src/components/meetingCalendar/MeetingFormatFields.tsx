import { useId } from 'react'
import type { MeetingFormat } from '../../utils/meetingCalendarLive'

type MeetingFormatFieldsProps = {
  format: MeetingFormat | ''
  phoneNumber: string
  disabled?: boolean
  onFormatChange: (format: MeetingFormat) => void
  onPhoneNumberChange: (phoneNumber: string) => void
}

export function MeetingFormatFields({
  format,
  phoneNumber,
  disabled = false,
  onFormatChange,
  onPhoneNumberChange,
}: MeetingFormatFieldsProps) {
  const formatId = useId()
  const phoneId = useId()

  return (
    <div className="mc-connection-form">
      <label className="ds-field" htmlFor={formatId}>
        <span className="ds-label">סוג פגישה</span>
        <select
          id={formatId}
          className="ds-input"
          value={format}
          required
          onChange={(event) => onFormatChange(event.target.value as MeetingFormat)}
          disabled={disabled}
        >
          <option value="" disabled>
            בחרו סוג פגישה
          </option>
          <option value="in_person">פרונטלית</option>
          <option value="phone">טלפונית</option>
          <option value="online">מקוונת (Google Meet)</option>
        </select>
      </label>

      {format === 'online' ? (
        <p className="mc-help-text">
          קישור Google Meet ייווצר אוטומטית לאחר אישור הפגישה.
        </p>
      ) : null}

      {format === 'phone' ? (
        <label className="ds-field" htmlFor={phoneId}>
          <span className="ds-label">מספר טלפון</span>
          <input
            id={phoneId}
            className="ds-input"
            type="tel"
            value={phoneNumber}
            onChange={(event) => onPhoneNumberChange(event.target.value)}
            disabled={disabled}
            autoComplete="tel"
            required
            placeholder="לדוגמה: 050-1234567"
          />
          {/* TODO(E.164): validate/normalize phone numbers to E.164 before save. */}
        </label>
      ) : null}
    </div>
  )
}
