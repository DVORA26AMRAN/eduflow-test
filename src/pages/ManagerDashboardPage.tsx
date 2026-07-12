import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import {
  NavActivityIcon,
  NavArchiveIcon,
  NavBellIcon,
  NavChartIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { ManagerArchiveSection } from '../components/manager/ManagerArchiveSection'
import { ManagerRecentActivitySection } from '../components/manager/ManagerRecentActivitySection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { ManagerRequestTypeDistribution } from '../components/manager/ManagerRequestTypeDistribution'
import { ManagerStatsCards } from '../components/manager/ManagerStatsCards'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { useAdminReminderNotifications } from '../hooks/useAdminReminderNotifications'
import { useReminderBellNavigation } from '../hooks/useReminderBellNavigation'
import {
  loadManagerAnalytics,
  loadRecentRequestActivity,
} from '../services/analytics'
import { loadInstitutionUsers } from '../services/institutionUsers'
import { resolveManagerReminderRequestLocation } from '../services/reminderRequestLocation'
import {
  REMINDER_BELL_NAV_ID,
  REMINDER_NAV_ARIA_LABEL,
  REMINDER_NAV_LABEL,
} from '../utils/reminderNavigation'
import type {
  ManagerAnalytics,
  ManagerRecentActivityEntry,
} from '../types/analytics'
import type { AuthenticatedUserProfile, InstitutionUser, UserRole } from '../types/user'
import './ManagerDashboardPage.css'

const TEAM_MANAGEMENT_SECTION_ID = 'team'
const MANAGER_ARCHIVE_SECTION_ID = 'archive'

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
  const [recentActivity, setRecentActivity] = useState<ManagerRecentActivityEntry[]>([])
  const [isRecentActivityLoading, setIsRecentActivityLoading] = useState(true)
  const [recentActivityError, setRecentActivityError] = useState('')
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)
  const [activeSectionId, setActiveSectionId] = useState<string>('stats')
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const announcementTimeoutRef = useRef<number | null>(null)

  const {
    unreadCount,
    unreadReminderRequestIds,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
  } = useAdminReminderNotifications()

  const scrollToSection = useCallback((sectionId: string) => {
    const target = document.querySelector<HTMLElement>(
      `.manager-dashboard [data-section-id="${sectionId}"]`,
    )
    if (!target) {
      return
    }

    setActiveSectionId(sectionId)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    requestAnimationFrame(() => target.focus({ preventScroll: true }))
  }, [])

  const announceNavigation = useCallback((message: string) => {
    setLiveAnnouncement(message)

    if (announcementTimeoutRef.current !== null) {
      window.clearTimeout(announcementTimeoutRef.current)
    }

    announcementTimeoutRef.current = window.setTimeout(() => {
      setLiveAnnouncement('')
      announcementTimeoutRef.current = null
    }, 3000)
  }, [])

  const {
    navigationIntent,
    highlightedRequestId,
    handleReminderBellClick,
    handleReminderNavigationComplete,
  } = useReminderBellNavigation({
    role: 'institution_manager',
    scrollToSection,
    resolveLocation: resolveManagerReminderRequestLocation,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
    onNavigationAnnouncement: announceNavigation,
  })

  const managerNavItems: DashboardNavItem[] = useMemo(() => {
    const items: DashboardNavItem[] = [
      { id: 'stats', label: 'נתונים', icon: <NavChartIcon /> },
    ]

    if (unreadCount > 0) {
      items.push({
        id: REMINDER_BELL_NAV_ID,
        label: REMINDER_NAV_LABEL,
        icon: <NavBellIcon />,
        badgeCount: unreadCount,
        badgeAnimate: true,
        ariaLabel: REMINDER_NAV_ARIA_LABEL,
        onSelect: () => {
          void handleReminderBellClick()
        },
      })
    }

    items.push(
      { id: 'recentActivity', label: 'פעילות אחרונה', icon: <NavActivityIcon /> },
      { id: MANAGER_ARCHIVE_SECTION_ID, label: 'הארכיון שלי', icon: <NavArchiveIcon /> },
      { id: TEAM_MANAGEMENT_SECTION_ID, label: 'ניהול משתמשים', icon: <NavUsersIcon /> },
    )

    return items
  }, [handleReminderBellClick, unreadCount])

  function handleSectionSelect(sectionId: string) {
    scrollToSection(sectionId)
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
  }, [usersListVersion, archiveRefreshToken])

  useEffect(() => {
    let isCancelled = false

    async function fetchRecentActivity() {
      setIsRecentActivityLoading(true)
      setRecentActivityError('')

      const activityResult = await loadRecentRequestActivity()

      if (isCancelled) {
        return
      }

      if (!activityResult.ok) {
        setRecentActivity([])
        setRecentActivityError(activityResult.errorMessage)
      } else {
        setRecentActivity(activityResult.entries)
      }

      setIsRecentActivityLoading(false)
    }

    void fetchRecentActivity()

    return () => {
      isCancelled = true
    }
  }, [usersListVersion, archiveRefreshToken])

  function handleRequestArchived() {
    setArchiveRefreshToken((token) => token + 1)
  }

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

  useEffect(() => {
    return () => {
      if (announcementTimeoutRef.current !== null) {
        window.clearTimeout(announcementTimeoutRef.current)
      }
    }
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
        <div className="reminder-navigation-live-region" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

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
              refreshToken={archiveRefreshToken}
              onArchived={handleRequestArchived}
              institutionId={profile.school?.id ?? null}
              unreadReminderRequestIds={unreadReminderRequestIds}
              reminderNavigationIntent={navigationIntent}
              highlightedRequestId={highlightedRequestId}
              onReminderNavigationComplete={handleReminderNavigationComplete}
            />

            <ManagerRecentActivitySection
              entries={recentActivity}
              isLoading={isRecentActivityLoading}
              errorMessage={recentActivityError}
            />
          </div>
        </section>

        <section
          id="manager-archive"
          data-section-id={MANAGER_ARCHIVE_SECTION_ID}
          className="manager-dashboard__shell-section"
          tabIndex={-1}
        >
          <ManagerArchiveSection
            refreshToken={archiveRefreshToken}
            reminderNavigationIntent={navigationIntent}
            onReminderNavigationComplete={handleReminderNavigationComplete}
          />
        </section>

        <section
          id="manager-team"
          data-section-id={TEAM_MANAGEMENT_SECTION_ID}
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
