import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canManageRequests } from '../security/institutionCapabilities'
import { canCallerInviteRole } from '../security/tenantInviteRoles'
import {
  canAdministrativelyOverrideHandler,
  canClaimRequest,
  canOrdinaryStatusUpdate,
  canReleaseRequest,
  canRoleHandleRequest,
  canTransferOrReleaseAsActor,
  claimResult,
  ELIGIBLE_HANDLER_ROLES,
  HANDLER_HISTORY_ACTIONS,
  releaseResult,
} from '../domain/requestOwnership'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const R1 = 'supabase/migrations/20250818104000_request_ownership_r1_handler.sql'
const ACL = 'supabase/migrations/20250818102500_users_table_acl_hardening.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const D3C = 'supabase/migrations/20250818103000_deputy_role_d3c_edit_operational_staff.sql'
const STATUS_HISTORY = 'supabase/migrations/20250702203000_auto_write_request_status_history.sql'
const ARCHIVE = 'supabase/migrations/20250703152000_add_request_archive_fields.sql'
const APP = 'src/App.tsx'
const REQUESTS_SERVICE = 'src/services/requests.ts'

const PHASE3_PATHS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
]

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const comment = sql.indexOf(`COMMENT ON FUNCTION public.${name}`, start)
  expect(comment).toBeGreaterThan(start)
  return sql.slice(start, comment)
}

