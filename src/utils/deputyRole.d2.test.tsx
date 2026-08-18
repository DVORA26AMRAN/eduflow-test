import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerDashboardPage } from '../pages/ManagerDashboardPage'
import { isTeacherInactivityRole } from '../security/teacherInactivityPolicy'
import {
  canManageInstitutionSettings,
  canManageTeamUsers,
  canManageRequests,
} from '../security/institutionCapabilities'
import {
  isAllowedMeetingRolePair,
  resolveCalendarOwnerRole,
  resolveCalendarOwnerUserId,
} from './meetingCalendar'
import { canStartGoogleOAuth } from './googleOAuthCrypto'
import { canReadPrintingRequest } from '../domain/printing/lifecycle'
import { isGeneralRequestRecipientRole } from './generalRequestDisplay'
import type { AuthenticatedUserProfile } from '../types/user'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const D2_MIGRATION =
  'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const D1_OPERATOR =
  'supabase/migrations/20250818101000_deputy_role_d1_operator_helper.sql'
const MANAGER_HELPER =
  'supabase/migrations/20250702223000_requests_manager_select_policy.sql'
const PRINTING_SETTINGS =
  'supabase/migrations/20250804120100_printing_requests_phase1_commands.sql'
const RECIPIENT_ROUTING =
  'supabase/migrations/20250712160000_general_request_recipient_routing.sql'
const CLEVER_PROCESSOR = 'supabase/functions/clever-processor/index.ts'
const STAFF_UPDATE = 'supabase/migrations/20250812160000_secretary_teacher_onboarding_edit.sql'

