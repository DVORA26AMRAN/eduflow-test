import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateUserForm } from '../components/manager/CreateUserForm'
import { TeamManagementSection } from '../components/manager/TeamManagementSection'
import { ManagerDashboardPage } from '../pages/ManagerDashboardPage'
import {
  canCreateOperationalUser,
  canEditOperationalUser,
  canManageDeputies,
  canManageTeamUsers,
  canViewTeamManagement,
} from '../security/institutionCapabilities'
import {
  canCallerInviteRole,
  DEPUTY_TENANT_INVITE_ROLES,
  getAllowedTenantInviteRoles,
  MANAGER_TENANT_INVITE_ROLES,
  SECRETARY_TENANT_INVITE_ROLES,
} from '../security/tenantInviteRoles'
import { isTeacherInactivityRole } from '../security/teacherInactivityPolicy'
import type { AuthenticatedUserProfile } from '../types/user'
import { validateCreateUserForm } from './createUserForm'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const EDGE = 'supabase/functions/clever-processor/index.ts'
const APP = 'src/App.tsx'
const MANAGER_PAGE = 'src/pages/ManagerDashboardPage.tsx'
const INSTITUTION_USERS = 'src/services/institutionUsers.ts'
const STAFF_UPDATE = 'supabase/migrations/20250812160000_secretary_teacher_onboarding_edit.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const D3B_MIGRATION = 'supabase/migrations/20250818103000_deputy_role_d3b_create_users.sql'

const PHASE3_PATHS = [
  'src/services/schoolRegistrationQuotation.ts',
  'src/utils/schoolRegistrationQuotation.ts',
  'supabase/functions/_shared/quotationPdf.ts',
  'supabase/functions/school-registration-quotation-pdf/index.ts',
]

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

vi.mock('../components/manager/ManagerRecentRequestsSection', () => ({
  ManagerRecentRequestsSection: () => (
    <section aria-label="בקשות מורים">
      <h2>בקשות מורים</h2>
    </section>
  ),
}))

vi.mock('../components/meetingCalendar/MeetingCalendarSection', () => ({
  MeetingCalendarSection: () => <div>יומן פגישות</div>,
}))

