import { useEffect, useState } from 'react'
import { ManagerDashboardHeader } from '../components/manager/ManagerDashboardHeader'
import { ManagerRecentActivitySection } from '../components/manager/ManagerRecentActivitySection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { ManagerStatsCards } from '../components/manager/ManagerStatsCards'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import {
  loadManagerAnalytics,
  loadRecentRequestActivity,
  loadRecentRequests,
} from '../services/analytics'
import { loadInstitutionUsers } from '../services/institutionUsers'
import type {
  ManagerAnalytics,
  ManagerRecentActivityEntry,
  ManagerRecentRequest,
} from '../types/analytics'
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
  const [recentRequests, setRecentRequests] = useState<ManagerRecentRequest[]>([])
  const [isRecentRequestsLoading, setIsRecentRequestsLoading] = useState(true)
  const [recentRequestsError, setRecentRequestsError] = useState('')
  const [recentActivity, setRecentActivity] = useState<ManagerRecentActivityEntry[]>([])
  const [isRecentActivityLoading, setIsRecentActivityLoading] = useState(true)
  const [recentActivityError, setRecentActivityError] = useState('')

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

  useEffect(() => {
    let isCancelled = false

    async function fetchInsights() {
      setIsRecentRequestsLoading(true)
      setIsRecentActivityLoading(true)
      setRecentRequestsError('')
      setRecentActivityError('')

      const [requestsResult, activityResult] = await Promise.all([
        loadRecentRequests(),
        loadRecentRequestActivity(),
      ])

      if (isCancelled) {
        return
      }

      if (!requestsResult.ok) {
        setRecentRequests([])
        setRecentRequestsError(requestsResult.errorMessage)
      } else {
        setRecentRequests(requestsResult.requests)
      }

      if (!activityResult.ok) {
        setRecentActivity([])
        setRecentActivityError(activityResult.errorMessage)
      } else {
        setRecentActivity(activityResult.entries)
      }

      setIsRecentRequestsLoading(false)
      setIsRecentActivityLoading(false)
    }

    void fetchInsights()

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

      <div className="manager-dashboard__insights">
        <ManagerRecentRequestsSection
          requests={recentRequests}
          isLoading={isRecentRequestsLoading}
          errorMessage={recentRequestsError}
        />

        <ManagerRecentActivitySection
          entries={recentActivity}
          isLoading={isRecentActivityLoading}
          errorMessage={recentActivityError}
        />
      </div>

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
