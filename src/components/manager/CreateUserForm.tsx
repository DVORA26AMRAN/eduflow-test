import type { UserRole } from '../../types/user'

type CreateUserFormProps = {
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  newUserPhone: string
  newUserNationalId: string
  newUserJobTitle: string
  newUserWeeklyHours: string
  message: string
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onNewUserPhoneChange: (value: string) => void
  onNewUserNationalIdChange: (value: string) => void
  onNewUserJobTitleChange: (value: string) => void
  onNewUserWeeklyHoursChange: (value: string) => void
  onCreateUser: () => void
}

function getMessageClassName(message: string): string {
  if (!message) {
    return 'ds-form-message'
  }

  if (message.includes('בהצלחה')) {
    return 'ds-form-message ds-form-message--success'
  }

  if (
    message.includes('נכשל') ||
    message.includes('הרשאה') ||
    message.includes('פגה') ||
    message.includes('קיים') ||
    message.includes('נא ') ||
    message.includes('חייבות')
  ) {
    return 'ds-form-message ds-form-message--error'
  }

  return 'ds-form-message'
}

export function CreateUserForm({
  newUserName,
  newUserEmail,
  newUserRole,
  newUserPhone,
  newUserNationalId,
  newUserJobTitle,
  newUserWeeklyHours,
  message,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onNewUserPhoneChange,
  onNewUserNationalIdChange,
  onNewUserJobTitleChange,
  onNewUserWeeklyHoursChange,
  onCreateUser,
}: CreateUserFormProps) {
  const isTeacher = newUserRole === 'teacher'

  return (
    <div className="manager-dashboard__create-user">
      <h3 className="manager-dashboard__subsection-title">יצירת משתמש חדש</h3>

      <div className="ds-fieldset">
        <label className="ds-field" htmlFor="create-user-name">
          <span className="ds-label">שם מלא</span>
          <input
            id="create-user-name"
            className="ds-input"
            placeholder="שם מלא"
            value={newUserName}
            onChange={(e) => onNewUserNameChange(e.target.value)}
            required
            autoComplete="name"
          />
        </label>

        <label className="ds-field" htmlFor="create-user-email">
          <span className="ds-label">כתובת מייל</span>
          <input
            id="create-user-email"
            className="ds-input"
            type="email"
            placeholder="כתובת מייל"
            value={newUserEmail}
            onChange={(e) => onNewUserEmailChange(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="ds-field" htmlFor="create-user-role">
          <span className="ds-label">תפקיד במערכת</span>
          <select
            id="create-user-role"
            className="ds-select"
            value={newUserRole}
            onChange={(e) => onNewUserRoleChange(e.target.value as UserRole)}
          >
            <option value="teacher">מורה</option>
            <option value="secretary">מזכירה</option>
          </select>
        </label>

        {isTeacher ? (
          <>
            <label className="ds-field" htmlFor="create-user-phone">
              <span className="ds-label">טלפון</span>
              <input
                id="create-user-phone"
                className="ds-input"
                type="tel"
                placeholder="טלפון (אופציונלי)"
                value={newUserPhone}
                onChange={(e) => onNewUserPhoneChange(e.target.value)}
                autoComplete="tel"
              />
            </label>

            <label className="ds-field" htmlFor="create-user-national-id">
              <span className="ds-label">תעודת זהות</span>
              <input
                id="create-user-national-id"
                className="ds-input"
                placeholder="תעודת זהות (אופציונלי)"
                value={newUserNationalId}
                onChange={(e) => onNewUserNationalIdChange(e.target.value)}
              />
            </label>

            <label className="ds-field" htmlFor="create-user-job-title">
              <span className="ds-label">משרה</span>
              <input
                id="create-user-job-title"
                className="ds-input"
                placeholder="משרה (אופציונלי)"
                value={newUserJobTitle}
                onChange={(e) => onNewUserJobTitleChange(e.target.value)}
              />
            </label>

            <label className="ds-field" htmlFor="create-user-weekly-hours">
              <span className="ds-label">שעות שבועיות</span>
              <input
                id="create-user-weekly-hours"
                className="ds-input"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="שעות שבועיות (אופציונלי)"
                value={newUserWeeklyHours}
                onChange={(e) => onNewUserWeeklyHoursChange(e.target.value)}
              />
            </label>
          </>
        ) : null}

        <div className="ds-form-actions">
          <button
            type="button"
            className="ds-btn ds-btn--primary manager-dashboard__submit"
            onClick={onCreateUser}
          >
            שמירת משתמש
          </button>
        </div>
      </div>

      {message && <p className={getMessageClassName(message)}>{message}</p>}
    </div>
  )
}
