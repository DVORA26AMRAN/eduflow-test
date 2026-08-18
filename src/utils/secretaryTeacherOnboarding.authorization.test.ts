import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250812160000_secretary_teacher_onboarding_edit.sql',
)

const edgeFunctionPath = resolve(
  process.cwd(),
  'supabase/functions/clever-processor/index.ts',
)

describe('secretary teacher onboarding/edit authorization', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const edge = readFileSync(edgeFunctionPath, 'utf8')

  it('lets active secretary update teacher profiles in the same institution only', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(sql).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(sql).toContain("v_target.primary_role <> 'teacher'")
    expect(sql).toContain('v_target.institution_id IS DISTINCT FROM v_caller.institution_id')
  })

  it('lets active secretary set teacher extended profile fields after invite', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.manager_set_user_extended_profile')
    expect(sql).toContain("v_actor.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(sql).toContain("v_target.primary_role <> 'teacher'")
    expect(sql).toContain('institution_id = v_actor.institution_id')
  })

  it('returns national_id to secretary for edit parity without broadening role targets', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_staff_member_details')
    expect(sql).toContain("v_caller.primary_role NOT IN ('institution_manager', 'secretary')")
    expect(sql).toContain("v_target.primary_role <> 'teacher'")
    expect(sql).toContain('v_target.national_id::TEXT')
  })

  it('does not add teacher deactivation or removal RPCs', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.\w*deactivat/i)
    expect(sql).not.toMatch(/delete_staff/i)
    expect(sql).not.toMatch(/remove_teacher/i)
  })

  it('secretary UI reuses manager create/edit paths without destructive controls', () => {
    const secretaryPage = readFileSync(
      resolve(process.cwd(), 'src/pages/SecretaryDashboardPage.tsx'),
      'utf8',
    )
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const detailsModal = readFileSync(
      resolve(process.cwd(), 'src/components/staff/StaffMemberDetailsModal.tsx'),
      'utf8',
    )

    expect(secretaryPage).toContain('canEdit')
    expect(secretaryPage).toContain("allowedRoles: ['teacher']")
    expect(secretaryPage).toContain('teacherOnboarding')
    expect(secretaryPage).toContain('StaffDirectoryPage')
    expect(appSource).toContain("currentProfile.role === 'secretary'")
    expect(appSource).toContain('getAllowedTenantInviteRoles')
    expect(detailsModal).not.toMatch(/השבתה|מחיקה|הסרה|deactivat|removeTeacher/i)
  })

  it('clever-processor allows manager teacher|secretary|deputy and secretary teacher-only', () => {
    expect(edge).toContain('isActiveTenantInviter')
    expect(edge).toContain('canTenantInviteRole')
    expect(edge).toContain("callerRole === 'institution_manager'")
    expect(edge).toContain("callerRole === 'secretary'")
    expect(edge).toContain("callerRole === 'deputy'")
    expect(edge).toContain("return requestedRole === 'teacher'")
    expect(edge).toContain("requestedRole === 'deputy'")
    expect(edge).toContain('institution_id: callerRow.institution_id')
    expect(edge).toContain('invited_by_user_id: callerRow.id')
  })

  it('clever-processor rejects tenant use of body institution_id and keeps PA manager invite separate', () => {
    expect(edge).toContain('body.institution_id')
    expect(edge).toContain("requestedRoleRaw === 'institution_manager'")
    expect(edge).toContain('isActiveGlobalPlatformAdmin')
    expect(edge).toContain('parseTenantInviteRole')
    expect(edge).toContain("value === 'teacher' || value === 'secretary' || value === 'deputy'")
    expect(edge).not.toContain("value === 'platform_admin'")
    // Tenant branch forbids body institution_id
    expect(edge).toContain('body.institution_id !== undefined && body.institution_id !== null')
  })
})
