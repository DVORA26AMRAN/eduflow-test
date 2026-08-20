import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerDashboardPage } from '../pages/ManagerDashboardPage'
import { SecretaryDashboardPage } from '../pages/SecretaryDashboardPage'
import { TeacherDashboardPage } from '../pages/TeacherDashboardPage'
import { PlatformAdminDashboardPage } from '../pages/PlatformAdminDashboardPage'
import { MANAGEMENT_JOURNAL_NAV_LABEL } from './managementJournalDisplay'
import type { AuthenticatedUserProfile } from '../types/user'

vi.mock('../services/dashboardAnalytics', () => ({
  loadManagerDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      totalInstitutionRequests: 0,
      activeRequests: 0,
      statusCounts: { new: 0, in_progress: 0, completed: 0, rejected: 0 },
      completionRate: null,
      requestsWithReminders: 0,
      typeCounts: {
        absence: 0,
        budget_or_equipment: 0,
        substitute_teacher: 0,
        general_request: 0,
      },
      trend: [],
      completionTrend: [],
      averageProcessingHours: null,
      processingTimeTrend: [],
      generalRequestRouting: { secretary: 0, institution_manager: 0 },
      attentionRequests: [],
      typeBacklog: [],
    },
  })),
  loadSecretaryDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      activeRequests: 0,
      statusCounts: { new: 0, in_progress: 0, completed: 0, rejected: 0 },
      activeWorkloadCounts: { new: 0, in_progress: 0 },
      completedInPeriod: 0,
      rejectedInPeriod: 0,
      unreadReminderCount: 0,
      typeCounts: {
        absence: 0,
        budget_or_equipment: 0,
        substitute_teacher: 0,
        general_request: 0,
      },
      trend: [],
      processingTimeTrend: [],
      averageProcessingHours: null,
      attentionRequests: [],
      workloadAging: [],
    },
  })),
  loadTeacherDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      totalSubmitted: 0,
      statusCounts: { new: 0, in_progress: 0, completed: 0, rejected: 0 },
      typeCounts: {
        absence: 0,
        budget_or_equipment: 0,
        substitute_teacher: 0,
        general_request: 0,
      },
      trend: [],
      followUpRequests: [],
      longestAwaitingHours: null,
    },
  })),
}))

vi.mock('../services/analytics', () => ({
  loadRecentRequests: vi.fn(async () => ({ ok: true, requests: [] })),
}))

vi.mock('../services/institutionUsers', () => ({
  loadInstitutionUsers: vi.fn(async () => ({ ok: true, users: [] })),
}))

vi.mock('../services/requestReminders', async () => {
  const actual = await vi.importActual('../services/requestReminders')
  return {
    ...actual,
    loadTeacherRequestReminderStates: vi.fn(async () => ({ ok: true, states: [] })),
    loadInstitutionRequestReminderSummaries: vi.fn(async () => ({ ok: true, summaries: [] })),
    subscribeToInstitutionRequestReminders: vi.fn(() => ({})),
    unsubscribeFromInstitutionRequestReminders: vi.fn(async () => undefined),
  }
})

vi.mock('../hooks/useAdminReminderNotifications', () => ({
  useAdminReminderNotifications: () => ({
    unreadCount: 0,
    unreadReminderRequestIds: new Set(),
    getNewestUnreadReminder: () => null,
    markReminderNotificationAsRead: vi.fn(),
  }),
}))

vi.mock('../hooks/useUnreadRequestMessageNotifications', () => ({
  useUnreadRequestMessageNotifications: () => ({
    unreadMessageRequestIds: new Set(),
    requestIdsWithMessages: new Set(),
    markConversationAsRead: vi.fn(),
    registerRequestHasMessages: vi.fn(),
  }),
}))

vi.mock('../hooks/useReminderBellNavigation', () => ({
  useReminderBellNavigation: () => ({
    navigationIntent: null,
    highlightedRequestId: null,
    handleReminderBellClick: vi.fn(),
    handleReminderNavigationComplete: vi.fn(),
  }),
}))

vi.mock('../components/manager/ManagerArchiveSection', () => ({
  ManagerArchiveSection: () => <div>ארכיון</div>,
}))

vi.mock('../components/manager/TeamManagementSection', () => ({
  TeamManagementSection: () => <div>צוות</div>,
}))

vi.mock('../components/manager/ManagerRecentRequestsSection', () => ({
  ManagerRecentRequestsSection: () => <div>בקשות מורים</div>,
}))

vi.mock('../components/manager/ManagerAnalyticsSection', () => ({
  ManagerAnalyticsSection: () => <div>סקירה</div>,
}))

vi.mock('../components/secretary/SecretaryAnalyticsSection', () => ({
  SecretaryAnalyticsSection: () => <div>סקירה</div>,
}))

