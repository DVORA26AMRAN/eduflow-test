import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  projectInstitutionManagerPanelState,
  validateInstitutionManagerInvite,
} from './institutionManagerInvite'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250813010000_platform_admin_manager_invitation_phase2.sql',
)
const edgePath = resolve(process.cwd(), 'supabase/functions/clever-processor/index.ts')
const inviteEmailSharedPath = resolve(
  process.cwd(),
  'supabase/functions/_shared/sendManagerInviteEmail.ts',
)
const schoolsUiPath = resolve(
  process.cwd(),
  'src/components/platform/PlatformAdminSchoolsSection.tsx',
)
const appPath = resolve(process.cwd(), 'src/App.tsx')
const institutionAdminPath = resolve(process.cwd(), 'src/services/institutionAdmin.ts')
const authServicePath = resolve(process.cwd(), 'src/services/auth.ts')
const typesPath = resolve(process.cwd(), 'src/types/institutionAdmin.ts')

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const nextCreate = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + marker.length)
  const nextRevoke = sql.indexOf('REVOKE ALL ON FUNCTION public.', start + marker.length)
  let end = sql.length
  if (nextCreate >= 0) {
    end = Math.min(end, nextCreate)
  }
  if (nextRevoke >= 0) {
    end = Math.min(end, nextRevoke)
  }
  return sql.slice(start, end)
}

