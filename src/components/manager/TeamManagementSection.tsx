import { useMemo, useState } from 'react'
import type { InstitutionUser, UserRole } from '../../types/user'
import { translateRole } from '../../utils/roles'
import { NavUsersIcon } from '../dashboard/dashboardNav'
import { CreateUserForm } from './CreateUserForm'

type TeamManagementSectionProps = {
  users: InstitutionUser[]
  isLoading: boolean
  errorMessage: string
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  createUserMessage: string
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onCreateUser: () => void
}

export function TeamManagementSection({
  users,
  isLoading,
  errorMessage,
  newUserName,
  newUserEmail,
  newUserRole,
  createUserMessage,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onCreateUser,
}: TeamManagementSectionProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return users
    }

    return users.filter(
      (user) =>
        user.full_name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query),
    )
  }, [searchQuery, users])

  return (
    <section className="ds-card manager-dashboard__team">
      <h2 className="manager-dashboard__section-title">
        <span className="dashboard-card__title-icon" aria-hidden="true">
          <NavUsersIcon />
        </span>
        ניהול צוות
      </h2>

      <label className="ds-field manager-dashboard__search-field" htmlFor="team-search">
        <span className="ds-label">חיפוש</span>
        <input
          id="team-search"
          className="ds-input manager-dashboard__search"
          placeholder="חיפוש לפי שם או מייל"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </label>

      {isLoading && <p className="ds-form-message">טוען משתמשים...</p>}
      {!isLoading && errorMessage && (
        <p className="ds-form-message ds-form-message--error">{errorMessage}</p>
      )}

      {!isLoading && !errorMessage && (
        <div className="ds-table-wrapper manager-dashboard__table-wrapper">
          <table className="ds-table">
            <thead>
              <tr>
                <th>שם מלא</th>
                <th>כתובת מייל</th>
                <th>תפקיד</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="ds-table__empty">
                    לא נמצאו משתמשים.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.email}>
                    <td>{user.full_name}</td>
                    <td>{user.email}</td>
                    <td>{translateRole(user.primary_role)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserForm
        newUserName={newUserName}
        newUserEmail={newUserEmail}
        newUserRole={newUserRole}
        message={createUserMessage}
        onNewUserNameChange={onNewUserNameChange}
        onNewUserEmailChange={onNewUserEmailChange}
        onNewUserRoleChange={onNewUserRoleChange}
        onCreateUser={onCreateUser}
      />
    </section>
  )
}