vi.mock('../pages/StaffDirectoryPage', () => ({
  StaffDirectoryPage: ({ canEdit }: { canEdit: boolean }) => (
    <div data-testid="staff-directory" data-can-edit={String(canEdit)}>
      סגל
    </div>
  ),
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

vi.mock('../components/manager/ManagerAnalyticsSection', () => ({
  ManagerAnalyticsSection: () => <div>סקירה</div>,
}))

afterEach(() => {
  cleanup()
})

const dashboardProps = {
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

function profileFor(role: 'institution_manager' | 'deputy'): AuthenticatedUserProfile {
  return {
    id: `${role}-1`,
    fullName: role === 'deputy' ? 'סגנית' : 'מנהלת',
    role,
    school: {
      id: 'school-1',
      name: 'בית ספר',
      timeZone: 'Asia/Jerusalem',
      logoUrl: null,
      logoUpdatedAt: null,
    },
  }
}

const createFormProps = {
  newUserName: '',
  newUserEmail: '',
  newUserRole: 'teacher' as const,
  newUserPhone: '',
  newUserNationalId: '',
  newUserJobTitle: '',
  newUserWeeklyHours: '',
  message: '',
  onNewUserNameChange: vi.fn(),
  onNewUserEmailChange: vi.fn(),
  onNewUserRoleChange: vi.fn(),
  onNewUserPhoneChange: vi.fn(),
  onNewUserNationalIdChange: vi.fn(),
  onNewUserJobTitleChange: vi.fn(),
  onNewUserWeeklyHoursChange: vi.fn(),
  onCreateUser: vi.fn(),
}

function tenantInviteBranch(edge: string): string {
  const start = edge.indexOf('Tenant invites')
  expect(start).toBeGreaterThanOrEqual(0)
  return edge.slice(start)
}

describe('Deputy D3B — create Teacher and Secretary', () => {
  const edge = read(EDGE)
  const tenant = tenantInviteBranch(edge)
  const app = read(APP)
  const managerPage = read(MANAGER_PAGE)
  const institutionUsers = read(INSTITUTION_USERS)
  const staffUpdate = read(STAFF_UPDATE)
  const d2 = read(D2)
  const detailsModal = read('src/components/staff/StaffMemberDetailsModal.tsx')
  const teamSection = read('src/components/manager/TeamManagementSection.tsx')

  it('shows Team Management and Add User for Deputy without a separate page', () => {
    expect(canViewTeamManagement('deputy')).toBe(true)
    expect(canViewTeamManagement('institution_manager')).toBe(true)
    expect(managerPage).toContain('canViewTeamManagement(profile.role)')
    expect(managerPage).toContain('TeamManagementSection')
    expect(managerPage).not.toContain('DeputyTeamManagement')

    render(<ManagerDashboardPage profile={profileFor('deputy')} {...dashboardProps} />)
    expect(screen.getByRole('button', { name: 'ניהול משתמשים' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ניהול משתמשים' }))
    expect(screen.getByText('יצירת משתמש חדש')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמירת משתמש' })).toBeInTheDocument()
  })

  it('shows Deputy role choices Teacher + Secretary only', () => {
    expect(getAllowedTenantInviteRoles('deputy')).toEqual(['teacher', 'secretary'])
    expect(DEPUTY_TENANT_INVITE_ROLES).toEqual(['teacher', 'secretary'])
    expect(DEPUTY_TENANT_INVITE_ROLES).not.toContain('deputy')

    render(
      <CreateUserForm {...createFormProps} allowedRoles={getAllowedTenantInviteRoles('deputy')} />,
    )
    expect(screen.getByRole('option', { name: 'מורה' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מזכירה' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'סגנית' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'מנהלת' })).not.toBeInTheDocument()
  })

  it('keeps Manager Teacher + Secretary + Deputy and Secretary teacher-only', () => {
    expect(getAllowedTenantInviteRoles('institution_manager')).toEqual([
      'teacher',
      'secretary',
      'deputy',
    ])
    expect(MANAGER_TENANT_INVITE_ROLES).toEqual(['teacher', 'secretary', 'deputy'])
    expect(getAllowedTenantInviteRoles('secretary')).toEqual(['teacher'])
    expect(SECRETARY_TENANT_INVITE_ROLES).toEqual(['teacher'])
  })

  it('allows Deputy → Teacher and Deputy → Secretary and denies every other target', () => {
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(true)
    expect(canCallerInviteRole('deputy', 'secretary')).toBe(true)
    expect(canCallerInviteRole('deputy', 'deputy')).toBe(false)
    expect(canCreateOperationalUser('deputy')).toBe(true)

    expect(
      validateCreateUserForm(
        {
          fullName: 'יעל',
          email: 'yael@school.com',
          role: 'teacher',
          phone: '',
          nationalId: '',
          jobTitle: '',
          weeklyHours: '',
        },
        { allowedRoles: DEPUTY_TENANT_INVITE_ROLES },
      ).ok,
    ).toBe(true)
    expect(
      validateCreateUserForm(
        {
          fullName: 'רותי',
          email: 'ruth@school.com',
          role: 'secretary',
          phone: '',
          nationalId: '',
          jobTitle: '',
          weeklyHours: '',
        },
        { allowedRoles: DEPUTY_TENANT_INVITE_ROLES },
      ).ok,
    ).toBe(true)
    expect(
      validateCreateUserForm(
        {
          fullName: 'סגנית',
          email: 'deputy2@school.com',
          role: 'deputy',
          phone: '',
          nationalId: '',
          jobTitle: '',
          weeklyHours: '',
        },
        { allowedRoles: DEPUTY_TENANT_INVITE_ROLES },
      ).ok,
    ).toBe(false)

    expect(edge).toContain("if (callerRole === 'deputy')")
    expect(edge).toContain('requestedRole === \'teacher\' || requestedRole === \'secretary\'')
    expect(app).toContain('canCallerInviteRole(currentProfile.role, requestedRole)')
  })

  it('denies Teacher invites and Deputy → Manager / Platform Admin', () => {
    expect(getAllowedTenantInviteRoles('teacher')).toEqual([])
    expect(canCallerInviteRole('teacher', 'teacher')).toBe(false)
    expect(canCreateOperationalUser('teacher')).toBe(false)
    expect(app).toContain('allowedRoles.length === 0')
    expect(edge).toContain("requestedRoleRaw === 'institution_manager'")
    expect(edge).toContain("requestedRoleRaw === 'platform_admin'")
    expect(edge).toContain('isActiveGlobalPlatformAdmin')
    expect(edge).not.toContain("value === 'platform_admin'")
    expect(edge).not.toContain("value === 'institution_manager' ? value")
  })

  it('derives institution_id from the caller and rejects body institution_id', () => {
    expect(tenant).toContain('institution_id: callerRow.institution_id')
    expect(tenant).toContain("body.institution_id !== undefined && body.institution_id !== null")
    expect(app).not.toContain('institution_id:')
    expect(app).toContain('functions/v1/clever-processor')
  })

  it('rejects existing emails instead of silently re-roling', () => {
    expect(tenant).toContain("error: 'conflict'")
    expect(tenant).toContain('email already belongs to an existing user')
    expect(tenant).not.toMatch(/from\('users'\)\.update/)
    expect(edge).not.toMatch(/from\('users'\)\s*\.update/)
  })

  it('does not grant Deputy disable/delete or Deputy/Manager administration in D3B', () => {
    expect(canEditOperationalUser('deputy')).toBe(false)
    expect(canEditOperationalUser('institution_manager')).toBe(true)
    expect(canManageDeputies('deputy')).toBe(false)
    expect(canManageDeputies('institution_manager')).toBe(true)
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(managerPage).toContain("canEditOperationalUser(profile.role, 'teacher')")

    render(<ManagerDashboardPage profile={profileFor('deputy')} {...dashboardProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'פרטי צוות' }))
    expect(screen.getByTestId('staff-directory')).toHaveAttribute('data-can-edit', 'true')
    cleanup()
    render(<ManagerDashboardPage profile={profileFor('institution_manager')} {...dashboardProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'פרטי צוות' }))
    expect(screen.getByTestId('staff-directory')).toHaveAttribute('data-can-edit', 'true')

    expect(staffUpdate).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(staffUpdate).toContain("v_actor.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(teamSection).not.toMatch(/השבתה|מחיקה|הסרה|deactivat|deleteUser/i)
    expect(detailsModal).not.toMatch(/השבתה|מחיקה|הסרה|deactivat|removeTeacher/i)
  })

  it('does not expose national_id on the Team Management list path', () => {
    expect(institutionUsers).toContain(".select('full_name, email, primary_role')")
    expect(institutionUsers).not.toContain('national_id')
    expect(teamSection).not.toContain('national_id')
    expect(teamSection).not.toContain('תעודת זהות')
    expect(d2).toContain("WHEN v_caller.primary_role IN (")
    expect(d2).toContain("'deputy'::public.user_role")
    expect(d2).toContain('ELSE NULL')
  })

  it('keeps Manager and Secretary create behavior and D2 operational dashboard', () => {
    expect(canCallerInviteRole('institution_manager', 'deputy')).toBe(true)
    expect(canCallerInviteRole('secretary', 'teacher')).toBe(true)
    expect(canCallerInviteRole('secretary', 'secretary')).toBe(false)
    expect(managerPage).toContain('canManageCalendar(profile.role)')
    expect(managerPage).toContain('canManageRequests(profile.role)')
    expect(isTeacherInactivityRole('deputy')).toBe(false)
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(app).toContain('isTeacherInactivityRole(currentProfile?.role)')
  })

  it('does not add a D3B migration or touch Phase 3 / D3C', () => {
    expect(existsSync(resolve(root, D3B_MIGRATION))).toBe(false)
    expect(edge).not.toContain('handled_by')
    expect(app).not.toContain('handled_by')
    expect(app).not.toContain('schoolRegistrationQuotation')
    for (const path of PHASE3_PATHS) {
      expect(edge).not.toContain(path)
      expect(managerPage).not.toContain(path)
    }
  })

  it('reuses TeamManagementSection create form without delete controls', () => {
    render(
      <TeamManagementSection
        users={[]}
        isLoading={false}
        errorMessage=""
        newUserName=""
        newUserEmail=""
        newUserRole="teacher"
        newUserPhone=""
        newUserNationalId=""
        newUserJobTitle=""
        newUserWeeklyHours=""
        createUserMessage=""
        allowedRoles={DEPUTY_TENANT_INVITE_ROLES}
        onNewUserNameChange={() => undefined}
        onNewUserEmailChange={() => undefined}
        onNewUserRoleChange={() => undefined}
        onNewUserPhoneChange={() => undefined}
        onNewUserNationalIdChange={() => undefined}
        onNewUserJobTitleChange={() => undefined}
        onNewUserWeeklyHoursChange={() => undefined}
        onCreateUser={() => undefined}
      />,
    )

    expect(screen.getByText('יצירת משתמש חדש')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמירת משתמש' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /מחיקה|השבתה|עריכה/ })).not.toBeInTheDocument()
  })
})
