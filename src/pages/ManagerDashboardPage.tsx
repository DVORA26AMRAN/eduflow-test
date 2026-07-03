import { useEffect, useState } from 'react'
import { ManagerDashboardHeader } from '../components/manager/ManagerDashboardHeader'
import { ManagerStatsCards } from '../components/manager/ManagerStatsCards'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { loadManagerAnalytics } from '../services/analytics'
import { loadInstitutionUsers } from '../services/institutionUsers'
import type { ManagerAnalytics } from '../types/analytics'
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
  const [analytics, setAnalytics] = useState<ManagerAnalytics | null>(null)
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState('')

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

  useEffect(() => {
    let isCancelled = false

    async function fetchAnalytics() {
      setIsAnalyticsLoading(true)
      setAnalyticsError('')

      const result = await loadManagerAnalytics()

      if (isCancelled) {
        return
      }

      if (!result.ok) {
        setAnalytics(null)
        setAnalyticsError(result.errorMessage)
      } else {
        setAnalytics(result.analytics)
      }

      setIsAnalyticsLoading(false)
    }

    void fetchAnalytics()

    return () => {
      isCancelled = true
    }
  }, [usersListVersion])

  return (
    <main dir="rtl" className="manager-dashboard">
      <ManagerDashboardHeader onLogout={onLogout} />

      <ManagerStatsCards
        analytics={analytics}
        isLoading={isAnalyticsLoading}
        errorMessage={analyticsError}
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