describe('Request ownership R1 domain invariants', () => {
  it('3/4. Teacher and Platform Admin cannot be handlers', () => {
    expect(
      canRoleHandleRequest({
        actorRole: 'teacher',
        actorActive: true,
        sameInstitution: true,
        requestType: 'absence',
      }),
    ).toBe(false)
    expect(
      canRoleHandleRequest({
        actorRole: 'platform_admin',
        actorActive: true,
        sameInstitution: true,
        requestType: 'absence',
      }),
    ).toBe(false)
    expect(ELIGIBLE_HANDLER_ROLES).toEqual(['institution_manager', 'deputy', 'secretary'])
  })

  it('5. inactive or cross-institution users cannot handle', () => {
    expect(
      canRoleHandleRequest({
        actorRole: 'deputy',
        actorActive: false,
        sameInstitution: true,
        requestType: 'absence',
      }),
    ).toBe(false)
    expect(
      canRoleHandleRequest({
        actorRole: 'secretary',
        actorActive: true,
        sameInstitution: false,
        requestType: 'absence',
      }),
    ).toBe(false)
  })

  it('7-10. routing lane is enforced', () => {
    expect(
      canRoleHandleRequest({
        actorRole: 'secretary',
        actorActive: true,
        sameInstitution: true,
        requestType: 'general_request',
        recipientRole: 'institution_manager',
      }),
    ).toBe(false)
    expect(
      canRoleHandleRequest({
        actorRole: 'institution_manager',
        actorActive: true,
        sameInstitution: true,
        requestType: 'general_request',
        recipientRole: 'secretary',
      }),
    ).toBe(false)
    expect(
      canRoleHandleRequest({
        actorRole: 'deputy',
        actorActive: true,
        sameInstitution: true,
        requestType: 'general_request',
        recipientRole: 'secretary',
      }),
    ).toBe(false)
    expect(
      canRoleHandleRequest({
        actorRole: 'deputy',
        actorActive: true,
        sameInstitution: true,
        requestType: 'absence',
      }),
    ).toBe(true)
    expect(
      canRoleHandleRequest({
        actorRole: 'secretary',
        actorActive: true,
        sameInstitution: true,
        requestType: 'budget_or_equipment',
      }),
    ).toBe(true)
  })

  it('11. claim is atomic new -> in_progress for the actor', () => {
    expect(
      canClaimRequest({
        archivedAt: null,
        status: 'new',
        handledByUserId: null,
        actorUserId: 'u1',
      }),
    ).toEqual({ ok: true })
    expect(claimResult('u1')).toEqual({ handledByUserId: 'u1', status: 'in_progress' })
  })

  it('14. concurrent second claim fails; self in_progress is idempotent', () => {
    expect(
      canClaimRequest({
        archivedAt: null,
        status: 'in_progress',
        handledByUserId: 'other',
        actorUserId: 'u1',
      }),
    ).toEqual({ ok: false, error: 'REQUEST_ALREADY_CLAIMED' })
    expect(
      canClaimRequest({
        archivedAt: null,
        status: 'in_progress',
        handledByUserId: 'u1',
        actorUserId: 'u1',
      }),
    ).toEqual({ ok: true, unchanged: true })
  })

  it('15/16. only current handler may ordinary-status-update; Manager has no status override', () => {
    expect(
      canOrdinaryStatusUpdate({
        actorUserId: 'handler',
        handledByUserId: 'handler',
        currentStatus: 'in_progress',
        nextStatus: 'completed',
      }),
    ).toBe(true)
    expect(
      canOrdinaryStatusUpdate({
        actorUserId: 'manager',
        handledByUserId: 'handler',
        currentStatus: 'in_progress',
        nextStatus: 'completed',
      }),
    ).toBe(false)
    expect(canAdministrativelyOverrideHandler('institution_manager')).toBe(true)
    expect(canAdministrativelyOverrideHandler('deputy')).toBe(false)
    expect(canAdministrativelyOverrideHandler('secretary')).toBe(false)
  })

  it('17/18. Deputy and Secretary cannot override another handler', () => {
    expect(
      canTransferOrReleaseAsActor({
        actorRole: 'deputy',
        actorUserId: 'd1',
        handledByUserId: 's1',
      }),
    ).toBe(false)
    expect(
      canTransferOrReleaseAsActor({
        actorRole: 'secretary',
        actorUserId: 's1',
        handledByUserId: 'd1',
      }),
    ).toBe(false)
    expect(
      canTransferOrReleaseAsActor({
        actorRole: 'deputy',
        actorUserId: 'd1',
        handledByUserId: 'd1',
      }),
    ).toBe(true)
  })

  it('20. release clears handler and returns status to new', () => {
    expect(
      canReleaseRequest({
        archivedAt: null,
        status: 'in_progress',
        handledByUserId: 'u1',
      }),
    ).toEqual({ ok: true })
    expect(releaseResult()).toEqual({ handledByUserId: null, status: 'new' })
  })

  it('21. final-state requests fail closed for claim/release', () => {
    expect(
      canClaimRequest({
        archivedAt: null,
        status: 'completed',
        handledByUserId: null,
        actorUserId: 'u1',
      }),
    ).toEqual({ ok: false, error: 'REQUEST_FINAL_STATE' })
    expect(
      canReleaseRequest({
        archivedAt: null,
        status: 'rejected',
        handledByUserId: 'u1',
      }),
    ).toEqual({ ok: false, error: 'REQUEST_FINAL_STATE' })
  })
})

