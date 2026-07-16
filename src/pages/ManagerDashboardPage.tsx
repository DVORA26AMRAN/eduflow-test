import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardShell } from '../components/dashboard/DashboardShell'
import { DashboardSectionPanel } from '../components/dashboard/DashboardSectionPanel'
import {
  NavArchiveIcon,
  NavBellIcon,
  NavCalendarIcon,
  NavChartIcon,
  NavClipboardIcon,
  NavInboxIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { MeetingCalendarSection } from '../components/meetingCalendar/MeetingCalendarSection'
import { ManagerAnalyticsSection } from '../components/manager/ManagerAnalyticsSection'
import { ManagerArchiveSection } from '../components/manager/ManagerArchiveSection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { StaffDirectoryPage } from './StaffDirectoryPage'
import { useAdminReminderNotifications } from '../hooks/useAdminReminderNotifications'
import { useUnreadRequestMessageNotifications } from '../hooks/useUnreadRequestMessageNotifications'
import { useDashboardSectionNavigation } from '../hooks/useDashboardSectionNavigation'
import { useReminderBellNavigation } from '../hooks/useReminderBellNavigation'
import { loadInstitutionUsers } from '../services/institutionUsers'
import { loadInstitutionRequestReminderSummaries } from '../services/requestReminders'
import { resolveManagerReminderRequestLocation } from '../services/reminderRequestLocation'
import {
  DASHBOARD_OVERVIEW_SECTION_ID,
  type DashboardRequestNavigationIntent,
} from '../types/dashboardAnalytics'
import type { RequestReminderSummary } from '../types/requestReminder'
import type { AuthenticatedUserProfile, InstitutionUser, UserRole } from '../types/user'
import { MEETING_CALENDAR_NAV_LABEL, MEETING_CALENDAR_SECTION_ID } from '../utils/meetingCalendarDisplay'
import {
  STAFF_DIRECTORY_NAV_LABEL,
  STAFF_DIRECTORY_SECTION_ID,
} from '../utils/staffDirectoryDisplay'
import {
  REMINDER_BELL_NAV_ID,
  REMINDER_NAV_ARIA_LABEL,
  REMINDER_NAV_LABEL,
} from '../utils/reminderNavigation'
import './ManagerDashboardPage.css'

const TEAM_MANAGEMENT_SECTION_ID = 'team'
const MANAGER_ARCHIVE_SECTION_ID = 'archive'
const MANAGER_TEACHER_REQUESTS_SECTION_ID = 'teacherRequests'

type ManagerDashboardPageProps = {
  profile: AuthenticatedUserProfile
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  newUserPhone: string
  newUserNationalId: string
  newUserJobTitle: string
  newUserWeeklyHours: string
  message: string
  usersListVersion: number
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onNewUserPhoneChange: (value: string) => void
  onNewUserNationalIdChange: (value: string) => void
  onNewUserJobTitleChange: (value: string) => void
  onNewUserWeeklyHoursChange: (value: string) => void
  onCreateUser: () => void
  onLogout: () => void
}

export function ManagerDashboardPage({
  profile,
  newUserName,
  newUserEmail,
  newUserRole,
  newUserPhone,
  newUserNationalId,
  newUserJobTitle,
  newUserWeeklyHours,
  message,
  usersListVersion,
  onNewUserNameChange,
  onNewUserEmailChange,
  onNewUserRoleChange,
  onNewUserPhoneChange,
  onNewUserNationalIdChange,
  onNewUserJobTitleChange,
  onNewUserWeeklyHoursChange,
  onCreateUser,
  onLogout,
}: ManagerDashboardPageProps) {
  const [users, setUsers] = useState<InstitutionUser[]>([])
  const [isUsersLoading, setIsUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
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

  const {
    unreadMessageRequestIds,
    requestIdsWithMessages,
    markConversationAsRead,
    registerRequestHasMessages,
  } = useUnreadRequestMessageNotifications()

  const handleConversationOpened = useCallback(
    async (requestId: string) => {
      registerRequestHasMessages(requestId)
      return markConversationAsRead(requestId)
    },
    [markConversationAsRead, registerRequestHasMessages],
  )

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
      {
        id: MANAGER_TEACHER_REQUESTS_SECTION_ID,
        label: 'בקשות מורים',
        icon: <NavInboxIcon />,
      },
      { id: MEETING_CALENDAR_SECTION_ID, label: MEETING_CALENDAR_NAV_LABEL, icon: <NavCalendarIcon /> },
      { id: STAFF_DIRECTORY_SECTION_ID, label: STAFF_DIRECTORY_NAV_LABEL, icon: <NavClipboardIcon /> },
      { id: MANAGER_ARCHIVE_SECTION_ID, label: 'הארכיון שלי', icon: <NavArchiveIcon /> },
      { id: TEAM_MANAGEMENT_SECTION_ID, label: 'ניהול משתמשים', icon: <NavUsersIcon /> },
    )

    return items
  }, [handleReminderBellClick, unreadCount])

  function handleNavigateToTeacherRequests(intent: DashboardRequestNavigationIntent) {
    void intent
    showSection(MANAGER_TEACHER_REQUESTS_SECTION_ID)
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
            onNavigateToTeacherRequests={handleNavigateToTeacherRequests}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-teacher-requests"
          sectionId={MANAGER_TEACHER_REQUESTS_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <ManagerRecentRequestsSection
            refreshToken={archiveRefreshToken}
            onArchived={handleRequestArchived}
            institutionId={profile.school?.id ?? null}
            unreadReminderRequestIds={unreadReminderRequestIds}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}
            reminderNavigationIntent={navigationIntent}
            highlightedRequestId={highlightedRequestId}
            onReminderNavigationComplete={handleReminderNavigationComplete}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-meeting-calendar"
          sectionId={MEETING_CALENDAR_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <MeetingCalendarSection actorUserId={profile.id} actorRole="institution_manager" />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-staff-directory"
          sectionId={STAFF_DIRECTORY_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <StaffDirectoryPage
            canEdit
            institutionName={profile.school?.name ?? ''}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-archive"
          sectionId={MANAGER_ARCHIVE_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <ManagerArchiveSection
            refreshToken={archiveRefreshToken}
            unreadMessageRequestIds={unreadMessageRequestIds}
            requestIdsWithMessages={requestIdsWithMessages}
            onConversationOpened={handleConversationOpened}
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
            newUserPhone={newUserPhone}
            newUserNationalId={newUserNationalId}
            newUserJobTitle={newUserJobTitle}
            newUserWeeklyHours={newUserWeeklyHours}
            createUserMessage={message}
            onNewUserNameChange={onNewUserNameChange}
            onNewUserEmailChange={onNewUserEmailChange}
            onNewUserRoleChange={onNewUserRoleChange}
            onNewUserPhoneChange={onNewUserPhoneChange}
            onNewUserNationalIdChange={onNewUserNationalIdChange}
            onNewUserJobTitleChange={onNewUserJobTitleChange}
            onNewUserWeeklyHoursChange={onNewUserWeeklyHoursChange}
            onCreateUser={onCreateUser}
          />
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
