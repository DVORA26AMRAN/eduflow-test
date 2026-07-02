import { useEffect, useState } from 'react'
import { ManagerDashboardHeader } from '../components/manager/ManagerDashboardHeader'
import { ManagerStatsCards } from '../components/manager/ManagerStatsCards'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import {
  countUsersByRole,
  loadInstitutionUsers,
} from '../services/institutionUsers'
import type { InstitutionUser, UserRole } from '../types/user'
import './ManagerDashboardPage.css'

type ManagerDashboardPageProps = {
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  message: string
  usersListVersion: number
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onCreateUser: () => void
  onLogout: () => void
}

export function ManagerDashboardPage({
  newUserName,
  newUserEmail,
  newUserRole,
  message,
  usersListVersion,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onCreateUser,
  onLogout,
}: ManagerDashboardPageProps) {
  const [users, setUsers] = useState<InstitutionUser[]>([])
  const [isUsersLoading, setIsUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')

  useEffect(() => {
    let isCancelled = false

    async function fetchUsers() {
      setIsUsersLoading(true)
      setUsersError('')

      const result = await loadInstitutionUsers()

      if (isCancelled) {
        return
      }

      if (!result.ok) {
        setUsers([])
        setUsersError(result.errorMessage)
      } else {
        setUsers(result.users)
      }

      setIsUsersLoading(false)
    }

    void fetchUsers()

    return () => {
      isCancelled = true
    }
  }, [usersListVersion])

  const teachersCount = countUsersByRole(users, 'teacher')
  const secretariesCount = countUsersByRole(users, 'secretary')
  const activeRequestsCount = 0

  return (
    <main dir="rtl" className="manager-dashboard">
      <ManagerDashboardHeader onLogout={onLogout} />

      <ManagerStatsCards
        teachersCount={teachersCount}
        secretariesCount={secretariesCount}
        activeRequestsCount={activeRequestsCount}
      />

      <TeamManagementSection
        users={users}
        isLoading={isUsersLoading}
        errorMessage={usersError}
        newUserName={newUserName}
        newUserEmail={newUserEmail}
        newUserRole={newUserRole}
        createUserMessage={message}
        onNewUserNameChange={onNewUserNameChange}
        onNewUserEmailChange={onNewUserEmailChange}
        onNewUserRoleChange={onNewUserRoleChange}
        onCreateUser={onCreateUser}
      />
    </main>
  )
}
