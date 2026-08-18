import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StaffMemberDetailsModal } from '../components/staff/StaffMemberDetailsModal'
import {
  canEditOperationalUser,
  canEditStaffNationalId,
  canManageDeputies,
  canManageTeamUsers,
} from '../security/institutionCapabilities'
import { canCallerInviteRole } from '../security/tenantInviteRoles'
import { isTeacherInactivityRole } from '../security/teacherInactivityPolicy'
import type { StaffMemberDetails } from '../types/staffDirectory'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const D3C =
  'supabase/migrations/20250818103000_deputy_role_d3c_edit_operational_staff.sql'
const D1 = 'supabase/migrations/20250818100000_deputy_role_d1_foundation.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const STAFF_UPDATE = 'supabase/migrations/20250812160000_secretary_teacher_onboarding_edit.sql'
const PHASE1_RLS = 'supabase/migrations/20250614010000_phase_1a_rls.sql'

const PHASE3_PATHS = [
  'src/services/schoolRegistrationQuotation.ts',
  'supabase/functions/_shared/quotationPdf.ts',
  'school-registration-quotation-pdf',
]

const { loadDetailsMock, updateMemberMock } = vi.hoisted(() => ({
  loadDetailsMock: vi.fn(),
  updateMemberMock: vi.fn(),
}))

vi.mock('../services/staffDirectory', () => ({
  loadStaffMemberDetails: loadDetailsMock,
  updateStaffMember: updateMemberMock,
}))

function memberFor(
  role: StaffMemberDetails['primaryRole'],
  overrides: Partial<StaffMemberDetails> = {},
): StaffMemberDetails {
  return {
    id: `${role}-1`,
    fullName: role === 'secretary' ? 'רותי מזכירה' : 'יעל מורה',
    email: `${role}@school.com`,
    phone: '050-1111111',
    jobTitle: 'תפקיד',
    weeklyHours: 20,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    nationalId: role === 'teacher' ? '123456789' : null,
    primaryRole: role,
    ...overrides,
  }
}

function deputyUpdateSql(sql: string): string {
  const normalized = sql.replace(/\r\n/g, '\n')
  const marker = 'IF v_is_deputy THEN\n        UPDATE public.users'
  const start = normalized.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const fromUpdate = normalized.slice(start)
  const elsePos = fromUpdate.indexOf('ELSE')
  return fromUpdate.slice(0, elsePos)
}

afterEach(() => {
  cleanup()
})

