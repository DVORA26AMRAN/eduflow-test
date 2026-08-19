import { useCallback, useMemo, useState } from 'react'
import type { InstitutionUser, PrimaryRole, UserRole } from '../../types/user'
import { translateRole } from '../../utils/roles'
import { NavUsersIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { CreateUserForm } from './CreateUserForm'
import { canDeactivateStaff } from '../../security/institutionCapabilities'
import { StaffDeactivationConfirmModal } from '../staff/StaffDeactivationConfirmModal'

type TeamManagementSectionProps = {
  users: InstitutionUser[]
  isLoading: boolean
  errorMessage: string
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  newUserPhone: string
  newUserNationalId: string
  newUserJobTitle: string
  newUserWeeklyHours: string
  createUserMessage: string
  allowedRoles?: readonly UserRole[]
  actorRole?: PrimaryRole
  actorUserId?: string
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onNewUserPhoneChange: (value: string) => void
  onNewUserNationalIdChange: (value: string) => void
  onNewUserJobTitleChange: (value: string) => void
  onNewUserWeeklyHoursChange: (value: string) => void
  onCreateUser: () => void
  onUsersRefresh?: () => Promise<void>
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'active'
  return (
    <span
      className={`team-mgmt__status-badge ${isActive ? 'team-mgmt__status-badge--active' : 'team-mgmt__status-badge--inactive'}`}
      aria-label={isActive ? 'פעיל' : 'לא פעיל'}
    >
      {isActive ? 'פעיל' : 'לא פעיל'}
    </span>
  )
}

export function TeamManagementSection({
  users,
  isLoading,
  errorMessage,
  newUserName,
  newUserEmail,
  newUserRole,
  newUserPhone,
  newUserNationalId,
  newUserJobTitle,
  newUserWeeklyHours,
  createUserMessage,
  allowedRoles,
  actorRole,
  actorUserId,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onNewUserPhoneChange,
  onNewUserNationalIdChange,
  onNewUserJobTitleChange,
  onNewUserWeeklyHoursChange,
  onCreateUser,
  onUsersRefresh,
}: TeamManagementSectionProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [deactivationTargetId, setDeactivationTargetId] = useState<string | null>(null)
  const [deactivationTargetName, setDeactivationTargetName] = useState('')

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

  const showDeactivateColumn = actorRole === 'institution_manager'

  function handleDeactivateClick(user: InstitutionUser) {
    setDeactivationTargetId(user.id)
    setDeactivationTargetName(user.full_name)
  }

  const handleDeactivationSuccess = useCallback(async () => {
    if (onUsersRefresh) {
      await onUsersRefresh()
    }
  }, [onUsersRefresh])

  function handleDeactivationClose() {
    setDeactivationTargetId(null)
    setDeactivationTargetName('')
  }

  return (
    <section className="ds-card manager-dashboard__team">
      <DashboardSection
        title="ניהול צוות"
        icon={<NavUsersIcon />}
        className="dashboard-section--flush-header"
      >
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
                  <th>סטטוס</th>
                  {showDeactivateColumn ? <th>פעולות</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={showDeactivateColumn ? 5 : 4} className="ds-table__empty">
                      לא נמצאו משתמשים.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const canDeactivate = canDeactivateStaff(
                      actorRole,
                      user.primary_role,
                      actorUserId,
                      user.id,
                    )
                    return (
                      <tr key={user.email}>
                        <td>{user.full_name}</td>
                        <td>{user.email}</td>
                        <td>{translateRole(user.primary_role)}</td>
                        <td>
                          <StatusBadge status={user.status} />
                        </td>
                        {showDeactivateColumn ? (
                          <td>
                            {canDeactivate && user.status === 'active' ? (
                              <button
                                type="button"
                                className="ds-btn ds-btn--danger ds-btn--compact"
                                onClick={() => handleDeactivateClick(user)}
                              >
                                השבתה
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <CreateUserForm
          newUserName={newUserName}
          newUserEmail={newUserEmail}
          newUserRole={newUserRole}
          newUserPhone={newUserPhone}
          newUserNationalId={newUserNationalId}
          newUserJobTitle={newUserJobTitle}
          newUserWeeklyHours={newUserWeeklyHours}
          message={createUserMessage}
          allowedRoles={allowedRoles}
          onNewUserNameChange={onNewUserNameChange}
          onNewUserEmailChange={onNewUserEmailChange}
          onNewUserRoleChange={onNewUserRoleChange}
          onNewUserPhoneChange={onNewUserPhoneChange}
          onNewUserNationalIdChange={onNewUserNationalIdChange}
          onNewUserJobTitleChange={onNewUserJobTitleChange}
          onNewUserWeeklyHoursChange={onNewUserWeeklyHoursChange}
          onCreateUser={onCreateUser}
        />
      </DashboardSection>

      <StaffDeactivationConfirmModal
        isOpen={deactivationTargetId !== null}
        targetUserId={deactivationTargetId}
        targetName={deactivationTargetName}
        onSuccess={handleDeactivationSuccess}
        onClose={handleDeactivationClose}
      />
    </section>
  )
}