describe('Request ownership R1 database foundation', () => {
  const sql = read(R1)
  const acl = read(ACL)
  const d2 = read(D2)
  const d3c = read(D3C)
  const statusHistory = read(STATUS_HISTORY)
  const archive = read(ARCHIVE)
  const app = read(APP)
  const requestsService = read(REQUESTS_SERVICE)
  const claim = functionBody(sql, 'claim_request')
  const transfer = functionBody(sql, 'transfer_request_handler')
  const release = functionBody(sql, 'release_request_handler')
  const statusRpc = functionBody(sql, 'update_request_status')
  const denylist = functionBody(sql, 'enforce_requests_secretary_update_columns')
  const eligibility = functionBody(sql, 'request_user_can_handle_request')
  const historyWrite = functionBody(sql, 'request_handler_history_write')

  it('1. handled_by_user_id is nullable UUID FK ON DELETE RESTRICT', () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS handled_by_user_id UUID\s+REFERENCES public\.users \(id\) ON DELETE RESTRICT/,
    )
    expect(sql).toContain("COMMENT ON COLUMN public.requests.handled_by_user_id")
    expect(sql).not.toContain('handled_by_user_id UUID NOT NULL')
  })

  it('2. authenticated loses broad UPDATE and gets only archive-column UPDATE', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.requests FROM PUBLIC')
    expect(sql).toContain('REVOKE ALL ON TABLE public.requests FROM anon')
    expect(sql).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
    )
    expect(sql).toContain('ON TABLE public.requests FROM authenticated')
    expect(sql).not.toMatch(/REVOKE ALL ON TABLE public\.requests FROM authenticated/)
    expect(sql).toContain(
      'GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated',
    )
    expect(sql).not.toMatch(/GRANT UPDATE\s*\([^)]*handled_by_user_id/)
    expect(sql).not.toMatch(/GRANT UPDATE\s+ON TABLE public\.requests TO authenticated/)
    expect(sql).not.toContain('GRANT UPDATE (status)')
  })

  it('creates immutable request_handler_history with claim/transfer/release', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.request_handler_history')
    expect(sql).toContain('actor_user_id UUID NOT NULL')
    expect(sql).toContain('previous_handler_user_id')
    expect(sql).toContain('new_handler_user_id')
    expect(HANDLER_HISTORY_ACTIONS).toEqual(['claim', 'transfer', 'release'])
    expect(sql).toContain("CHECK (action IN ('claim', 'transfer', 'release'))")
    expect(sql).toContain('GRANT SELECT ON TABLE public.request_handler_history TO authenticated')
    expect(sql).toContain('REVOKE ALL ON TABLE public.request_handler_history FROM authenticated')
    expect(sql).not.toMatch(/GRANT INSERT ON TABLE public\.request_handler_history/)
    expect(sql).not.toMatch(/GRANT UPDATE ON TABLE public\.request_handler_history/)
    expect(sql).not.toMatch(/GRANT DELETE ON TABLE public\.request_handler_history/)
    expect(historyWrite).toContain('auth.uid()')
    expect(historyWrite).toContain('actor_user_id')
    expect(historyWrite).not.toContain('p_actor_user_id')
  })

  it('does not overload request_status_history', () => {
    expect(sql).not.toContain('ALTER TABLE public.request_status_history')
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_write_status_history')
    expect(statusHistory).toContain('AFTER UPDATE OF status ON public.requests')
  })

  it('3/4/5. claim requires eligible active same-institution handler, not teacher/admin', () => {
    expect(eligibility).toContain("'institution_manager'::public.user_role")
    expect(eligibility).toContain("'deputy'::public.user_role")
    expect(eligibility).toContain("'secretary'::public.user_role")
    expect(eligibility).not.toContain("'teacher'::public.user_role")
    expect(eligibility).not.toContain("'platform_admin'::public.user_role")
    expect(eligibility).toContain("v_user.status IS DISTINCT FROM 'active'")
    expect(eligibility).toContain(
      'v_user.institution_id IS DISTINCT FROM v_request.institution_id',
    )
    expect(claim).toContain('request_user_can_handle_request(v_actor, p_request_id)')
    expect(claim).toContain('auth_user_can_read_institution_request(p_request_id)')
  })

  it('6/8/9. routing lane is enforced for manager- and secretary-routed general requests', () => {
    expect(eligibility).toContain("v_request.request_type = 'general_request'")
    expect(eligibility).toContain("v_request.recipient_role = 'institution_manager'")
    expect(eligibility).toContain("v_request.recipient_role = 'secretary'")
    expect(eligibility).toContain(
      "RETURN v_user.primary_role = 'secretary'::public.user_role",
    )
  })

  it('11/12/13. claim is CAS new -> in_progress, writes history, leaves status trigger', () => {
    expect(claim).toContain('FOR UPDATE')
    expect(claim).toContain('AND handled_by_user_id IS NULL')
    expect(claim).toContain("AND status = 'new'")
    expect(claim).toContain('handled_by_user_id = v_actor')
    expect(claim).toContain("status = 'in_progress'")
    expect(claim).toContain("request_handler_history_write(")
    expect(claim).toContain("'claim'")
    expect(sql).toContain('existing requests_write_status_history')
    expect(sql).toContain('requests_create_status_notification')
    expect(sql).toContain('requests_set_updated_at fire from the status UPDATE')
  })

  it('14. competing claims fail closed after the first CAS winner', () => {
    expect(claim).toContain("'REQUEST_ALREADY_CLAIMED'")
    expect(claim).toContain('IF NOT FOUND THEN')
    expect(claim).toContain('FOR UPDATE')
  })

  it('15/16. status RPC requires current handler and has no Manager override', () => {
    expect(statusRpc).toContain('handled_by_user_id IS DISTINCT FROM v_actor')
    expect(statusRpc).not.toContain('auth_user_is_active_institution_manager_for_institution')
    expect(statusRpc).toContain("v_request.status = 'new' AND v_status = 'in_progress'")
    expect(statusRpc).toContain("handled_by_user_id IS NULL AND v_request.status = 'new'")
    expect(statusRpc).toContain('FOR UPDATE')
    expect(statusRpc).toContain('AND status IS NOT DISTINCT FROM v_request.status')
  })

  it('16-18. transfer/release Manager override uses manager helper, not operator helper', () => {
    expect(transfer).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(release).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(transfer).not.toContain('auth_user_is_active_institution_operator_for_institution')
    expect(release).not.toContain('auth_user_is_active_institution_operator_for_institution')
    expect(transfer).toContain('v_is_handler')
    expect(release).toContain('v_is_handler')
  })

  it('19. transfer validates target eligibility and does not change status', () => {
    expect(transfer).toContain('request_user_can_handle_request(p_target_user_id, p_request_id)')
    expect(transfer).toContain('SET handled_by_user_id = p_target_user_id')
    expect(transfer).not.toContain('SET status')
    expect(transfer).toContain("AND handled_by_user_id = v_request.handled_by_user_id")
    expect(transfer).toContain("'transfer'")
  })

  it('20. release clears handler and sets status=new atomically', () => {
    expect(release).toContain('handled_by_user_id = NULL')
    expect(release).toContain("status = 'new'")
    expect(release).toContain("AND status = 'in_progress'")
    expect(release).toContain("'release'")
  })

  it('21. final-state requests cannot be claimed, transferred, or released', () => {
    expect(claim).toContain("'completed', 'rejected'")
    expect(claim).toContain("'REQUEST_FINAL_STATE'")
    expect(transfer).toContain("'REQUEST_FINAL_STATE'")
    expect(release).toContain("'REQUEST_FINAL_STATE'")
    expect(transfer).toContain("AND status NOT IN ('completed', 'rejected')")
  })

  it('22. secretary table UPDATE cannot modify handled_by, payload, recipient_role, or status', () => {
    expect(denylist).toContain('NEW.handled_by_user_id IS DISTINCT FROM OLD.handled_by_user_id')
    expect(denylist).toContain('NEW.request_payload IS DISTINCT FROM OLD.request_payload')
    expect(denylist).toContain('NEW.recipient_role IS DISTINCT FROM OLD.recipient_role')
    expect(denylist).toContain('NEW.status IS DISTINCT FROM OLD.status')
    expect(denylist).toContain('NEW.institution_id IS DISTINCT FROM OLD.institution_id')
    expect(denylist).toContain('NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id')
    expect(denylist).toContain('NEW.request_type IS DISTINCT FROM OLD.request_type')
    expect(denylist).toContain('NEW.description IS DISTINCT FROM OLD.description')
    expect(denylist).toContain('NEW.created_at IS DISTINCT FROM OLD.created_at')
    expect(denylist).not.toContain('NEW.updated_at IS DISTINCT FROM OLD.updated_at')
    expect(denylist).toContain("current_setting('mpex.request_mutation_rpc', true) = '1'")
    expect(archive).toContain('CREATE POLICY requests_secretary_archive_institution')
  })

  it('reconciles the live secretary trigger without duplicating it', () => {
    expect(sql).toContain('requests_enforce_secretary_update_columns   (ALREADY EXISTS)')
    expect(sql).toContain(
      'DROP TRIGGER IF EXISTS requests_enforce_secretary_update_columns ON public.requests',
    )
    expect(
      (sql.match(/DROP TRIGGER IF EXISTS requests_enforce_secretary_update_columns/g) ?? [])
        .length,
    ).toBe(1)
    expect(
      (sql.match(/CREATE TRIGGER requests_enforce_secretary_update_columns/g) ?? []).length,
    ).toBe(1)
    expect(sql).not.toContain('trigger was not present in tracked migrations')
    expect(sql).toContain('canonical live secretary column guard')
  })

  it('preserves existing non-secretary request triggers', () => {
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_set_updated_at')
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_write_status_history')
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_create_status_notification')
    expect(sql).not.toContain(
      'DROP TRIGGER IF EXISTS requests_create_general_request_notification',
    )
    expect(sql).not.toContain('DROP TRIGGER IF EXISTS requests_enforce_teacher_insert_columns')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.write_request_status_history')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.create_request_status_notification')
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.create_general_request_notification',
    )
    expect(statusHistory).toContain('CREATE TRIGGER requests_write_status_history')
  })

  it('retains Teacher INSERT and does not revoke service_role', () => {
    expect(sql).toContain('GRANT SELECT, INSERT ON TABLE public.requests TO authenticated')
    expect(sql).not.toMatch(/REVOKE INSERT\b/)
    expect(sql).not.toMatch(/\bFROM\s+service_role\b/i)
    expect(sql).not.toMatch(/\bTO\s+service_role\b/i)
    expect(sql).not.toMatch(/\bREVOKE\b[^\n]*\bservice_role\b/i)
    expect(sql).not.toMatch(/\bGRANT\b[^\n]*\bservice_role\b/i)
  })

  it('F. moves Secretary status mutation onto the same RPC', () => {
    expect(statusRpc).toContain('request_user_can_handle_request(v_actor, p_request_id)')
    expect(statusRpc).toContain('auth_user_can_read_institution_request(p_request_id)')
    expect(requestsService).toContain("callerRole === 'secretary'")
    expect(requestsService).toContain("rpc('update_request_status'")
    expect(requestsService).not.toContain(".from('requests').update({ status })")
  })

  it('23. keeps D2 request SELECT routing and D3C staff RPC intact', () => {
    expect(d2).toContain('auth_user_is_active_institution_operator_for_institution')
    expect(d2).toContain("recipient_role = 'institution_manager'")
    expect(sql).not.toContain('DROP POLICY IF EXISTS requests_manager_select_institution')
    expect(sql).not.toContain('DROP POLICY IF EXISTS requests_secretary_select_institution')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.auth_user_can_read_institution_request')
    expect(d3c).toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(canManageRequests('deputy')).toBe(true)
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(true)
  })

  it('24. does not broaden 102500 users ACL', () => {
    expect(acl).toMatch(
      /GRANT SELECT\s*\(\s*id,\s*institution_id,\s*primary_role,\s*full_name,\s*email,\s*status\s*\)\s*ON public\.users TO authenticated;/s,
    )
    expect(sql).not.toMatch(/GRANT SELECT\s*\(/)
    expect(sql).not.toMatch(/GRANT SELECT ON (TABLE )?public\.users/i)
    expect(sql).not.toContain('ALTER TABLE public.users')
    expect(sql).not.toContain('national_id')
  })

  it('does not broaden request visibility or touch Phase 3 / App UI', () => {
    expect(sql).not.toContain('DROP POLICY IF EXISTS requests_manager_select_institution')
    expect(existsSync(resolve(root, R1))).toBe(true)
    expect(app).not.toContain('handled_by')
    expect(app).not.toContain('claim_request')
    for (const path of PHASE3_PATHS) {
      expect(sql).not.toContain(path)
    }
  })

  it('does not encode handler in payload, notes, status, or recipient_role', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS handled_by_user_id')
    expect(sql).not.toContain("request_payload jsonb_set")
    expect(sql).not.toContain('ALTER TABLE public.request_notes')
  })
})
