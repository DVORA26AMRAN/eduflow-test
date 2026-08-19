import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canAdministrativelyOverrideHandler,
  canReleaseRequest,
  HANDLER_HISTORY_ACTIONS,
  releaseResult,
} from '../domain/requestOwnership'
import { canManageRequests } from '../security/institutionCapabilities'
import { canCallerInviteRole } from '../security/tenantInviteRoles'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const S2 = 'supabase/migrations/20250819105000_staff_deactivation_s2.sql'
const R1 = 'supabase/migrations/20250818104000_request_ownership_r1_handler.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const ACL = 'supabase/migrations/20250818102500_users_table_acl_hardening.sql'
const D3C = 'supabase/migrations/20250818103000_deputy_role_d3c_edit_operational_staff.sql'
const STATUS_HISTORY = 'supabase/migrations/20250702203000_auto_write_request_status_history.sql'
const AUDIT_SCHEMA = 'supabase/migrations/20250712153000_fix_request_reminder_audit_logs_action_type.sql'
const PHASE1_RLS = 'supabase/migrations/20250614010000_phase_1a_rls.sql'
const EDGE = 'supabase/functions/clever-processor/index.ts'
const APP = 'src/App.tsx'

const PHASE3_PATHS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

// FRONTEND_CALL_SITES intentionally removed — S3 frontend is now implemented.

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const comment = sql.indexOf(`COMMENT ON FUNCTION public.${name}`, start)
  expect(comment).toBeGreaterThan(start)
  return sql.slice(start, comment)
}