describe('Deputy D3C — edit Teacher and Secretary', () => {
  const d3c = read(D3C)
  const d2 = read(D2)
  const staffUpdate = read(STAFF_UPDATE)
  const phase1Rls = read(PHASE1_RLS)
  const app = read('src/App.tsx')
  const detailsModal = read('src/components/staff/StaffMemberDetailsModal.tsx')
  const editForm = read('src/components/staff/StaffMemberEditForm.tsx')
  const staffService = read('src/services/staffDirectory.ts')
  const updateFn = d3c.slice(d3c.indexOf('CREATE OR REPLACE FUNCTION public.update_staff_member'))
  const deputyUpdate = deputyUpdateSql(d3c)

  it('1-4. shows edit for Teacher and Secretary and hides it for Manager and Deputy', () => {
    expect(canEditOperationalUser('deputy', 'teacher')).toBe(true)
    expect(canEditOperationalUser('deputy', 'secretary')).toBe(true)
    expect(canEditOperationalUser('deputy', 'institution_manager')).toBe(false)
    expect(canEditOperationalUser('deputy', 'deputy')).toBe(false)
    expect(canEditOperationalUser('deputy', 'platform_admin')).toBe(false)
    expect(canEditOperationalUser('deputy')).toBe(false)
  })

  it('lets Deputy open עריכת פרטים for Teacher without national_id or email editing', async () => {
    const user = userEvent.setup({ delay: null })
    loadDetailsMock.mockResolvedValue({
      ok: true,
      member: memberFor('teacher', { nationalId: null }),
    })
    updateMemberMock.mockResolvedValue({ ok: true })

    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="teacher-1"
        canEdit={canEditOperationalUser('deputy', 'teacher')}
        canEditNationalId={canEditStaffNationalId('deputy')}
        institutionName="בית ספר"
        onUpdated={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: 'עריכת פרטים' })).toBeInTheDocument()
    expect(screen.queryByText('תעודת זהות')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'עריכת פרטים' }))
    expect(screen.queryByLabelText('תעודת זהות')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('מייל')).not.toBeInTheDocument()
    expect(screen.getByText('מורה')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('שם מלא'))
    await user.type(screen.getByLabelText('שם מלא'), 'יעל עודכנה')
    await user.click(screen.getByRole('button', { name: 'שמירת שינויים' }))
    expect(updateMemberMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'teacher-1',
        fullName: 'יעל עודכנה',
        nationalId: null,
      }),
    )
  })

  it('lets Deputy open עריכת פרטים for Secretary', async () => {
    loadDetailsMock.mockResolvedValue({
      ok: true,
      member: memberFor('secretary'),
    })
    updateMemberMock.mockResolvedValue({ ok: true })

    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="secretary-1"
        canEdit={canEditOperationalUser('deputy', 'secretary')}
        canEditNationalId={canEditStaffNationalId('deputy')}
        institutionName="בית ספר"
        onUpdated={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: 'עריכת פרטים' })).toBeInTheDocument()
    expect(await screen.findByText('מזכירה')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /השבתה|מחיקה|הסרה/ })).not.toBeInTheDocument()
  })

  it('does not show edit for Manager or Deputy targets', async () => {
    loadDetailsMock.mockResolvedValue({
      ok: true,
      member: memberFor('institution_manager', { fullName: 'נועה מנהלת', nationalId: null }),
    })

    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="institution_manager-1"
        canEdit={canEditOperationalUser('deputy', 'institution_manager')}
        canEditNationalId={false}
        institutionName="בית ספר"
        onUpdated={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('נועה מנהלת')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'עריכת פרטים' })).not.toBeInTheDocument()
    cleanup()

    loadDetailsMock.mockResolvedValue({
      ok: true,
      member: memberFor('deputy', { fullName: 'סגנית אחרת', nationalId: null }),
    })
    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="deputy-1"
        canEdit={canEditOperationalUser('deputy', 'deputy')}
        canEditNationalId={false}
        institutionName="בית ספר"
        onUpdated={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByText('סגנית אחרת')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'עריכת פרטים' })).not.toBeInTheDocument()
  })

  it('5-12. authorizes Deputy teacher/secretary profile updates and denies protected fields', () => {
    expect(updateFn).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')")
    expect(updateFn).toContain('v_caller.status <> \'active\'')
    expect(updateFn).toContain('v_caller.institution_id IS NULL')
    expect(updateFn).toContain("v_target.institution_id IS DISTINCT FROM v_caller.institution_id")
    expect(updateFn).toContain("IF v_target.primary_role NOT IN ('teacher', 'secretary')")
    expect(updateFn).toContain("IF v_target.primary_role <> 'teacher'")
    expect(deputyUpdate).toContain('full_name = v_full_name')
    expect(deputyUpdate).toContain('phone = NULLIF')
    expect(deputyUpdate).toContain('job_title = NULLIF')
    expect(deputyUpdate).toContain('weekly_hours = p_weekly_hours')
    expect(deputyUpdate).not.toContain('national_id')
    expect(deputyUpdate).not.toContain('primary_role')
    expect(deputyUpdate).not.toContain('institution_id')
    expect(deputyUpdate).not.toContain('status')
    expect(deputyUpdate).not.toContain('email')
    expect(d3c).not.toMatch(/GRANT\s+(ALL|UPDATE|INSERT|DELETE)\s+ON\s+(TABLE\s+)?public\.users/i)
    expect(d3c).not.toContain('CREATE POLICY')
    expect(phase1Rls).toContain('FOR SELECT')
    expect(phase1Rls).not.toContain('FOR UPDATE')
    expect(phase1Rls).not.toContain('FOR INSERT')
    expect(phase1Rls).not.toContain('FOR DELETE')
  })

  it('17. ignores Deputy national_id writes and keeps Manager/Secretary national_id teacher-edit', () => {
    expect(d3c).toContain('ELSE NULL')
    expect(d3c).toContain('THEN v_target.national_id::TEXT')
    expect(d3c).toContain('national_id = NULLIF(btrim(COALESCE(p_national_id, \'\')), \'\')')
    expect(canEditStaffNationalId('deputy')).toBe(false)
    expect(canEditStaffNationalId('institution_manager')).toBe(true)
    expect(canEditStaffNationalId('secretary')).toBe(true)
    expect(editForm).toContain('canEditNationalId')
    expect(detailsModal).toContain('canEditNationalId && member.nationalId !== null')
    expect(d3c).toContain('DROP FUNCTION IF EXISTS public.get_staff_member_details(UUID)')
  })

  it('18. keeps email read-only and never updates Auth identity', () => {
    expect(editForm).toContain('formatStaffEmail(member.email)')
    expect(editForm).not.toContain('staff-edit-email')
    expect(staffService).toContain("supabase.rpc('update_staff_member'")
    expect(staffService).not.toContain('auth.admin')
    expect(staffService).not.toContain('updateUserById')
    expect(d3c).not.toContain('auth.users')
    expect(updateFn).not.toContain('email =')
  })

  it('13-16. does not broaden Secretary, Manager, Teacher, or Platform Admin', () => {
    expect(canEditOperationalUser('secretary', 'teacher')).toBe(true)
    expect(canEditOperationalUser('secretary', 'secretary')).toBe(false)
    expect(canEditOperationalUser('institution_manager', 'teacher')).toBe(true)
    expect(canEditOperationalUser('institution_manager', 'secretary')).toBe(false)
    expect(canEditOperationalUser('teacher', 'teacher')).toBe(false)
    expect(canEditOperationalUser('teacher', 'secretary')).toBe(false)
    expect(canEditOperationalUser('platform_admin', 'teacher')).toBe(false)
    expect(canEditOperationalUser('platform_admin', 'secretary')).toBe(false)
    expect(updateFn).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')")
    expect(staffUpdate).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(d3c).not.toContain('CREATE OR REPLACE FUNCTION public.manager_set_user_extended_profile')
  })

  it('lists Teacher+Secretary for Deputy only and keeps Manager/Secretary directory teacher-only', () => {
    expect(d3c).toContain("v_caller.primary_role = 'deputy'")
    expect(d3c).toContain("t.primary_role IN ('teacher', 'secretary')")
    expect(d3c).toContain("v_caller.primary_role IN ('institution_manager', 'secretary')")
    expect(d3c).toContain("AND t.primary_role = 'teacher'")
    expect(d3c).toContain('DROP FUNCTION IF EXISTS public.get_staff_directory()')
    expect(d3c).not.toContain("t.primary_role IN ('teacher', 'secretary', 'institution_manager'")
  })

  it('20-23. keeps D3B create, D2 calendar, inactivity/PWA, and does not touch Phase 3', () => {
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(true)
    expect(canCallerInviteRole('deputy', 'secretary')).toBe(true)
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(canManageDeputies('deputy')).toBe(false)
    expect(isTeacherInactivityRole('deputy')).toBe(false)
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(app).toContain('isTeacherInactivityRole(currentProfile?.role)')
    expect(d2).toContain('meeting_calendar_validate_role_pair')
    expect(read(D1)).toContain("ADD VALUE IF NOT EXISTS 'deputy'")
    expect(existsSync(resolve(root, D3C))).toBe(true)
    expect(d3c).not.toContain('handled_by')
    expect(app).not.toContain('handled_by')
    expect(d3c).not.toContain('school_registration_quotation')
    expect(d3c).not.toContain('quotationPdf')
    for (const path of PHASE3_PATHS) {
      expect(d3c).not.toContain(path)
    }
  })
})
