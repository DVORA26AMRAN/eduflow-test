import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'
import {
  NavActivityIcon,
  NavArchiveIcon,
  NavBellIcon,
  NavChartIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { ManagerAnalyticsSection } from '../components/manager/ManagerAnalyticsSection'
import { ManagerArchiveSection } from '../components/manager/ManagerArchiveSection'
import { ManagerRecentActivitySection } from '../components/manager/ManagerRecentActivitySection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { useAdminReminderNotifications } from '../hooks/useAdminReminderNotifications'
import { useDashboardSectionNavigation } from '../hooks/useDashboardSectionNavigation'
import { useReminderBellNavigation } from '../hooks/useReminderBellNavigation'
import { loadRecentRequestActivity } from '../services/analytics'
import { loadInstitutionUsers } from '../services/institutionUsers'
import { loadInstitutionRequestReminderSummaries } from '../services/requestReminders'
import { resolveManagerReminderRequestLocation } from '../services/reminderRequestLocation'
import {
  DASHBOARD_OVERVIEW_SECTION_ID,
  type DashboardRequestNavigationIntent,
} from '../types/dashboardAnalytics'
import type { ManagerRecentActivityEntry } from '../types/analytics'
import type { RequestReminderSummary } from '../types/requestReminder'
import type { AuthenticatedUserProfile, InstitutionUser, UserRole } from '../types/user'
import {
  REMINDER_BELL_NAV_ID,
  REMINDER_NAV_ARIA_LABEL,
  REMINDER_NAV_LABEL,
} from '../utils/reminderNavigation'
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
  const [recentActivity, setRecentActivity] = useState<ManagerRecentActivityEntry[]>([])
  const [isRecentActivityLoading, setIsRecentActivityLoading] = useState(true)
  const [recentActivityError, setRecentActivityError] = useState('')
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)
  const [analyticsRefreshToken, setAnalyticsRefreshToken] = useState(0)
  const [activeSectionId, setActiveSectionId] = useState<string>(DASHBOARD_OVERVIEW_SECTION_ID)
  const [reminderSummariesByRequestId, setReminderSummariesByRequestId] = useState<
    Map<string, RequestReminderSummary>
  >(new Map())
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const announcementTimeoutRef = useRef<number | null>(null)

  const showSection = useDashboardSectionNavigation(setActiveSectionId)

  const {
    unreadCount,
    unreadReminderRequestIds,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
  } = useAdminReminderNotifications()

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
    scrollToSection: showSection,
    resolveLocation: resolveManagerReminderRequestLocation,
    getNewestUnreadReminder,
    markReminderNotificationAsRead,
    onNavigationAnnouncement: announceNavigation,
  })

  const managerNavItems: DashboardNavItem[] = useMemo(() => {
    const items: DashboardNavItem[] = [
      { id: DASHBOARD_OVERVIEW_SECTION_ID, label: 'סקירה כללית', icon: <NavChartIcon /> },
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

  function handleNavigateToRecentActivity(intent: DashboardRequestNavigationIntent) {
    void intent
    showSection('recentActivity')
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

  useEffect(() => {
    let isCancelled = false

    async function fetchReminderSummaries() {
      const result = await loadInstitutionRequestReminderSummaries()
      if (isCancelled || !result.ok) {
        return
      }

      setReminderSummariesByRequestId(
        new Map(result.summaries.map((summary) => [summary.request_id, summary])),
      )
    }

    void fetchReminderSummaries()

    return () => {
      isCancelled = true
    }
  }, [archiveRefreshToken, analyticsRefreshToken, unreadCount])

  function handleRequestArchived() {
    setArchiveRefreshToken((token) => token + 1)
    setAnalyticsRefreshToken((token) => token + 1)
  }

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
      onSectionSelect={showSection}
      onLogout={onLogout}
    >
      <div dir="rtl" className="manager-dashboard">
        <div className="reminder-navigation-live-region" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        <DashboardSectionPanel
          id="manager-overview"
          sectionId={DASHBOARD_OVERVIEW_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <ManagerAnalyticsSection
            refreshToken={analyticsRefreshToken + archiveRefreshToken + usersListVersion}
            reminderSummariesByRequestId={reminderSummariesByRequestId}
            onNavigateToRecentActivity={handleNavigateToRecentActivity}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-recent-activity"
          sectionId="recentActivity"
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
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
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-archive"
          sectionId={MANAGER_ARCHIVE_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <ManagerArchiveSection
            refreshToken={archiveRefreshToken}
            reminderNavigationIntent={navigationIntent}
            onReminderNavigationComplete={handleReminderNavigationComplete}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-team"
          sectionId={TEAM_MANAGEMENT_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
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
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
