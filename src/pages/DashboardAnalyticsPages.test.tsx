import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherDashboardPage } from './TeacherDashboardPage'
import { SecretaryDashboardPage } from './SecretaryDashboardPage'
import { ManagerDashboardPage } from './ManagerDashboardPage'
import { DASHBOARD_OVERVIEW_SECTION_ID } from '../types/dashboardAnalytics'

vi.mock('../services/dashboardAnalytics', () => ({
  loadTeacherDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      totalSubmitted: 2,
      statusCounts: { new: 1, in_progress: 1, completed: 0, rejected: 0 },
      typeCounts: {
        absence: 2,
        budget_or_equipment: 0,
        substitute_teacher: 0,
        general_request: 0,
      },
      trend: [{ bucketStart: '2026-07-01', label: '1/7', count: 2 }],
      followUpRequests: [],
      longestAwaitingHours: null,
    },
  })),
  loadSecretaryDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      activeRequests: 2,
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
  loadManagerDashboardAnalytics: vi.fn(async () => ({
    ok: true,
    analytics: {
      totalInstitutionRequests: 3,
      activeRequests: 1,
      statusCounts: { new: 1, in_progress: 0, completed: 2, rejected: 0 },
      completionRate: 100,
      requestsWithReminders: 0,
      typeCounts: {
        absence: 3,
        budget_or_equipment: 0,
        substitute_teacher: 0,
        general_request: 0,
      },
      trend: [{ bucketStart: '2026-07-01', label: '1/7', count: 3 }],
      completionTrend: [],
      averageProcessingHours: null,
      processingTimeTrend: [],
      generalRequestRouting: { secretary: 0, institution_manager: 0 },
      attentionRequests: [],
      typeBacklog: [],
    },
  })),
}))