describe('Staff deactivation S2 database contract', () => {
  const sql = read(S2)
  const body = functionBody(sql, 'deactivate_staff_member')
  const adminRelease = functionBody(sql, 'staff_deactivation_release_owned_request')
  const r1 = read(R1)
  const d2 = read(D2)
  const acl = read(ACL)
  const d3c = read(D3C)
  const statusHistory = read(STATUS_HISTORY)
  const auditSchema = read(AUDIT_SCHEMA)
  const phase1Rls = read(PHASE1_RLS)
  const edge = read(EDGE)
  const release = functionBody(r1, 'release_request_handler')

  it('is a new forward-only migration after R1 104000', () => {
    expect(existsSync(resolve(root, S2))).toBe(true)
    expect(S2 > R1.replace(/\\/g, '/')).toBe(true)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.deactivate_staff_member')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public')
    expect(existsSync(resolve(root, 'supabase/migrations/20250819104500_request_ownership_assignment_user_lock.sql'))).toBe(true)
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.transfer_request_handler')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_request_status')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution',
    )
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_operator_for_institution',
    )
  })

  it('authorizes only an active same-institution Manager', () => {
    expect(body).toContain('v_actor UUID := auth.uid()')
    expect(body).toContain('v_caller.status <> \'active\'')
    expect(body).toContain("v_caller.primary_role <> 'institution_manager'::public.user_role")
    expect(body).toContain('v_caller.institution_id IS NULL')
    expect(body).toContain('IF p_user_id = v_actor THEN')
    expect(body).not.toContain('auth_user_is_active_institution_operator_for_institution')
  })

  it('allows Teacher, Secretary, and Deputy targets only', () => {
    expect(body).toContain("'teacher'::public.user_role")
    expect(body).toContain("'secretary'::public.user_role")
    expect(body).toContain("'deputy'::public.user_role")
    expect(body).toContain('v_target.institution_id IS DISTINCT FROM v_caller.institution_id')
  })

  it('denies self, Manager, and Platform Admin targets', () => {
    expect(body).toContain('IF p_user_id = v_actor THEN')
    expect(body).toContain("'institution_manager'::public.user_role")
    expect(body).toContain("'platform_admin'::public.user_role")
    expect(body).toContain('RAISE EXCEPTION \'Permission denied.\'')
    expect(body).toContain("ERRCODE = '42501'")
  })

  it('locks the target users row before requests and before the status decision', () => {
    const usersLock = body.search(/FROM public\.users\b[\s\S]*?FOR UPDATE/)
    const requestLock = body.search(/FROM public\.requests\b[\s\S]*?FOR UPDATE/)
    const statusUpdateAt = body.indexOf("SET status = 'inactive'")
    expect(usersLock).toBeGreaterThanOrEqual(0)
    expect(requestLock).toBeGreaterThan(usersLock)
    expect(statusUpdateAt).toBeGreaterThan(requestLock)
    expect(body).toContain('WHERE id = p_user_id')
    expect(sql).toContain('20250819104500')
  })

  it('auto-releases in_progress assignments through the internal routing-safe helper', () => {
    expect(body).toContain('PERFORM public.request_ownership_enter_rpc()')
    expect(body).toContain('handled_by_user_id = v_target.id')
    expect(body).toContain('r.institution_id = v_caller.institution_id')
    expect(body).toContain("r.status = 'in_progress'")
    expect(body).toContain('r.archived_at IS NULL')
    expect(body).toContain('FOR UPDATE OF r')
    expect(body).toContain('public.staff_deactivation_release_owned_request(')
    expect(body).not.toContain('public.release_request_handler(')
    expect(adminRelease).toContain('handled_by_user_id = NULL')
    expect(adminRelease).toContain("status = 'new'")
    expect(adminRelease).toContain("request_handler_history_write(")
    expect(adminRelease).toContain("'release'")
    expect(HANDLER_HISTORY_ACTIONS).toContain('release')
    expect(releaseResult()).toEqual({ handledByUserId: null, status: 'new' })
  })

  it('internal release does not call routing read gates (secretary-lane safe)', () => {
    expect(adminRelease).not.toContain('public.auth_user_can_read_institution_request')
    expect(adminRelease).not.toMatch(/PERFORM\s+public\.auth_user_can_read_institution_request/)
    expect(adminRelease).not.toContain('recipient_role')
    expect(adminRelease).not.toContain('request_payload')
    expect(adminRelease).not.toContain('created_by_user_id')
    expect(adminRelease).toContain('institution_id = p_institution_id')
    expect(adminRelease).toContain('handled_by_user_id = p_target_user_id')
    expect(adminRelease).toContain("status = 'in_progress'")
    expect(adminRelease).toContain('archived_at IS NULL')
    expect(d2).toContain("recipient_role = 'secretary'")
    expect(d2).toContain("recipient_role = 'institution_manager'")
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_can_read_institution_request',
    )
  })

  it('does not grant authenticated EXECUTE on the internal release helper', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.staff_deactivation_release_owned_request(UUID, UUID, UUID) FROM authenticated',
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.staff_deactivation_release_owned_request[\s\S]*TO authenticated/i,
    )
    expect(sql).not.toMatch(/force_release|admin_release_request/i)
  })

  it('uses the deactivating Manager as the release/history actor', () => {
    expect(body).toContain('v_actor UUID := auth.uid()')
    expect(body).toContain('public.staff_deactivation_release_owned_request(')
    expect(r1).toContain('actor_user_id is always auth.uid()')
    expect(adminRelease).toContain("request_handler_history_write(")
    expect(adminRelease).toContain('p_target_user_id')
    expect(adminRelease).toContain('NULL')
    expect(canAdministrativelyOverrideHandler('institution_manager')).toBe(true)
    expect(
      canReleaseRequest({
        archivedAt: null,
        status: 'in_progress',
        handledByUserId: 'handler-1',
      }),
    ).toEqual({ ok: true })
  })

  it('preserves completed, rejected, and archived historical assignment', () => {
    expect(body).toContain("r.status = 'in_progress'")
    expect(body).toContain('r.archived_at IS NULL')
    expect(body).not.toContain("status IN ('completed', 'rejected')")
    expect(adminRelease).not.toContain("status IN ('completed', 'rejected')")
    expect(body).not.toContain('transfer_request_handler')
    expect(release).toContain("'REQUEST_FINAL_STATE'")
    expect(release).toContain("'completed', 'rejected'")
  })

  it('keeps request status-history compatible via the existing trigger path', () => {
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_write_status_history')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.write_request_status_history')
    expect(statusHistory).toContain('CREATE TRIGGER requests_write_status_history')
    expect(statusHistory).toContain('AFTER UPDATE OF status ON public.requests')
    expect(adminRelease).toContain("status = 'new'")
    expect(body).toContain('public.staff_deactivation_release_owned_request(')
  })

  it('writes one staff_deactivated audit_logs row with required metadata', () => {
    expect(auditSchema).toContain('action_type is NOT NULL')
    expect(auditSchema).not.toContain('CHECK (action_type')
    expect(sql).not.toContain('CHECK (action_type')
    expect(body).toContain('INSERT INTO public.audit_logs')
    expect(body).toContain("'staff_deactivated'")
    expect(body).toContain("'user'")
    expect(body).toContain("'previous_status'")
    expect(body).toContain("'new_status'")
    expect(body).toContain("'target_user_id'")
    expect(body).toContain("'target_primary_role'")
    expect(body).toContain("'released_request_count'")
    expect(body).toContain('actor_user_id,')
    expect(body).toContain('v_caller.institution_id')
    expect(body).not.toMatch(/EXCEPTION\s+WHEN/)
  })

  it('only releases requests owned by the deactivation target in the same institution', () => {
    expect(body).toContain('handled_by_user_id = v_target.id')
    expect(body).toContain('r.institution_id = v_caller.institution_id')
    expect(adminRelease).toContain('handled_by_user_id = p_target_user_id')
    expect(adminRelease).toContain('institution_id = p_institution_id')
    expect(adminRelease).not.toContain('recipient_role')
    expect(adminRelease).not.toContain('request_type')
  })

  it('Manager deactivating Secretary with secretary-routed work does not require read access', () => {
    expect(body).toContain("'secretary'::public.user_role")
    expect(body).not.toContain('public.auth_user_can_read_institution_request')
    expect(body).not.toContain('release_request_handler')
    expect(d2).toContain("recipient_role = 'secretary'")
    expect(d2).toContain("recipient_role = 'institution_manager'")
  })

  it('is idempotent when the target is already inactive', () => {
    expect(body).toContain("v_unchanged := (v_previous_status = 'inactive')")
    expect(body).toContain("'unchanged', v_unchanged")
    expect(body).toContain('IF NOT v_unchanged THEN')
    expect(body).toContain("SET status = 'inactive'")
  })

  it('does not DELETE, mutate identity fields, or call Auth Admin', () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.users/i)
    expect(body).not.toContain('SET email')
    expect(body).not.toContain('SET primary_role')
    expect(body).not.toContain('SET institution_id')
    expect(body).not.toContain('national_id')
    expect(sql).not.toContain('auth.admin')
    expect(sql).not.toContain('deleteUser')
    expect(sql).not.toContain('reactivate')
    expect(edge).not.toContain('deactivate_staff_member')
  })

  it('does not add a users.status CHECK without proven live values', () => {
    expect(sql).not.toContain("CHECK (status IN ('active', 'inactive'))")
    expect(sql).toContain('users.status CHECK')
    expect(sql).toContain('NOT added in S2')
  })

  it('grants authenticated EXECUTE only and does not weaken users ACL/RLS', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.deactivate_staff_member(UUID) FROM PUBLIC')
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.deactivate_staff_member(UUID) TO authenticated',
    )
    expect(sql).not.toMatch(/GRANT EXECUTE[^\n]*TO anon/i)
    expect(sql).not.toMatch(/GRANT\s+UPDATE\b/i)
    expect(sql).not.toMatch(/GRANT\s+(INSERT|DELETE|TRUNCATE|ALL)\b/i)
    expect(sql).not.toContain('GRANT SELECT')
    expect(sql).not.toContain('ALTER TABLE public.users')
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('DROP POLICY')
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(acl).toMatch(
      /GRANT SELECT\s*\(\s*id,\s*institution_id,\s*primary_role,\s*full_name,\s*email,\s*status\s*\)\s*ON public\.users TO authenticated;/s,
    )
    expect(acl).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b[\s\S]{0,80}authenticated/i,
    )
    expect(phase1Rls).toContain('ALTER TABLE users ENABLE ROW LEVEL SECURITY')
    expect(d3c).not.toContain('SET status')
  })

  it('does not touch Phase 3 (S3 frontend is separately implemented)', () => {
    // S3 frontend is now implemented; the S2 SQL migration itself must not reference Phase 3 paths.
    for (const path of PHASE3_PATHS) {
      expect(sql).not.toContain(path)
    }
    // S3 frontend call sites call deactivate_staff_member via the service layer only (not scattered).
    const service = read('src/services/staffDirectory.ts')
    expect(service).toContain("rpc('deactivate_staff_member'")
    const app = read(APP)
    expect(app).not.toContain("rpc('deactivate_staff_member'")
  })

  it('keeps R1 claim/transfer/release invariants and D3C staff edit intact', () => {
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.transfer_request_handler')
    expect(r1).toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
    expect(r1).toContain('request_user_can_handle_request')
    expect(r1).toContain("v_user.status IS DISTINCT FROM 'active'")
    expect(d3c).toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(canManageRequests('deputy')).toBe(true)
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(true)
    expect(canAdministrativelyOverrideHandler('deputy')).toBe(false)
  })
})
