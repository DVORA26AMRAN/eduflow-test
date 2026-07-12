import { useEffect, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import {
  NavActivityIcon,
  NavChartIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { ManagerRecentActivitySection } from '../components/manager/ManagerRecentActivitySection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { ManagerRequestTypeDistribution } from '../components/manager/ManagerRequestTypeDistribution'
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
import type { AuthenticatedUserProfile, InstitutionUser, UserRole } from '../types/user'
import './ManagerDashboardPage.css'

type ManagerDashboardPageProps = {
  profile: AuthenticatedUserProfile
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

const managerNavItems: DashboardNavItem[] = [
  { id: 'stats', label: 'נתונים', icon: <NavChartIcon /> },
  { id: 'recentActivity', label: 'פעילות אחרונה', icon: <NavActivityIcon /> },
  { id: 'team', label: 'ניהול צוות', icon: <NavUsersIcon /> },
]

export function ManagerDashboardPage({
  profile,
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
  const [activeSectionId, setActiveSectionId] = useState<string>('stats')

  function handleSectionSelect(sectionId: string) {
    const target = document.querySelector<HTMLElement>(
      `.manager-dashboard [data-section-id="${sectionId}"]`,
    )
    if (!target) {
      return
    }

    setActiveSectionId(sectionId)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    requestAnimationFrame(() => target.focus({ preventScroll: true }))
  }

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

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.manager-dashboard [data-section-id]'),
    )

    if (sections.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting)
        if (visibleEntries.length === 0) {
          return
        }

        const mostVisible = visibleEntries.sort(
          (a, b) => b.intersectionRatio - a.intersectionRatio,
        )[0]
        const sectionId = mostVisible.target.getAttribute('data-section-id')
        if (sectionId) {
          setActiveSectionId(sectionId)
        }
      },
      { threshold: [0.3, 0.6], rootMargin: '-15% 0px -55% 0px' },
    )

    sections.forEach((section) => observer.observe(section))

    return () => observer.disconnect()
  }, [])

  return (
    <DashboardShell
      roleLabel="אזור מנהלת"
      subtitle="ברוכה הבאה ל־EduFlow."
      profile={profile}
      navItems={managerNavItems}
      activeSectionId={activeSectionId}
      onSectionSelect={handleSectionSelect}
      onLogout={onLogout}
    >
      <div dir="rtl" className="manager-dashboard">
        <section
          id="manager-stats"
          data-section-id="stats"
          className="manager-dashboard__shell-section"
          tabIndex={-1}
        >
          <ManagerStatsCards
            analytics={analytics}
            isLoading={isAnalyticsLoading}
            errorMessage={analyticsError}
          />

          <ManagerRequestTypeDistribution
            analytics={analytics}
            isLoading={isAnalyticsLoading}
            errorMessage={analyticsError}
          />
        </section>

        <section
          id="manager-recent-activity"
          data-section-id="recentActivity"
          className="manager-dashboard__shell-section"
          tabIndex={-1}
        >
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
        </section>

        <section
          id="manager-team"
          data-section-id="team"
          className="manager-dashboard__shell-section"
          tabIndex={-1}
        >
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
        </section>
      </div>
    </DashboardShell>
  )
}