describe('platform admin manager invitation phase 2', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const edge = readFileSync(edgePath, 'utf8')
  const schoolsUi = readFileSync(schoolsUiPath, 'utf8')
  const appSource = readFileSync(appPath, 'utf8')
  const institutionAdmin = readFileSync(institutionAdminPath, 'utf8')
  const authService = readFileSync(authServicePath, 'utf8')
  const typesSource = readFileSync(typesPath, 'utf8')

  it('adds onboarding_completed_at and backfills existing operational users', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ')
    expect(sql).toContain('SET onboarding_completed_at = u.created_at')
    expect(sql).toContain('u.created_at IS NOT NULL')
  })

  it('stops when multiple active managers exist before creating unique index', () => {
    expect(sql).toContain('Phase 2 blocked: institutions with more than one active institution_manager')
    expect(sql).toContain('HAVING COUNT(*) > 1')
  })

  it('enforces one active institution_manager per institution', () => {
    expect(sql).toContain('users_one_active_institution_manager_per_institution')
    expect(sql).toContain("primary_role = 'institution_manager'")
    expect(sql).toContain("status = 'active'")
  })

  it('exposes manager status RPC only to authenticated with global admin gate', () => {
    expect(sql).toContain('platform_admin_get_institution_manager(UUID)')
    expect(functionBody(sql, 'platform_admin_get_institution_manager')).toContain(
      'platform_admin_require_active()',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.platform_admin_get_institution_manager(UUID) TO authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.platform_admin_get_institution_manager(UUID) FROM anon',
    )
  })

  it('allows only the current user to complete own onboarding', () => {
    const body = functionBody(sql, 'complete_own_user_onboarding')
    expect(body).toContain('auth.uid()')
    expect(body).toContain('WHERE id = v_uid')
    expect(body).toContain('onboarding_completed_at = NOW()')
    expect(body).not.toContain('p_user_id')
    expect(body).toContain("'manager_onboarding_completed'")
  })

  it('extends clever-processor with platform_admin manager branch and tenant isolation', () => {
    expect(edge).toContain("requestedRoleRaw === 'institution_manager'")
    expect(edge).toContain('isActiveGlobalPlatformAdmin')
    expect(edge).toContain("primary_role: 'institution_manager'")
    expect(edge).toContain('onboarding_completed_at: null')
    expect(edge).toContain("action_type: 'manager_invited'")
    expect(edge).toContain('body.institution_id !== undefined')
    expect(edge).toContain("return jsonResponse({ ok: false, error: 'forbidden' }, 403)")
    expect(edge).toContain('institution_id: callerRow.institution_id')
    expect(edge).toContain('canTenantInviteRole')
    expect(edge).toContain("requireEnv('SUPABASE_SERVICE_ROLE_KEY')")
    expect(institutionAdmin).not.toMatch(/SERVICE_ROLE/)
    expect(appSource).not.toMatch(/SERVICE_ROLE/)
  })

  it('initial manager invite uses inviteUserByEmail with APP_URL redirect only', () => {
    expect(edge).toContain('inviteUserByEmail')
    expect(edge).toContain('resolveAppRedirectUrl')
    expect(edge).toContain("Deno.env.get('APP_URL')")
    expect(edge).toContain("Deno.env.get('EDUFLOW_APP_URL')")
    expect(edge).toContain("Deno.env.get('SITE_URL')")
    expect(edge).not.toContain('5173')
    expect(edge).not.toContain('5174')

    const managerBranchStart = edge.indexOf("requestedRoleRaw === 'institution_manager'")
    const tenantBranchStart = edge.indexOf('// Tenant')
    const managerBranch = edge.slice(
      managerBranchStart,
      tenantBranchStart > managerBranchStart ? tenantBranchStart : edge.length,
    )
    expect(managerBranch).toContain('inviteUserByEmail')
    expect(managerBranch).toContain('redirectTo')
    expect(managerBranch).toContain('resolveAppRedirectUrl()')
  })

  it('defers invite resend to Phase 2B — no Resend/generateLink/recovery path', () => {
    expect(existsSync(inviteEmailSharedPath)).toBe(false)
    expect(edge).not.toContain('sendManagerInviteEmail')
    expect(edge).not.toContain('RESEND_API_KEY')
    expect(edge).not.toContain('api.resend.com')
    expect(edge).not.toContain('generateLink')
    expect(edge).not.toContain('resetPasswordForEmail')
    expect(edge).not.toContain('manager_invite_resent')
    expect(edge).not.toContain('resendAwaitingManagerOnboardingEmail')
    expect(edge).toContain("error: 'manager_invite_pending'")
    expect(schoolsUi).not.toContain('שליחת הזמנה מחדש')
    expect(schoolsUi).not.toContain('INSTITUTION_MANAGER_RESEND')
    expect(typesSource).not.toContain('INSTITUTION_MANAGER_RESEND_ACTION_LABEL')
  })

  it('callback remains invite/onboarding semantics for initial invite', () => {
    expect(authService).toContain("type === 'invite'")
    expect(appSource).toContain('completeOwnUserOnboarding')
    expect(appSource).toContain('PasswordSetupPage')
  })

  it('platform admin UI shows none/awaiting/joined without resend action', () => {
    expect(schoolsUi).toContain('institution-manager-panel')
    expect(schoolsUi).toContain('INSTITUTION_MANAGER_NONE_LABEL')
    expect(schoolsUi).toContain('INSTITUTION_MANAGER_INVITED_LABEL')
    expect(schoolsUi).toContain('INSTITUTION_MANAGER_JOINED_LABEL')
    expect(schoolsUi).toContain('inviteInstitutionManagerAsPlatformAdmin')
    expect(schoolsUi).toContain('מנהלת בית הספר')
    expect(schoolsUi).toContain('manager-panel')
    expect(schoolsUi).toContain('INSTITUTION_MANAGER_INVITE_ACTION_LABEL')
  })

  it('password setup completes own onboarding after auth password update', () => {
    expect(appSource).toContain('completeOwnUserOnboarding')
    const savePasswordStart = appSource.indexOf('async function savePassword')
    expect(savePasswordStart).toBeGreaterThanOrEqual(0)
    const savePasswordBody = appSource.slice(savePasswordStart, savePasswordStart + 2500)
    expect(savePasswordBody.indexOf('updateUser')).toBeLessThan(
      savePasswordBody.indexOf('completeOwnUserOnboarding'),
    )
  })

  it('projects manager panel states from onboarding_completed_at', () => {
    expect(projectInstitutionManagerPanelState(null)).toEqual({ kind: 'none' })
    expect(
      projectInstitutionManagerPanelState({
        userId: 'u1',
        fullName: 'נועה',
        email: 'n@example.com',
        status: 'active',
        onboardingCompletedAt: null,
      }).kind,
    ).toBe('invited')
    expect(
      projectInstitutionManagerPanelState({
        userId: 'u1',
        fullName: 'נועה',
        email: 'n@example.com',
        status: 'active',
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      }).kind,
    ).toBe('joined')
    expect(
      projectInstitutionManagerPanelState({
        userId: 'u1',
        fullName: 'נועה',
        email: 'n@example.com',
        status: 'inactive',
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      }).kind,
    ).toBe('none')
  })

  it('validates manager invite name and email without role or institution fields', () => {
    expect(validateInstitutionManagerInvite({ fullName: '', email: 'a@b.com' }).ok).toBe(false)
    expect(validateInstitutionManagerInvite({ fullName: 'נועה', email: 'bad' }).ok).toBe(false)
    expect(validateInstitutionManagerInvite({ fullName: 'נועה', email: 'a@b.com' })).toEqual({
      ok: true,
      values: { fullName: 'נועה', email: 'a@b.com' },
    })
  })
})
