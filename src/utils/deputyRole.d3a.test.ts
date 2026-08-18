import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canManageTeamUsers } from '../security/institutionCapabilities'
import {
  canCallerInviteRole,
  getAllowedTenantInviteRoles,
} from '../security/tenantInviteRoles'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const EDGE = 'supabase/functions/clever-processor/index.ts'
const APP = 'src/App.tsx'
const CREATE_FORM = 'src/components/manager/CreateUserForm.tsx'
const MANAGER_PAGE = 'src/pages/ManagerDashboardPage.tsx'
const SECRETARY_PAGE = 'src/pages/SecretaryDashboardPage.tsx'
const INSTITUTION_USERS = 'src/services/institutionUsers.ts'
const AUTH = 'src/services/auth.ts'
const PROFILE = 'src/services/profile.ts'
const D1_ENUM = 'supabase/migrations/20250818100000_deputy_role_d1_foundation.sql'
const D1_OPERATOR = 'supabase/migrations/20250818101000_deputy_role_d1_operator_helper.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const D3A_MIGRATION = 'supabase/migrations/20250818103000_deputy_role_d3a_manager_invite.sql'

function tenantInviteBranch(edge: string): string {
  const start = edge.indexOf('Tenant invites')
  expect(start).toBeGreaterThanOrEqual(0)
  return edge.slice(start)
}

describe('Deputy D3A — Manager can invite Deputy', () => {
  const edge = read(EDGE)
  const tenant = tenantInviteBranch(edge)
  const app = read(APP)
  const form = read(CREATE_FORM)
  const managerPage = read(MANAGER_PAGE)
  const secretaryPage = read(SECRETARY_PAGE)
  const institutionUsers = read(INSTITUTION_USERS)

  it('reuses clever-processor and the existing CreateUserForm invite flow', () => {
    expect(app).toContain('functions/v1/clever-processor')
    expect(app).toContain('getAllowedTenantInviteRoles')
    expect(app).toContain('validateCreateUserForm')
    expect(managerPage).toContain('TeamManagementSection')
    expect(managerPage).toContain('getAllowedTenantInviteRoles(profile.role)')
    expect(form).toContain('MANAGER_TENANT_INVITE_ROLES')
    expect(form).toContain("deputy: 'סגנית'")
    expect(existsSync(resolve(root, 'supabase/functions/clever-processor/index.ts'))).toBe(true)
  })

  it('shows Manager invite options מורה / מזכירה / סגנית and not מנהלת or Platform Admin', () => {
    expect(form).toContain("teacher: 'מורה'")
    expect(form).toContain("secretary: 'מזכירה'")
    expect(form).toContain("deputy: 'סגנית'")
    expect(form).not.toContain("institution_manager:")
    expect(form).not.toContain('platform_admin')
    expect(getAllowedTenantInviteRoles('institution_manager')).toEqual([
      'teacher',
      'secretary',
      'deputy',
    ])
  })

  it('keeps Secretary teacher-only and hides user management from Deputy', () => {
    expect(secretaryPage).toContain("allowedRoles: ['teacher']")
    expect(getAllowedTenantInviteRoles('secretary')).toEqual(['teacher'])
    expect(canManageTeamUsers('deputy')).toBe(false)
    expect(canManageTeamUsers('institution_manager')).toBe(true)
    expect(app).toContain(
      "currentProfile.role !== 'institution_manager' && currentProfile.role !== 'secretary'",
    )
  })

  it('enforces the clever-processor caller→invitee matrix', () => {
    expect(canCallerInviteRole('institution_manager', 'teacher')).toBe(true)
    expect(canCallerInviteRole('institution_manager', 'secretary')).toBe(true)
    expect(canCallerInviteRole('institution_manager', 'deputy')).toBe(true)
    expect(canCallerInviteRole('secretary', 'teacher')).toBe(true)
    expect(canCallerInviteRole('secretary', 'secretary')).toBe(false)
    expect(canCallerInviteRole('secretary', 'deputy')).toBe(false)
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(false)
    expect(canCallerInviteRole('deputy', 'secretary')).toBe(false)
    expect(canCallerInviteRole('deputy', 'deputy')).toBe(false)

    expect(edge).toContain("requestedRole === 'teacher' ||")
    expect(edge).toContain("requestedRole === 'secretary' ||")
    expect(edge).toContain("requestedRole === 'deputy'")
    expect(edge).toContain("if (callerRole === 'secretary')")
    expect(edge).toContain("return requestedRole === 'teacher'")
    expect(edge).toContain("if (callerRow.primary_role === 'deputy')")
    expect(edge).toContain("requestedRoleRaw === 'institution_manager'")
    expect(edge).toContain("requestedRoleRaw === 'platform_admin'")
    expect(edge).toContain("isActiveGlobalPlatformAdmin")
  })

  it('creates Deputy with caller institution_id and primary_role deputy via insert only', () => {
    expect(tenant).toContain('primary_role: role')
    expect(tenant).toContain('institution_id: callerRow.institution_id')
    expect(tenant).toContain("status: 'active'")
    expect(tenant).toContain('onboarding_completed_at: null')
    expect(tenant).toContain('inviteUserByEmail')
    expect(tenant).toContain("body.institution_id !== undefined && body.institution_id !== null")
    expect(tenant).not.toMatch(/from\('users'\)\.update/)
    expect(institutionUsers).toContain("user.primary_role === 'deputy'")
  })

  it('rejects existing emails instead of silently changing primary_role', () => {
    expect(tenant).toContain('tenant email lookup failed')
    expect(tenant).toContain("error: 'conflict'")
    expect(tenant).toContain('email already belongs to an existing user')
    expect(edge).not.toMatch(/from\('users'\)\s*\.update/)
  })

  it('allows multiple Deputies and does not add a one-deputy unique constraint', () => {
    expect(read(D1_ENUM)).not.toContain('users_one_active_deputy')
    expect(read(D1_OPERATOR)).not.toContain('users_one_active_deputy')
    expect(edge).not.toContain('users_one_active_deputy')
    expect(tenant).not.toContain("eq('primary_role', 'deputy')")
    expect(existsSync(resolve(root, D3A_MIGRATION))).toBe(false)
  })

  it('reuses existing password-setup, profile parsing, and D2 deputy routing', () => {
    expect(read(AUTH)).toContain("type === 'invite'")
    expect(read(PROFILE)).toContain("value === 'deputy'")
    expect(app).toContain("currentProfile.role === 'deputy'")
    expect(app).toContain('ManagerDashboardPage')
    expect(read(D2)).toContain('auth_user_is_active_institution_operator_for_institution')
  })

  it('does not edit applied D1/D2 migrations or start full D3 edit/disable', () => {
    expect(read(D1_ENUM)).toContain("ADD VALUE IF NOT EXISTS 'deputy'")
    expect(d2DoesNotGainUserManagement(read(D2))).toBe(true)
    expect(edge).not.toContain('handled_by')
    expect(app).not.toContain('handled_by')
  })
})

function d2DoesNotGainUserManagement(d2: string): boolean {
  return (
    !d2.includes('CREATE OR REPLACE FUNCTION public.update_staff_member') &&
    !d2.includes('CREATE OR REPLACE FUNCTION public.manager_set_user_extended_profile')
  )
}