vi.mock('../components/secretary/SecretaryArchiveSection', () => ({
  SecretaryArchiveSection: () => <div>ארכיון</div>,
}))

vi.mock('../components/secretary/SecretaryRequestsInbox', () => ({
  SecretaryRequestsInbox: () => <div>תיבה</div>,
}))

vi.mock('../components/secretary/SecretarySubstituteApprovalsSection', () => ({
  SecretarySubstituteApprovalsSection: () => <div>אישורים</div>,
}))

vi.mock('../components/teacher/TeacherAnalyticsSection', () => ({
  TeacherAnalyticsSection: () => <div>סקירה</div>,
}))

vi.mock('../components/meetingCalendar/MeetingCalendarSection', () => ({
  MeetingCalendarSection: () => <div>יומן פגישות</div>,
}))

vi.mock('../components/managementJournal/ManagementJournalSection', () => ({
  ManagementJournalSection: () => <div data-testid="management-journal-section">יומן ניהול</div>,
}))

vi.mock('../pages/StaffDirectoryPage', () => ({
  StaffDirectoryPage: () => <div>סגל</div>,
}))

vi.mock('../components/secretary/printing/SecretaryPrintingWorkspace', () => ({
  SecretaryPrintingWorkspace: () => <div>הדפסות</div>,
}))

vi.mock('../components/settings/UserSettingsSection', () => ({
  UserSettingsSection: () => <div>הגדרות</div>,
}))

vi.mock('../components/notifications/AdminNotificationsSection', () => ({
  AdminNotificationsSection: () => <div>התראות</div>,
}))

vi.mock('../components/platform/PlatformAdminSchoolsSection', () => ({
  PlatformAdminSchoolsSection: () => <div>בתי ספר</div>,
}))

vi.mock('../components/platform/PlatformAdminRegistrationsSection', () => ({
  PlatformAdminRegistrationsSection: () => <div>הרשמות</div>,
}))

afterEach(() => {
  cleanup()
})

const formProps = {
  newUserName: '',
  newUserEmail: '',
  newUserRole: 'teacher' as const,
  newUserPhone: '',
  newUserNationalId: '',
  newUserJobTitle: '',
  newUserWeeklyHours: '',
  message: '',
  usersListVersion: 0,
  onNewUserNameChange: () => undefined,
  onNewUserEmailChange: () => undefined,
  onNewUserRoleChange: () => undefined,
  onNewUserPhoneChange: () => undefined,
  onNewUserNationalIdChange: () => undefined,
  onNewUserJobTitleChange: () => undefined,
  onNewUserWeeklyHoursChange: () => undefined,
  onCreateUser: () => undefined,
  onLogout: () => undefined,
}

function profileFor(role: AuthenticatedUserProfile['role']): AuthenticatedUserProfile {
  return {
    id: `${role}-1`,
    fullName: 'משתמשת',
    role,
    status: 'active',
    school: {
      id: 'school-1',
      name: 'בית ספר',
      timeZone: 'Asia/Jerusalem',
      logoUrl: null,
      logoUpdatedAt: null,
    },
  }
}

describe('J2A journal navigation gating', () => {
  it('shows יומן ניהול for manager, deputy, and secretary', () => {
    const { unmount: unmountManager } = render(
      <ManagerDashboardPage profile={profileFor('institution_manager')} {...formProps} />,
    )
    expect(screen.getByRole('button', { name: MANAGEMENT_JOURNAL_NAV_LABEL })).toBeInTheDocument()
    unmountManager()

    const { unmount: unmountDeputy } = render(
      <ManagerDashboardPage profile={profileFor('deputy')} {...formProps} />,
    )
    expect(screen.getByRole('button', { name: MANAGEMENT_JOURNAL_NAV_LABEL })).toBeInTheDocument()
    unmountDeputy()

    render(<SecretaryDashboardPage profile={profileFor('secretary')} {...formProps} />)
    expect(screen.getByRole('button', { name: MANAGEMENT_JOURNAL_NAV_LABEL })).toBeInTheDocument()
  })

  it('does not show יומן ניהול for teacher or platform admin', () => {
    const { unmount } = render(
      <TeacherDashboardPage profile={profileFor('teacher')} onLogout={() => undefined} />,
    )
    expect(screen.queryByRole('button', { name: MANAGEMENT_JOURNAL_NAV_LABEL })).not.toBeInTheDocument()
    unmount()

    render(
      <PlatformAdminDashboardPage profile={profileFor('platform_admin')} onLogout={() => undefined} />,
    )
    expect(screen.queryByRole('button', { name: MANAGEMENT_JOURNAL_NAV_LABEL })).not.toBeInTheDocument()
  })
})
