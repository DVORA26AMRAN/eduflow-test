import type { UserRole } from '../../types/user'

type CreateUserFormProps = {
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  message: string
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
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
    message.includes('נא ')
  ) {
    return 'ds-form-message ds-form-message--error'
  }

  return 'ds-form-message'
}

export function CreateUserForm({
  newUserName,
  newUserEmail,
  newUserRole,
  message,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onCreateUser,
}: CreateUserFormProps) {
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
          />
        </label>

        <label className="ds-field" htmlFor="create-user-role">
          <span className="ds-label">תפקיד</span>
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
