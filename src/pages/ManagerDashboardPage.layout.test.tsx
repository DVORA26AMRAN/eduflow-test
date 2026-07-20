import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerDashboardPage } from './ManagerDashboardPage'

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
  ManagerArchiveSection: () => <div data-testid="manager-archive">ארכיון</div>,
}))

vi.mock('../components/manager/TeamManagementSection', () => ({
  TeamManagementSection: () => <div data-testid="manager-team">צוות</div>,
}))

vi.mock('../components/manager/ManagerRecentRequestsSection', () => ({
  ManagerRecentRequestsSection: () => (
    <section aria-label="בקשות מורים" data-testid="manager-recent-requests">
      <h2>בקשות מורים</h2>
    </section>
  ),
}))

vi.mock('../components/meetingCalendar/MeetingCalendarSection', () => ({
  MeetingCalendarSection: () => <div data-testid="meeting-calendar">יומן פגישות</div>,
}))

afterEach(() => {
  cleanup()
})

const managerProfile = {
  id: 'manager-1',
  fullName: 'מנהלת',
  role: 'institution_manager' as const,
  school: { id: 'school-1', name: 'בית ספר', logoUrl: null, logoUpdatedAt: null },
}

describe('Manager dashboard requests layout', () => {
  it('does not render the recent activity panel', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <ManagerDashboardPage
        profile={managerProfile}
        newUserName=""
        newUserEmail=""
        newUserRole="teacher"
        newUserPhone=""
        newUserNationalId=""
        newUserJobTitle=""
        newUserWeeklyHours=""
        message=""
        usersListVersion={0}
        onNewUserNameChange={() => undefined}
        onNewUserEmailChange={() => undefined}
        onNewUserRoleChange={() => undefined}
        onNewUserPhoneChange={() => undefined}
        onNewUserNationalIdChange={() => undefined}
        onNewUserJobTitleChange={() => undefined}
        onNewUserWeeklyHoursChange={() => undefined}
        onCreateUser={() => undefined}
        onLogout={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'בקשות מורים' }))

    expect(screen.queryByText('פעילות אחרונה')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'בקשות מורים' })).toBeInTheDocument()
  })

  it('shows בקשות מורים in the sidebar and section title', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <ManagerDashboardPage
        profile={managerProfile}
        newUserName=""
        newUserEmail=""
        newUserRole="teacher"
        newUserPhone=""
        newUserNationalId=""
        newUserJobTitle=""
        newUserWeeklyHours=""
        message=""
        usersListVersion={0}
        onNewUserNameChange={() => undefined}
        onNewUserEmailChange={() => undefined}
        onNewUserRoleChange={() => undefined}
        onNewUserPhoneChange={() => undefined}
        onNewUserNationalIdChange={() => undefined}
        onNewUserJobTitleChange={() => undefined}
        onNewUserWeeklyHoursChange={() => undefined}
        onCreateUser={() => undefined}
        onLogout={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'בקשות מורים' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'בקשות מורים' }))

    expect(screen.getByRole('heading', { name: 'בקשות מורים' })).toBeInTheDocument()
  })

  it('uses a single full-width requests layout without the old insights grid', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ManagerDashboardPage.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ManagerDashboardPage.css'), 'utf8')

    expect(pageSource).not.toContain('ManagerRecentActivitySection')
    expect(pageSource).not.toContain('manager-dashboard__insights')
    expect(css).not.toContain('manager-dashboard__insights')
    expect(css).toContain('.manager-dashboard__requests-card')
    expect(css).toContain('width: 100%')
  })

  it('keeps teacher dashboard free of the manager requests rename', () => {
    const teacherSource = readFileSync(resolve(process.cwd(), 'src/pages/TeacherDashboardPage.tsx'), 'utf8')

    expect(teacherSource).not.toContain('בקשות מורים')
  })
})

describe('ManagerRecentRequestsSection labels', () => {
  it('uses בקשות מורים as the section label', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/manager/ManagerRecentRequestsSection.tsx'),
      'utf8',
    )

    expect(source).toContain('title="בקשות מורים"')
    expect(source).toContain('aria-label="בקשות מורים"')
    expect(source).not.toContain('בקשות אחרונות')
    expect(source).not.toContain('פעילות אחרונה')
  })
})
