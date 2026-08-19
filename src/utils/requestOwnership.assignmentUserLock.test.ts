import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canAdministrativelyOverrideHandler,
  canClaimRequest,
  canReleaseRequest,
  canRoleHandleRequest,
  HANDLER_HISTORY_ACTIONS,
  releaseResult,
} from '../domain/requestOwnership'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const R1 = 'supabase/migrations/20250818104000_request_ownership_r1_handler.sql'
const LOCK = 'supabase/migrations/20250819104500_request_ownership_assignment_user_lock.sql'
const S2 = 'supabase/migrations/20250819105000_staff_deactivation_s2.sql'

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

function firstUsersForUpdateIndex(sql: string): number {
  return sql.search(/FROM public\.users\b[\s\S]*?FOR UPDATE/)
}

function firstRequestsForUpdateIndex(sql: string): number {
  return sql.search(/FROM public\.requests\b[\s\S]*?FOR UPDATE/)
}

describe('Request ownership assignment user-lock (104500)', () => {
  const r1 = read(R1)
  const lockSql = read(LOCK)
  const s2 = read(S2)
  const liveClaim = functionBody(lockSql, 'claim_request')
  const liveTransfer = functionBody(lockSql, 'transfer_request_handler')
  const r1Claim = functionBody(r1, 'claim_request')
  const r1Transfer = functionBody(r1, 'transfer_request_handler')
  const r1Release = functionBody(r1, 'release_request_handler')
  const deactivate = functionBody(s2, 'deactivate_staff_member')

  it('is a new forward-only migration after live 104000 and before unapplied 105000', () => {
    expect(existsSync(resolve(root, LOCK))).toBe(true)
    expect(LOCK > R1.replace(/\\/g, '/')).toBe(true)
    expect(LOCK < S2.replace(/\\/g, '/')).toBe(true)
    expect(lockSql).not.toContain('ALTER TABLE public.users')
    expect(lockSql).not.toContain('ALTER TABLE public.requests')
    expect(lockSql).not.toContain('CREATE OR REPLACE FUNCTION public.deactivate_staff_member')
    expect(lockSql).not.toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
    expect(lockSql).not.toContain('CREATE OR REPLACE FUNCTION public.update_request_status')
    expect(lockSql).not.toContain('CREATE OR REPLACE FUNCTION public.request_user_can_handle_request')
  })

  it('does not edit the already-applied 104000 migration', () => {
    expect(r1Claim).toContain('FROM public.requests')
    expect(firstRequestsForUpdateIndex(r1Claim)).toBeGreaterThanOrEqual(0)
    expect(firstUsersForUpdateIndex(r1Claim)).toBe(-1)
    expect(firstUsersForUpdateIndex(r1Transfer)).toBe(-1)
    expect(r1).not.toContain('Canonical lock order')
  })

  it('claim locks the actor users row before the request and before eligibility', () => {
    const usersLock = firstUsersForUpdateIndex(liveClaim)
    const requestLock = firstRequestsForUpdateIndex(liveClaim)
    const eligibility = liveClaim.indexOf('request_user_can_handle_request(v_actor, p_request_id)')
    expect(usersLock).toBeGreaterThanOrEqual(0)
    expect(requestLock).toBeGreaterThan(usersLock)
    expect(eligibility).toBeGreaterThan(requestLock)
    expect(liveClaim).toContain('WHERE id = v_actor')
    expect(liveClaim).toContain('handled_by_user_id = v_actor')
    expect(liveClaim).toContain("status = 'in_progress'")
  })

  it('transfer locks the target users row before the request and before eligibility', () => {
    const usersLock = firstUsersForUpdateIndex(liveTransfer)
    const requestLock = firstRequestsForUpdateIndex(liveTransfer)
    const eligibility = liveTransfer.indexOf(
      'request_user_can_handle_request(p_target_user_id, p_request_id)',
    )
    expect(usersLock).toBeGreaterThanOrEqual(0)
    expect(requestLock).toBeGreaterThan(usersLock)
    expect(eligibility).toBeGreaterThan(requestLock)
    expect(liveTransfer).toContain('WHERE id = p_target_user_id')
    expect(liveTransfer).not.toContain('WHERE id = v_actor\n    FOR UPDATE')
  })

  it('deactivation uses the same user-then-request order', () => {
    const usersLock = firstUsersForUpdateIndex(deactivate)
    const requestLock = firstRequestsForUpdateIndex(deactivate)
    const statusUpdate = deactivate.indexOf("SET status = 'inactive'")
    expect(usersLock).toBeGreaterThanOrEqual(0)
    expect(requestLock).toBeGreaterThan(usersLock)
    expect(statusUpdate).toBeGreaterThan(requestLock)
    expect(s2).toContain('Canonical lock order')
    expect(s2).toContain('20250819104500')
  })

  it('does not invert to request-then-user on assignment or deactivation', () => {
    expect(firstUsersForUpdateIndex(liveClaim)).toBeLessThan(
      firstRequestsForUpdateIndex(liveClaim),
    )
    expect(firstUsersForUpdateIndex(liveTransfer)).toBeLessThan(
      firstRequestsForUpdateIndex(liveTransfer),
    )
    expect(firstUsersForUpdateIndex(deactivate)).toBeLessThan(
      firstRequestsForUpdateIndex(deactivate),
    )
    expect(firstUsersForUpdateIndex(r1Release)).toBe(-1)
    expect(firstRequestsForUpdateIndex(r1Release)).toBeGreaterThanOrEqual(0)
  })

  it('claim concurrent with deactivation cannot assign an inactive actor', () => {
    // Same users row: one of claim or deactivate waits. After deactivate
    // commits inactive, claim's locked re-read via request_user_can_handle_request
    // fails closed. Claim never writes handled_by without that check.
    expect(liveClaim.indexOf('FOR UPDATE')).toBeLessThan(
      liveClaim.indexOf('request_user_can_handle_request'),
    )
    expect(r1).toContain("v_user.status IS DISTINCT FROM 'active'")
    expect(canRoleHandleRequest({
      actorRole: 'secretary',
      actorActive: false,
      sameInstitution: true,
      requestType: 'absence',
    })).toBe(false)
    expect(deactivate).toContain("SET status = 'inactive'")
    expect(liveClaim).toContain('request_user_can_handle_request(v_actor, p_request_id)')
  })

  it('transfer concurrent with target deactivation cannot assign an inactive target', () => {
    expect(liveTransfer.indexOf('WHERE id = p_target_user_id')).toBeLessThan(
      liveTransfer.indexOf('request_user_can_handle_request(p_target_user_id'),
    )
    expect(liveTransfer).toContain('FROM public.users')
    expect(liveTransfer).toContain('FOR UPDATE')
    expect(canRoleHandleRequest({
      actorRole: 'deputy',
      actorActive: false,
      sameInstitution: true,
      requestType: 'general_request',
      recipientRole: 'institution_manager',
    })).toBe(false)
  })

  it('deactivation concurrent with claim has a deterministic safe outcome', () => {
    // Winner holds the target users row until commit.
    // Claim-first: assignment commits active, then deactivate releases in_progress.
    // Deactivate-first: status becomes inactive, then claim eligibility fails.
    expect(deactivate).toContain('handled_by_user_id = v_target.id')
    expect(deactivate).toContain("r.status = 'in_progress'")
    expect(deactivate).toContain('public.staff_deactivation_release_owned_request(')
    expect(deactivate).not.toContain('public.release_request_handler(')
    expect(liveClaim).toContain('AND handled_by_user_id IS NULL')
    expect(releaseResult()).toEqual({ handledByUserId: null, status: 'new' })
  })

  it('no active request can remain assigned to an inactive user after both commit', () => {
    expect(deactivate).toContain("SET status = 'inactive'")
    expect(deactivate.indexOf('staff_deactivation_release_owned_request')).toBeLessThan(
      deactivate.indexOf("SET status = 'inactive'"),
    )
    expect(liveClaim).toContain('request_user_can_handle_request')
    expect(liveTransfer).toContain('request_user_can_handle_request')
    expect(deactivate).toContain('staff_deactivation_release_owned_request')
    expect(deactivate).not.toContain('release_request_handler')
  })

  it('preserves R1 claim/transfer/release behavior and historical finals', () => {
    expect(liveClaim).toContain("'REQUEST_FINAL_STATE'")
    expect(liveClaim).toContain("'REQUEST_ALREADY_CLAIMED'")
    expect(liveClaim).toContain("'REQUEST_NOT_CLAIMABLE'")
    expect(liveClaim).toContain("'unchanged', true")
    expect(liveTransfer).toContain("'REQUEST_NOT_ASSIGNED'")
    expect(liveTransfer).toContain("'transfer'")
    expect(liveTransfer).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(r1Release).toContain("status = 'new'")
    expect(r1Release).toContain("'release'")
    expect(HANDLER_HISTORY_ACTIONS).toEqual(['claim', 'transfer', 'release'])
    expect(
      canClaimRequest({
        archivedAt: null,
        status: 'completed',
        handledByUserId: 'u1',
        actorUserId: 'u1',
      }),
    ).toEqual({ ok: false, error: 'REQUEST_FINAL_STATE' })
    expect(
      canReleaseRequest({
        archivedAt: '2026-01-01T00:00:00.000Z',
        status: 'in_progress',
        handledByUserId: 'u1',
      }),
    ).toEqual({ ok: false, error: 'REQUEST_ARCHIVED' })
    expect(canAdministrativelyOverrideHandler('deputy')).toBe(false)
    expect(deactivate).toContain("r.status = 'in_progress'")
    expect(deactivate).toContain('r.archived_at IS NULL')
  })

  it('does not touch Phase 3, Auth Admin, or users ACL', () => {
    for (const path of PHASE3_PATHS) {
      expect(lockSql).not.toContain(path)
    }
    expect(lockSql).not.toContain('auth.admin')
    expect(lockSql).not.toContain('deleteUser')
    expect(lockSql).not.toMatch(/GRANT\s+UPDATE\b/i)
    expect(lockSql).toContain('GRANT EXECUTE ON FUNCTION public.claim_request(UUID) TO authenticated')
    expect(lockSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.transfer_request_handler(UUID, UUID) TO authenticated',
    )
  })
})