vi.mock('../services/requestReminders', async () => {
  const actual = await vi.importActual('../services/requestReminders')
  return {
    ...actual,
    loadTeacherRequestReminderStates: vi.fn(async () => ({ ok: true, states: [] })),
    loadInstitutionRequestReminderSummaries: vi.fn(async () => ({ ok: true, summaries: [] })),
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

vi.mock('../hooks/useReminderBellNavigation', () => ({
  useReminderBellNavigation: () => ({
    navigationIntent: null,
    highlightedRequestId: null,
    handleReminderBellClick: vi.fn(),
    handleReminderNavigationComplete: vi.fn(),
  }),
}))

vi.mock('../services/requests', () => ({
  loadTeacherRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  loadMyArchivedRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  loadSecretaryRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  loadSecretaryArchivedRequests: vi.fn(async () => ({ ok: true, requests: [] })),
  archiveRequest: vi.fn(),
  createTeacherRequest: vi.fn(),
  updateRequestStatus: vi.fn(),
  archiveRequestAsSecretary: vi.fn(),
}))

vi.mock('../components/teacher/TeacherNotificationsSection', () => ({
  TeacherNotificationsSection: () => <div data-testid="teacher-notifications">התראות</div>,
}))

vi.mock('../components/teacher/TeacherSubstituteBoardSection', () => ({
  TeacherSubstituteBoardSection: () => <div data-testid="teacher-substitute-board">לוח מילויי מקום</div>,
}))

vi.mock('../components/teacher/TeacherArchiveSection', () => ({
  TeacherArchiveSection: () => <div data-testid="teacher-archive">ארכיון</div>,
}))

vi.mock('../components/secretary/SecretarySubstituteApprovalsSection', () => ({
  SecretarySubstituteApprovalsSection: () => (
    <div data-testid="secretary-substitute-approvals">אישורים</div>
  ),
}))

vi.mock('../components/secretary/SecretaryRequestsInbox', () => ({
  SecretaryRequestsInbox: () => <div data-testid="secretary-requests-inbox">תיבת בקשות</div>,
}))

vi.mock('../components/secretary/SecretaryArchiveSection', () => ({
  SecretaryArchiveSection: () => <div data-testid="secretary-archive">ארכיון מוסדי</div>,
}))

vi.mock('../components/manager/ManagerRecentRequestsSection', () => ({
  ManagerRecentRequestsSection: () => <div data-testid="manager-recent-requests">בקשות מורים</div>,
}))

vi.mock('../components/manager/ManagerArchiveSection', () => ({
  ManagerArchiveSection: () => <div data-testid="manager-archive">ארכיון מנהלת</div>,
}))

vi.mock('../components/manager/TeamManagementSection', () => ({
  TeamManagementSection: () => <div data-testid="manager-team">צוות</div>,
}))

vi.mock('../services/attachments', () => ({
  loadRequestAttachmentRequestIds: vi.fn(async () => ({ ok: true, requestIds: [] })),
  uploadRequestAttachment: vi.fn(),
}))

vi.mock('../services/analytics', () => ({
  loadRecentRequests: vi.fn(async () => ({ ok: true, requests: [] })),
}))

vi.mock('../services/institutionUsers', () => ({
  loadInstitutionUsers: vi.fn(async () => ({ ok: true, users: [] })),
}))

afterEach(() => {
  cleanup()
})

const profile = {
  id: 'user-1',
  fullName: 'משתמש',
  role: 'teacher' as const,
  school: { id: 'school-1', name: 'בית ספר', logoUrl: null, logoUpdatedAt: null },
}

function expectOnlyOverviewSection(container: HTMLElement) {
  const sections = container.querySelectorAll('[data-section-id]')
  expect(sections).toHaveLength(1)
  expect(sections[0]?.getAttribute('data-section-id')).toBe(DASHBOARD_OVERVIEW_SECTION_ID)
}

describe('dashboard overview section isolation', () => {
  it('teacher overview renders analytics only without sidebar-duplicate sections', async () => {
    const { container } = render(<TeacherDashboardPage profile={profile} onLogout={() => undefined} />)

    expectOnlyOverviewSection(container)
    expect(await screen.findByText('סך הבקשות שנשלחו')).toBeInTheDocument()
    expect(screen.queryByText('פתיחת בקשה חדשה')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-notifications')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-substitute-board')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-archive')).not.toBeInTheDocument()
    expect(container.querySelector('.teacher-dashboard__category-card')).not.toBeInTheDocument()
  })

  it('secretary overview renders analytics only without sidebar-duplicate sections', async () => {
    const { container } = render(
      <SecretaryDashboardPage
        profile={{ ...profile, role: 'secretary' }}
        onLogout={() => undefined}
      />,
    )

    expectOnlyOverviewSection(container)
    expect(await screen.findByText('בקשות פעילות')).toBeInTheDocument()
    expect(screen.queryByTestId('secretary-requests-inbox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-substitute-approvals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secretary-archive')).not.toBeInTheDocument()
  })

  it('manager overview renders analytics only without sidebar-duplicate sections', async () => {
    const { container } = render(
      <ManagerDashboardPage
        profile={{ ...profile, role: 'institution_manager' }}
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

    expectOnlyOverviewSection(container)
    expect(await screen.findByText('סך בקשות המוסד')).toBeInTheDocument()
    expect(screen.queryByTestId('manager-recent-requests')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-archive')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manager-team')).not.toBeInTheDocument()
  })
})

describe('sidebar section navigation', () => {
  it('teacher sidebar opens each section directly in the main area', async () => {
    const user = userEvent.setup()
    const { container } = render(<TeacherDashboardPage profile={profile} onLogout={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'בקשות' }))
    expect(container.querySelector('[data-section-id="requests"]')).toBeTruthy()
    expect(await screen.findByText('פתיחת בקשה חדשה')).toBeInTheDocument()
    expect(container.querySelector('.teacher-dashboard__category-card')).toBeTruthy()
    expect(container.querySelectorAll('[data-section-id]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'התראות' }))
    expect(screen.getByTestId('teacher-notifications')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'לוח מילויי מקום' }))
    expect(screen.getByTestId('teacher-substitute-board')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'הארכיון שלי' }))
    expect(screen.getByTestId('teacher-archive')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'סקירה כללית' }))
    expectOnlyOverviewSection(container)
  }, 15000)

  it('secretary sidebar opens inbox and archive sections on demand', async () => {
    const user = userEvent.setup()
    render(
      <SecretaryDashboardPage
        profile={{ ...profile, role: 'secretary' }}
        onLogout={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'בקשות מורים' }))
    expect(screen.getByTestId('secretary-requests-inbox')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ארכיון מוסדי' }))
    expect(screen.getByTestId('secretary-archive')).toBeInTheDocument()
  })

  it('manager sidebar opens teacher requests and team sections on demand', async () => {
    const user = userEvent.setup()
    render(
      <ManagerDashboardPage
        profile={{ ...profile, role: 'institution_manager' }}
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
    expect(screen.getByTestId('manager-recent-requests')).toBeInTheDocument()
    expect(screen.queryByTestId('manager-recent-activity')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ניהול משתמשים' }))
    expect(screen.getByTestId('manager-team')).toBeInTheDocument()
  })
})

describe('manager analytics archive isolation', () => {
  it('does not filter institution analytics by personal archive', () => {
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/services/dashboardAnalytics.ts'),
      'utf8',
    )

    expect(serviceSource).not.toContain('loadManagerPersonalArchivedRequestIds')
  })
})

describe('dashboard analytics responsive layout', () => {
  it('uses single-column friendly analytics css without horizontal page overflow rules', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/analytics/dashboardAnalytics.css'),
      'utf8',
    )

    expect(css).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(css).not.toContain('overflow-x: auto')
  })

  it('does not keep stacked section spacing for hidden dashboard panels', () => {
    const teacherCss = readFileSync(resolve(process.cwd(), 'src/pages/TeacherDashboardPage.css'), 'utf8')
    expect(teacherCss).not.toContain('shell-section:not(:last-child)')
  })
})

describe('chart accessibility', () => {
  it('renders textual chart summaries alongside bars when analytics has data', async () => {
    const { container } = render(<TeacherDashboardPage profile={profile} onLogout={() => undefined} />)

    const overview = container.querySelector(`[data-section-id="${DASHBOARD_OVERVIEW_SECTION_ID}"]`)
    expect(overview).toBeTruthy()
    expect(await within(overview as HTMLElement).findByText('סך הבקשות שנשלחו')).toBeInTheDocument()
    expect(within(overview as HTMLElement).getAllByText(/סה"כ 2 בקשות/).length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'טווח תאריכים לסקירה' })).toBeInTheDocument()
  })
})
