import type { AbsenceReason } from '../../types/request'
import { ABSENCE_REASON_OPTIONS } from '../../utils/absence'

type TeacherAbsenceRequestFieldsProps = {
  absenceDate: string
  absenceReason: AbsenceReason | ''
  absenceReasonOther: string
  replacedBy: string
  isDisabled: boolean
  onAbsenceDateChange: (value: string) => void
  onAbsenceReasonChange: (value: AbsenceReason | '') => void
  onAbsenceReasonOtherChange: (value: string) => void
  onReplacedByChange: (value: string) => void
}

export function TeacherAbsenceRequestFields({
  absenceDate,
  absenceReason,
  absenceReasonOther,
  replacedBy,
  isDisabled,
  onAbsenceDateChange,
  onAbsenceReasonChange,
  onAbsenceReasonOtherChange,
  onReplacedByChange,
}: TeacherAbsenceRequestFieldsProps) {
  return (
    <div className="teacher-dashboard__absence-form ds-fieldset">
      <label className="ds-field" htmlFor="absence-date">
        <span className="ds-label">תאריך היעדרות</span>
        <input
          id="absence-date"
          type="date"
          className="ds-input teacher-dashboard__date-input"
          value={absenceDate}
          onChange={(event) => onAbsenceDateChange(event.target.value)}
          disabled={isDisabled}
        />
      </label>

      <label className="ds-field" htmlFor="absence-reason">
        <span className="ds-label">סיבת היעדרות</span>
        <select
          id="absence-reason"
          className="ds-select"
          value={absenceReason}
          onChange={(event) =>
            onAbsenceReasonChange(event.target.value as AbsenceReason | '')
          }
          disabled={isDisabled}
        >
          <option value="">בחרי סיבת היעדרות</option>
          {ABSENCE_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {absenceReason === 'other' && (
        <label className="ds-field" htmlFor="absence-reason-other">
          <span className="ds-label">פירוט סיבה אחרת</span>
          <input
            id="absence-reason-other"
            type="text"
            className="ds-input"
            value={absenceReasonOther}
            onChange={(event) => onAbsenceReasonOtherChange(event.target.value)}
            disabled={isDisabled}
          />
        </label>
      )}

      <label className="ds-field" htmlFor="replaced-by">
        <span className="ds-label">מי החליפה אותי?</span>
        <input
          id="replaced-by"
          type="text"
          className="ds-input"
          value={replacedBy}
          onChange={(event) => onReplacedByChange(event.target.value)}
          disabled={isDisabled}
          placeholder="שם המחליפה (אופציונלי)"
        />
        <p className="ds-helper-text">אפשר להשאיר ריק אם עדיין אין מורה מחליפה.</p>
      </label>
    </div>
  )
}
