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
  NavNotebookIcon,
  NavPrintIcon,
  NavSettingsIcon,
  NavUsersIcon,
  type DashboardNavItem,
} from '../components/dashboard/dashboardNav'
import { ManagementJournalSection } from '../components/managementJournal/ManagementJournalSection'
import { MeetingCalendarSection } from '../components/meetingCalendar/MeetingCalendarSection'
import { AdminNotificationsSection } from '../components/notifications/AdminNotificationsSection'
import { ManagerAnalyticsSection } from '../components/manager/ManagerAnalyticsSection'
import { ManagerArchiveSection } from '../components/manager/ManagerArchiveSection'
import { ManagerRecentRequestsSection } from '../components/manager/ManagerRecentRequestsSection'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { SecretaryPrintingWorkspace } from '../components/secretary/printing/SecretaryPrintingWorkspace'
import {
  PRINTING_WORKSPACE_NAV_LABEL,
  PRINTING_WORKSPACE_SECTION_ID,
} from '../utils/secretaryPrinting'
import { UserSettingsSection } from '../components/settings/UserSettingsSection'
import {
  canEditOperationalUser,
  canManageCalendar,
  canManageRequests,
  canUseManagementJournal,
  canViewTeamManagement,
  canUseOperationalPrinting,
  canViewInstitutionArchive,
} from '../security/institutionCapabilities'
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
import { getAllowedTenantInviteRoles } from '../security/tenantInviteRoles'
import { MEETING_CALENDAR_NAV_LABEL, MEETING_CALENDAR_SECTION_ID } from '../utils/meetingCalendarDisplay'
import {
  MANAGEMENT_JOURNAL_NAV_LABEL,
  MANAGEMENT_JOURNAL_SECTION_ID,
} from '../utils/managementJournalDisplay'
import {
  STAFF_DIRECTORY_NAV_LABEL,
  STAFF_DIRECTORY_SECTION_ID,
} from '../utils/staffDirectoryDisplay'
import {
  detectGoogleIntegrationReturn,
  USER_SETTINGS_NAV_LABEL,
  USER_SETTINGS_SECTION_ID,
} from '../services/googleOAuth'
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
  const [usersRefreshToken, setUsersRefreshToken] = useState(0)
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0)
  const [analyticsRefreshToken, setAnalyticsRefreshToken] = useState(0)
  const [activeSectionId, setActiveSectionId] = useState<string>(DASHBOARD_OVERVIEW_SECTION_ID)
  const [reminderSummariesByRequestId, setReminderSummariesByRequestId] = useState<
    Map<string, RequestReminderSummary>
  >(new Map())
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const [printingFocusRequestId, setPrintingFocusRequestId] = useState<string | null>(null)
  const [adminNotificationsUnreadCount, setAdminNotificationsUnreadCount] = useState(0)
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
    role: profile.role === 'deputy' ? 'deputy' : 'institution_manager',
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
      ...(canManageRequests(profile.role)
        ? [
            {
              id: MANAGER_TEACHER_REQUESTS_SECTION_ID,
              label: 'בקשות מורים',
              icon: <NavInboxIcon />,
            },
          ]
        : []),
      {
        id: 'adminNotifications',
        label: 'התראות',
        icon: <NavBellIcon />,
        badgeCount: adminNotificationsUnreadCount > 0 ? adminNotificationsUnreadCount : undefined,
      },
      ...(canUseOperationalPrinting(profile.role)
        ? [
            {
              id: PRINTING_WORKSPACE_SECTION_ID,
              label: PRINTING_WORKSPACE_NAV_LABEL,
              icon: <NavPrintIcon />,
            },
          ]
        : []),
      ...(canManageCalendar(profile.role)
        ? [
            {
              id: MEETING_CALENDAR_SECTION_ID,
              label: MEETING_CALENDAR_NAV_LABEL,
              icon: <NavCalendarIcon />,
            },
          ]
        : []),
      ...(canUseManagementJournal(profile.role)
        ? [
            {
              id: MANAGEMENT_JOURNAL_SECTION_ID,
              label: MANAGEMENT_JOURNAL_NAV_LABEL,
              icon: <NavNotebookIcon />,
            },
          ]
        : []),
      { id: STAFF_DIRECTORY_SECTION_ID, label: STAFF_DIRECTORY_NAV_LABEL, icon: <NavClipboardIcon /> },
      ...(canViewInstitutionArchive(profile.role)
        ? [{ id: MANAGER_ARCHIVE_SECTION_ID, label: 'הארכיון שלי', icon: <NavArchiveIcon /> }]
        : []),
      ...(canViewTeamManagement(profile.role)
        ? [{ id: TEAM_MANAGEMENT_SECTION_ID, label: 'ניהול משתמשים', icon: <NavUsersIcon /> }]
        : []),
      { id: USER_SETTINGS_SECTION_ID, label: USER_SETTINGS_NAV_LABEL, icon: <NavSettingsIcon /> },
    )

    return items
  }, [adminNotificationsUnreadCount, handleReminderBellClick, profile.role, unreadCount])

  function handleNavigateToTeacherRequests(intent: DashboardRequestNavigationIntent) {
    void intent
    showSection(MANAGER_TEACHER_REQUESTS_SECTION_ID)
  }

  useEffect(() => {
    let isCancelled = false

    async function fetchUsers() {
      if (!canViewTeamManagement(profile.role)) {
        setUsers([])
        setUsersError('')
        setIsUsersLoading(false)
        return
      }

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
  }, [profile.role, usersListVersion, usersRefreshToken])

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

  useEffect(() => {
    if (detectGoogleIntegrationReturn()) {
      showSection(USER_SETTINGS_SECTION_ID)
    }
  }, [showSection])

  return (
    <DashboardShell
      roleLabel={profile.role === 'deputy' ? 'אזור סגנית' : 'אזור מנהלת'}
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
            actorUserId={profile.id}
            actorRole={profile.role === 'deputy' ? 'deputy' : 'institution_manager'}
            actorFullName={profile.fullName}
            institutionId={profile.school?.id ?? null}
            canChangeStatus={canManageRequests(profile.role)}
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
          id="manager-admin-notifications"
          sectionId="adminNotifications"
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <AdminNotificationsSection
            onUnreadCountChange={setAdminNotificationsUnreadCount}
            onNavigateToPrinting={(printingRequestId) => {
              setPrintingFocusRequestId(printingRequestId)
              showSection(PRINTING_WORKSPACE_SECTION_ID)
            }}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-printing-workspace"
          sectionId={PRINTING_WORKSPACE_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <SecretaryPrintingWorkspace
            actorUserId={profile.id}
            institutionId={profile.school!.id}
            institutionTimeZone={profile.school!.timeZone}
            focusRequestId={printingFocusRequestId}
            onFocusRequestConsumed={() => setPrintingFocusRequestId(null)}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-meeting-calendar"
          sectionId={MEETING_CALENDAR_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <MeetingCalendarSection
            actorUserId={profile.id}
            actorRole={profile.role === 'deputy' ? 'deputy' : 'institution_manager'}
            institutionTimezone={profile.school!.timeZone}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-management-journal"
          sectionId={MANAGEMENT_JOURNAL_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <ManagementJournalSection
            actorUserId={profile.id}
            actorFullName={profile.fullName}
            actorRole={profile.role}
            institutionId={profile.school!.id}
          />
        </DashboardSectionPanel>

        <DashboardSectionPanel
          id="manager-staff-directory"
          sectionId={STAFF_DIRECTORY_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <StaffDirectoryPage
            canEdit={canEditOperationalUser(profile.role, 'teacher')}
            actorRole={profile.role}
            actorUserId={profile.id}
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

        {canViewTeamManagement(profile.role) ? (
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
            allowedRoles={getAllowedTenantInviteRoles(profile.role)}
            onNewUserNameChange={onNewUserNameChange}
            onNewUserEmailChange={onNewUserEmailChange}
            onNewUserRoleChange={onNewUserRoleChange}
            onNewUserPhoneChange={onNewUserPhoneChange}
            onNewUserNationalIdChange={onNewUserNationalIdChange}
            onNewUserJobTitleChange={onNewUserJobTitleChange}
            onNewUserWeeklyHoursChange={onNewUserWeeklyHoursChange}
            actorRole={profile.role}
            actorUserId={profile.id}
            onUsersRefresh={async () => {
              setUsersRefreshToken((t) => t + 1)
            }}
            onCreateUser={onCreateUser}
          />
        </DashboardSectionPanel>
        ) : null}

        <DashboardSectionPanel
          id="manager-user-settings"
          sectionId={USER_SETTINGS_SECTION_ID}
          activeSectionId={activeSectionId}
          className="manager-dashboard__shell-section"
        >
          <UserSettingsSection />
        </DashboardSectionPanel>
      </div>
    </DashboardShell>
  )
}