const PHASE3_PATHS = [
  'src/services/schoolRegistrationQuotation.ts',
  'src/utils/schoolRegistrationQuotation.ts',
  'src/types/schoolRegistrationQuotation.ts',
  'supabase/functions/_shared/quotationPdf.ts',
  'supabase/functions/school-registration-quotation-pdf/index.ts',
  'supabase/functions/school-registration-quotation-send/index.ts',
  'src/components/platform/quotation/QuotationBuilderWorkspace.tsx',
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

vi.mock('../pages/StaffDirectoryPage', () => ({
  StaffDirectoryPage: () => <div data-testid="staff-directory">סגל</div>,
}))

vi.mock('../components/secretary/printing/SecretaryPrintingWorkspace', () => ({
  SecretaryPrintingWorkspace: () => <div data-testid="printing-workspace">הדפסות</div>,
}))

vi.mock('../components/settings/UserSettingsSection', () => ({
  UserSettingsSection: () => <div data-testid="user-settings">הגדרות</div>,
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

describe('Deputy D2 operational dashboard', () => {
  const d2 = read(D2_MIGRATION)
  const d1Operator = read(D1_OPERATOR)
  const managerHelper = read(MANAGER_HELPER)
  const app = read('src/App.tsx')
  const managerPage = read('src/pages/ManagerDashboardPage.tsx')
  const printingSettings = read(PRINTING_SETTINGS)
  const recipientRouting = read(RECIPIENT_ROUTING)
  const clever = read(CLEVER_PROCESSOR)
  const staffUpdate = read(STAFF_UPDATE)
  const requestTypes = read('src/types/request.ts')
  const capabilities = read('src/security/institutionCapabilities.ts')

  it('routes Deputy and Manager to the same ManagerDashboardPage without role fallthrough', () => {
    expect(app).toContain("currentProfile.role === 'institution_manager'")
    expect(app).toContain("currentProfile.role === 'deputy'")
    expect(app).not.toContain("role === 'institution_manager' ||")
    expect(app).not.toContain('DeputyDashboardPlaceholderPage')

    const managerBranch = app.slice(app.indexOf("currentProfile.role === 'institution_manager'"))
    const managerReturn = managerBranch.slice(
      0,
      managerBranch.indexOf("currentProfile.role === 'deputy'"),
    )
    expect(managerReturn).toContain('ManagerDashboardPage')

    const deputyBranch = app.slice(app.indexOf("currentProfile.role === 'deputy'"))
    const deputyReturn = deputyBranch.slice(
      0,
      deputyBranch.indexOf("currentProfile.role === 'secretary'"),
    )
    expect(deputyReturn).toContain('ManagerDashboardPage')
    expect(deputyReturn).not.toContain('DeputyDashboard')
  })

  it('does not duplicate a Deputy-specific dashboard page implementation', () => {
    expect(managerPage).toContain('export function ManagerDashboardPage')
    expect(app).not.toContain('DeputyDashboardPage')
    expect(app.match(/<ManagerDashboardPage/g)?.length).toBe(2)
    expect(read('src/components/dashboard/DashboardShell.css')).toContain(
      '.dashboard-shell--deputy',
    )
  })

  it('keeps Manager team management visible and hides it for Deputy', () => {
    render(<ManagerDashboardPage profile={profileFor('institution_manager')} {...dashboardProps} />)
    expect(screen.getByRole('button', { name: 'ניהול משתמשים' })).toBeInTheDocument()
    cleanup()

    render(<ManagerDashboardPage profile={profileFor('deputy')} {...dashboardProps} />)
    expect(screen.queryByRole('button', { name: 'ניהול משתמשים' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בקשות מורים' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הארכיון שלי' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'יומן פגישות' })).toBeInTheDocument()
  })

  it('uses explicit capability helpers rather than a permissions database', () => {
    expect(capabilities).toContain('export function canManageRequests')
    expect(capabilities).toContain('export function canManageCalendar')
    expect(capabilities).toContain('export function canUseOperationalPrinting')
    expect(capabilities).toContain('export function canViewInstitutionArchive')
    expect(capabilities).toContain('export function canManageInstitutionSettings')
    expect(capabilities).not.toContain('user_capabilities')
    expect(d2).not.toContain('user_capabilities')
    expect(canManageRequests('deputy')).toBe(true)
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(canManageInstitutionSettings('deputy')).toBe(false)
    expect(canManageTeamUsers('institution_manager')).toBe(true)
  })

  it('migrates operational Manager request/archive reads to the operator helper', () => {
    expect(d2).toContain('auth_user_is_active_institution_operator_for_institution')
    expect(d2).toContain('requests_manager_select_institution')
    expect(d2).toContain('manager_archived_requests_insert_own_institution')
    expect(d2).toContain('request_status_history_operator_select_institution')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution')
    expect(managerHelper).toContain("u.primary_role = 'institution_manager'")
    expect(d1Operator).toContain("'deputy'::public.user_role")
  })

  it('authorizes Deputy calendar pairs like Manager and keeps owner isolation', () => {
    expect(isAllowedMeetingRolePair('deputy', 'teacher')).toBe(true)
    expect(isAllowedMeetingRolePair('teacher', 'deputy')).toBe(true)
    expect(isAllowedMeetingRolePair('deputy', 'secretary')).toBe(true)
    expect(isAllowedMeetingRolePair('deputy', 'institution_manager')).toBe(false)
    expect(isAllowedMeetingRolePair('deputy', 'deputy')).toBe(false)
    expect(isAllowedMeetingRolePair('teacher', 'institution_manager')).toBe(true)

    expect(resolveCalendarOwnerRole('deputy', 'teacher')).toBe('deputy')
    expect(resolveCalendarOwnerRole('deputy', 'secretary')).toBe('deputy')
    expect(resolveCalendarOwnerRole('teacher', 'deputy')).toBe('deputy')
    expect(resolveCalendarOwnerRole('secretary', 'deputy')).toBe('deputy')
    expect(resolveCalendarOwnerRole('institution_manager', 'teacher')).toBe('institution_manager')
    expect(resolveCalendarOwnerRole('secretary', 'teacher')).toBe('secretary')

    expect(
      resolveCalendarOwnerUserId({
        requesterId: 'deputy-1',
        recipientId: 'teacher-1',
        requesterRole: 'deputy',
        recipientRole: 'teacher',
      }),
    ).toBe('deputy-1')

    expect(d2).toContain("p_requester_role = 'deputy'")
    expect(d2).toContain("p_recipient_role IN ('teacher', 'secretary')")
  })

  it('allows Deputy personal Google integration and keeps Teacher denied', () => {
    expect(
      canStartGoogleOAuth({
        role: 'deputy',
        status: 'active',
        institutionId: 'inst-1',
      }),
    ).toBe(true)
    expect(
      canStartGoogleOAuth({
        role: 'teacher',
        status: 'active',
        institutionId: 'inst-1',
      }),
    ).toBe(false)
    expect(d2).toContain("v_role NOT IN ('institution_manager', 'secretary', 'deputy')")
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.printing_update_institution_settings')
  })

  it('allows Deputy operational printing reads and denies cross-institution access', () => {
    expect(
      canReadPrintingRequest({
        actorRole: 'deputy',
        actorUserId: 'deputy-1',
        actorInstitutionId: 'inst-1',
        teacherUserId: 'teacher-1',
        requestInstitutionId: 'inst-1',
      }),
    ).toBe(true)
    expect(
      canReadPrintingRequest({
        actorRole: 'deputy',
        actorUserId: 'deputy-1',
        actorInstitutionId: 'inst-1',
        teacherUserId: 'teacher-1',
        requestInstitutionId: 'inst-2',
      }),
    ).toBe(false)
    expect(d2).toContain('printing_requests_staff_select_institution')
    expect(d2).toContain('printing_claim_request')
    expect(printingSettings).toContain('CREATE OR REPLACE FUNCTION public.printing_update_institution_settings')
    expect(printingSettings).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(printingSettings).toContain('auth_user_is_active_secretary_for_institution')
  })

  it('keeps institution printing/settings RPCs Manager or Secretary only', () => {
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.printing_update_institution_settings')
    expect(canManageInstitutionSettings('deputy')).toBe(false)
    expect(canManageInstitutionSettings('institution_manager')).toBe(true)
    expect(managerPage).toContain('canManageTeamUsers(profile.role)')
    expect(app).toContain("currentProfile.role !== 'institution_manager'")
    expect(app).toContain("currentProfile.role !== 'secretary'")
  })

  it('does not add Deputy to GeneralRequestRecipientRole', () => {
    expect(requestTypes).toContain("export type GeneralRequestRecipientRole = 'secretary' | 'institution_manager'")
    expect(isGeneralRequestRecipientRole('deputy')).toBe(false)
    expect(isGeneralRequestRecipientRole('institution_manager')).toBe(true)
    expect(recipientRouting).toContain("recipient_role IN ('secretary', 'institution_manager')")
    expect(d2).not.toContain("OR recipient_role = 'deputy'")
    expect(d2).not.toContain('DROP CONSTRAINT IF EXISTS requests_recipient_role_valid')
    expect(d2).not.toContain("ADD CONSTRAINT requests_recipient_role_valid")
  })

  it('does not grant Deputy D3 user-management privileges', () => {
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(clever).toContain(
      "caller.primary_role === 'institution_manager' || caller.primary_role === 'secretary'",
    )
    expect(clever).toContain("if (callerRow.primary_role === 'deputy')")
    expect(staffUpdate).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.manager_set_user_extended_profile')
  })

  it('preserves Teacher inactivity, Platform Admin isolation, and Phase 3 quotation files', () => {
    expect(isTeacherInactivityRole('deputy')).toBe(false)
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(app).toContain('isTeacherInactivityRole(currentProfile?.role)')
    expect(d2).not.toContain('platform_admin_')
    expect(d2).not.toContain('school_registration_quotation')
    expect(d2).not.toContain('quotationPdf')

    for (const path of PHASE3_PATHS) {
      expect(d2).not.toContain(path)
    }
  })

  it('does not broaden Secretary or Teacher SQL helpers', () => {
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.auth_user_is_active_secretary_for_institution')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.auth_user_is_active_teacher')
    expect(d2).toContain('auth_user_is_active_secretary_for_institution')
  })
})

describe('Deputy D2 security correction — operator status RPC and national_id', () => {
  const d2 = read(D2_MIGRATION)
  const requestsService = read('src/services/requests.ts')
  const secretaryInbox = read('src/components/secretary/SecretaryRequestsInbox.tsx')
  const managerRequests = read('src/components/manager/ManagerRecentRequestsSection.tsx')
  const usersRls = read('supabase/migrations/20250614010000_phase_1a_rls.sql')
  const secretaryUpdate = read('supabase/migrations/20250703152000_add_request_archive_fields.sql')
  const statusHistory = read('supabase/migrations/20250702203000_auto_write_request_status_history.sql')
  const statusOptions = read('src/utils/requests.ts')
  const rpcMatch = d2.match(
    /CREATE OR REPLACE FUNCTION public\.update_request_status\([\s\S]*?COMMENT ON FUNCTION public\.update_request_status/,
  )
  const staffDetailsMatch = d2.match(
    /CREATE OR REPLACE FUNCTION public\.get_staff_member_details\(p_user_id UUID\)[\s\S]*?COMMENT ON FUNCTION public\.get_staff_member_details/,
  )

  it('A/B. authorizes Manager and Deputy through the operator helper', () => {
    expect(rpcMatch?.[0]).toContain('auth_user_is_active_institution_operator_for_institution')
    expect(read(D1_OPERATOR)).toContain("'institution_manager'::public.user_role")
    expect(read(D1_OPERATOR)).toContain("'deputy'::public.user_role")
  })

  it('C/D/E/F. fail-closes Teacher, Platform Admin, Secretary, and cross-institution callers', () => {
    expect(rpcMatch?.[0]).toContain('auth_user_is_active_institution_operator_for_institution')
    expect(read(D1_OPERATOR)).toContain('Not Platform Admin, Secretary, or Teacher')
    expect(read(D1_OPERATOR)).toContain('u.institution_id = p_institution_id')
    expect(rpcMatch?.[0]).not.toContain('auth_user_is_active_secretary_for_institution')
    expect(rpcMatch?.[0]).not.toContain('auth_user_is_active_teacher')
    expect(rpcMatch?.[0]).not.toContain('auth_user_is_active_platform_admin')
  })

  it('G. preserves general_request manager-recipient routing', () => {
    expect(rpcMatch?.[0]).toContain("v_request.request_type = 'general_request'")
    expect(rpcMatch?.[0]).toContain(
      "v_request.recipient_role IS DISTINCT FROM 'institution_manager'",
    )
  })

  it('H/I. accepts only request id + status and updates only status', () => {
    expect(d2).toMatch(
      /CREATE OR REPLACE FUNCTION public\.update_request_status\(\s*p_request_id UUID,\s*p_status TEXT\s*\)/,
    )
    expect(rpcMatch?.[0]).toMatch(/UPDATE public\.requests\s+SET status = v_status/)
    expect(rpcMatch?.[0]).not.toContain('request_payload')
    expect(rpcMatch?.[0]).not.toContain('description')
    expect(rpcMatch?.[0]).not.toContain('institution_id =')
    expect(rpcMatch?.[0]).not.toContain('created_by_user_id')
    expect(rpcMatch?.[0]).not.toContain('recipient_role =')
    expect(rpcMatch?.[0]).not.toMatch(/SET[\s\S]*archived_at/)
  })

  it('J. leaves the existing status-history trigger in place', () => {
    expect(statusHistory).toContain('CREATE TRIGGER requests_write_status_history')
    expect(statusHistory).toContain('AFTER UPDATE OF status ON public.requests')
    expect(d2).not.toContain('DROP TRIGGER IF EXISTS requests_write_status_history')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.write_request_status_history')
    expect(rpcMatch?.[0]).toContain('SET status = v_status')
  })

  it('K. keeps the Secretary table UPDATE path unchanged', () => {
    expect(secretaryUpdate).toContain('CREATE POLICY requests_secretary_archive_institution')
    expect(d2).not.toContain('DROP POLICY IF EXISTS requests_secretary_archive_institution')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.enforce_requests_secretary_update_columns')
    expect(secretaryInbox).toContain('updateRequestStatus')
    expect(requestsService).toContain("if (callerRole === 'secretary')")
    expect(requestsService).toContain(".from('requests').update({ status })")
  })

  it('L/M. does not add a broad operator UPDATE policy or denylist trigger', () => {
    expect(d2).not.toContain('CREATE POLICY requests_operator_update_status_institution')
    expect(d2).not.toContain('GRANT UPDATE (status) ON public.requests')
    expect(d2).not.toContain('CREATE OR REPLACE FUNCTION public.enforce_requests_operator_update_columns')
    expect(d2).not.toContain('CREATE TRIGGER requests_enforce_operator_update_columns')
    expect(d2).toContain('DROP POLICY IF EXISTS requests_operator_update_status_institution')
    expect(d2).toContain('DROP FUNCTION IF EXISTS public.enforce_requests_operator_update_columns()')
  })

  it('N/O/P. redacts national_id for Deputy and keeps Manager/Secretary values', () => {
    expect(staffDetailsMatch?.[0]).toContain("'institution_manager', 'secretary', 'deputy'")
    expect(staffDetailsMatch?.[0]).toContain("'institution_manager'::public.user_role")
    expect(staffDetailsMatch?.[0]).toContain("'secretary'::public.user_role")
    expect(staffDetailsMatch?.[0]).toContain('THEN v_target.national_id::TEXT')
    expect(staffDetailsMatch?.[0]).toContain('ELSE NULL')
    expect(staffDetailsMatch?.[0]).not.toMatch(
      /RETURN QUERY[\s\S]*v_target\.national_id::TEXT;/,
    )
  })

  it('Q. does not alter pre-existing users-table RLS', () => {
    expect(usersRls).toContain('users_read_same_institution')
    expect(d2).not.toContain('CREATE POLICY "users_read_same_institution"')
    expect(d2).not.toContain('CREATE POLICY users_read_same_institution')
    expect(d2).not.toContain('DROP POLICY IF EXISTS "users_read_same_institution"')
    expect(d2).not.toContain('ALTER TABLE public.users')
    expect(d2).not.toContain('GRANT SELECT ON public.users')
    expect(d2).toContain('users_read_same_institution / other users-table RLS (pre-existing PII debt)')
  })

  it('routes Manager/Deputy frontend status writes through the RPC and keeps Secretary on table UPDATE', () => {
    expect(managerRequests).toContain('updateRequestStatus')
    expect(requestsService).toContain("rpc('update_request_status'")
    expect(requestsService).toContain('isInstitutionOperatorRole(callerRole)')
    expect(requestsService).toContain('p_request_id: requestId')
    expect(requestsService).toContain('p_status: status')
    expect(statusOptions).toContain("value: 'new'")
    expect(statusOptions).toContain("value: 'in_progress'")
    expect(statusOptions).toContain("value: 'completed'")
    expect(statusOptions).toContain("value: 'rejected'")
  })
})
