/**
 * J1 Management Daily Journal — database foundation contract tests.
 * Source analysis of the unapplied migration. Does not apply SQL.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const S4 = 'supabase/migrations/20250819106000_staff_reactivation_s4.sql'
const S2 = 'supabase/migrations/20250819105000_staff_deactivation_s2.sql'
const R1 = 'supabase/migrations/20250818104000_request_ownership_r1_handler.sql'
const LOCK = 'supabase/migrations/20250819104500_request_ownership_assignment_user_lock.sql'
const ACL = 'supabase/migrations/20250818102500_users_table_acl_hardening.sql'

const PHASE3_PATHS = [
  'school_registration_quotation',
  'quotationPdf',
  'schoolRegistrationQuotation',
  'school-registration-quotation-pdf',
]

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const dollarEnd = sql.indexOf('$$;', start)
  expect(dollarEnd).toBeGreaterThan(start)
  return sql.slice(start, dollarEnd + 3)
}

function grantsFor(sql: string, name: string): string {
  const needle = `ON FUNCTION public.${name}`
  const chunks: string[] = []
  let from = 0
  while (from < sql.length) {
    const idx = sql.indexOf(needle, from)
    if (idx < 0) {
      break
    }
    chunks.push(sql.slice(Math.max(0, idx - 80), idx + needle.length + 80))
    from = idx + needle.length
  }
  return chunks.join('\n')
}

describe('J1 management journal data model', () => {
  const sql = read(J1)

  it('creates a separate journal domain (pages, participants, tasks, events)', () => {
    expect(sql).toContain('CREATE TABLE public.management_journal_pages')
    expect(sql).toContain('CREATE TABLE public.management_journal_page_participants')
    expect(sql).toContain('CREATE TABLE public.management_journal_tasks')
    expect(sql).toContain('CREATE TABLE public.management_journal_events')
  })

  it('does not reuse requests, meetings, printing, quotations, or audit_logs as the ledger', () => {
    expect(sql).not.toContain('ALTER TABLE public.requests')
    expect(sql).not.toContain('ALTER TABLE public.meetings')
    expect(sql).not.toContain('INSERT INTO public.audit_logs')
    expect(sql).not.toContain('request_handler_history')
    expect(sql).not.toContain('FROM public.requests')
    expect(sql).not.toContain('FROM public.meetings')
  })

  it('shared uniqueness is one shared page per institution per journal_date', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX management_journal_pages_one_shared_per_institution_date')
    expect(sql).toContain('ON public.management_journal_pages (institution_id, journal_date)')
    expect(sql).toContain("WHERE page_type = 'shared'")
  })

  it('personal uniqueness is one personal page per owner per journal_date', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX management_journal_pages_one_personal_per_owner_date')
    expect(sql).toContain(
      'ON public.management_journal_pages (institution_id, owner_user_id, journal_date)',
    )
    expect(sql).toContain("WHERE page_type = 'personal'")
  })

  it('does not use UNIQUE(institution_id, journal_date) without page_type predicate', () => {
    expect(sql).not.toMatch(
      /UNIQUE\s*\(\s*institution_id\s*,\s*journal_date\s*\)\s*;/,
    )
  })

  it('journal_date is DATE and Asia/Jerusalem is the timezone contract', () => {
    expect(sql).toContain('journal_date         DATE NOT NULL')
    expect(sql).toContain("AT TIME ZONE 'Asia/Jerusalem'")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.management_journal_current_date()')
  })

  it('task statuses are exactly new/in_progress/completed/blocked', () => {
    expect(sql).toContain("CHECK (status IN ('new', 'in_progress', 'completed', 'blocked'))")
  })

  it('carried tasks uniquely reference origin_task_id per destination page', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX management_journal_tasks_one_origin_per_page')
    expect(sql).toContain('ON public.management_journal_tasks (page_id, origin_task_id)')
    expect(sql).toContain('WHERE origin_task_id IS NOT NULL')
  })

  it('new tasks require a responsible user; carried tasks may be unassigned', () => {
    expect(sql).toContain('carried_forward = FALSE')
    expect(sql).toContain('responsible_user_id IS NOT NULL')
    expect(sql).toContain('carried_forward = TRUE')
  })

  it('has no participant-remove or task-delete RPC', () => {
    expect(sql).not.toMatch(/remove_.*participant/i)
    expect(sql).not.toMatch(/delete_management_journal_task/i)
    expect(sql).not.toContain('DELETE FROM public.management_journal')
  })
})

describe('J1 authorization matrix', () => {
  const sql = read(J1)
  const sharedCreate = functionBody(sql, 'management_journal_create_shared_page_for_date')
  const personalCreate = functionBody(sql, 'management_journal_create_personal_page_for_date')
  const addParticipant = functionBody(sql, 'add_management_journal_page_participant')
  const createTask = functionBody(sql, 'create_management_journal_task')
  const assign = functionBody(sql, 'assign_management_journal_task')
  const status = functionBody(sql, 'update_management_journal_task_status')
  const content = functionBody(sql, 'update_management_journal_task_content')
  const note = functionBody(sql, 'update_management_journal_task_note')
  const canAssign = functionBody(sql, 'management_journal_can_assign')
  const canRead = functionBody(sql, 'auth_user_can_read_management_journal_page')

  it('shared pages may be created only by active manager or deputy', () => {
    expect(sharedCreate).toContain("'institution_manager'::public.user_role")
    expect(sharedCreate).toContain("'deputy'::public.user_role")
    expect(sharedCreate).not.toContain("'secretary'::public.user_role")
  })

  it('shared creator is automatically a participant', () => {
    expect(sharedCreate).toContain('management_journal_add_participant_internal')
    expect(sharedCreate).toContain('v_caller')
  })

  it('personal pages may be created by manager/deputy/secretary via require_active_management_caller', () => {
    expect(personalCreate).toContain('management_journal_require_active_management_caller')
    expect(personalCreate).toContain("page_type")
    expect(personalCreate).toContain("'personal'")
    expect(personalCreate).toContain('owner_user_id')
  })

  it('personal create fails closed if caller is not active after lock', () => {
    expect(personalCreate).toContain('FOR UPDATE')
    expect(personalCreate).toContain("v_caller.status <> 'active'")
  })

  it('shared visibility is participant-only with no Manager override', () => {
    expect(canRead).toContain("v_page.page_type = 'personal'")
    expect(canRead).toContain('v_page.owner_user_id = v_actor')
    expect(canRead).toContain('management_journal_page_participants')
    expect(canRead).not.toContain('auth_user_is_active_institution_manager_for_institution')
  })

  it('Teacher and Platform Admin are denied (management-role gate)', () => {
    expect(sql).toContain('management_journal_is_management_role')
    const roleFn = functionBody(sql, 'management_journal_is_management_role')
    expect(roleFn).toContain('institution_manager')
    expect(roleFn).toContain('deputy')
    expect(roleFn).toContain('secretary')
    expect(roleFn).not.toContain('teacher')
    expect(roleFn).not.toContain('platform_admin')
  })

  it('assignment hierarchy: manager self/deputy/secretary; deputy self/secretary; secretary self', () => {
    expect(canAssign).toContain("p_actor_role = 'institution_manager'")
    expect(canAssign).toContain("'deputy'::public.user_role")
    expect(canAssign).toContain("'secretary'::public.user_role")
    expect(canAssign).toContain("p_actor_role = 'deputy'")
    expect(canAssign).toContain("p_actor_role = 'secretary'")
    expect(canAssign).toContain('p_target_user_id = p_actor_user_id')
  })

  it('shared create/assign require target to be a page participant', () => {
    expect(createTask).toContain('management_journal_page_participants')
    expect(assign).toContain('management_journal_page_participants')
  })

  it('personal assignment is owner-only', () => {
    expect(createTask).toContain('v_target.id <> v_page.owner_user_id')
    expect(assign).toContain('v_target.id <> v_page.owner_user_id')
  })

  it('task content is creator-only', () => {
    expect(content).toContain('v_task.created_by_user_id <> v_caller.id')
  })

  it('note and status are responsible-only with no Manager override', () => {
    expect(note).toContain('v_task.responsible_user_id IS DISTINCT FROM v_caller.id')
    expect(status).toContain('v_task.responsible_user_id IS DISTINCT FROM v_caller.id')
    expect(status).not.toContain('institution_manager')
    expect(note).not.toContain('institution_manager')
  })

  it('status uses compare-and-set on expected previous status', () => {
    expect(status).toContain('AND status = p_expected_status')
    expect(status).toContain('journal_stale_status')
    expect(status).toContain('FOR UPDATE')
  })

  it('participant add is append-only and manager/deputy gated', () => {
    expect(sql).toContain('ON CONFLICT (page_id, user_id) DO NOTHING')
    expect(addParticipant).toContain("'institution_manager'")
    expect(addParticipant).toContain("'deputy'")
  })
})

describe('J1 freeze and carry-forward', () => {
  const sql = read(J1)
  const freeze = functionBody(sql, 'management_journal_page_is_frozen')
  const writable = functionBody(sql, 'management_journal_assert_page_writable')
  const carry = functionBody(sql, 'management_journal_carry_into_page')
  const sharedCreate = functionBody(sql, 'management_journal_create_shared_page_for_date')
  const personalCreate = functionBody(sql, 'management_journal_create_personal_page_for_date')

  it('shared freeze is a newer shared page for the same institution', () => {
    expect(freeze).toContain("newer.page_type = 'shared'")
    expect(freeze).toContain('newer.journal_date > p_page.journal_date')
  })

  it('personal freeze is a newer personal page for the same owner', () => {
    expect(freeze).toContain("newer.page_type = 'personal'")
    expect(freeze).toContain('newer.owner_user_id = p_page.owner_user_id')
  })

  it('writable mutations fail closed on frozen pages', () => {
    expect(writable).toContain('journal_page_frozen')
    expect(writable).toContain('management_journal_page_is_frozen')
  })

  it('copy-on-carry copies incomplete statuses and skips completed', () => {
    expect(carry).toContain("status IN ('new', 'in_progress', 'blocked')")
    expect(carry).not.toContain("'completed'")
    expect(carry).toContain('carried_forward')
    expect(carry).toContain('origin_task_id')
    expect(carry).toContain('origin_page_id')
    expect(carry).toContain('INSERT INTO public.management_journal_tasks')
    expect(carry).not.toContain('DELETE FROM public.management_journal_tasks')
  })

  it('shared carry keeps active assignee and auto-adds participant', () => {
    expect(carry).toContain('management_journal_add_participant_internal')
    expect(carry).toContain('TRUE')
    expect(carry).toContain("v_target.status = 'active'")
  })

  it('inactive/ineligible assignee is carried unassigned', () => {
    expect(carry).toContain('v_responsible := NULL')
    expect(carry).toContain('unassigned_inactive_assignee')
    expect(carry).toContain('previous_responsible_user_id')
  })

  it('carry runs inside page creation, not as a public loop RPC', () => {
    expect(sharedCreate).toContain('management_journal_carry_into_page')
    expect(personalCreate).toContain('management_journal_carry_into_page')
    expect(grantsFor(sql, 'management_journal_carry_into_page')).toContain('REVOKE ALL')
    expect(grantsFor(sql, 'management_journal_carry_into_page')).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.management_journal_carry_into_page/,
    )
  })

  it('prior page in the same stream is selected by latest journal_date, not yesterday', () => {
    expect(carry).toContain('journal_date < p_new_page.journal_date')
    expect(carry).toContain('ORDER BY journal_date DESC')
  })
})

describe('J1 server-authoritative journal date', () => {
  const sql = read(J1)
  const publicShared = functionBody(sql, 'create_management_journal_shared_page')
  const publicPersonal = functionBody(sql, 'create_management_journal_personal_page')
  const datedShared = functionBody(sql, 'management_journal_create_shared_page_for_date')
  const datedPersonal = functionBody(sql, 'management_journal_create_personal_page_for_date')

  it('public shared-page create accepts no client date', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.create_management_journal_shared_page(')
    expect(sql).toContain('p_participant_user_ids UUID[] DEFAULT ARRAY[]::UUID[]')
    expect(publicShared).not.toContain('p_journal_date')
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_management_journal_shared_page\(\s*p_journal_date DATE/s,
    )
  })

  it('public personal-page create accepts no client date', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.create_management_journal_personal_page()')
    expect(publicPersonal).not.toContain('p_journal_date')
  })

  it('journal_date is derived from the Asia/Jerusalem DB helper', () => {
    expect(publicShared).toContain('management_journal_current_date()')
    expect(publicPersonal).toContain('management_journal_current_date()')
    expect(sql).toContain("AT TIME ZONE 'Asia/Jerusalem'")
  })

  it('browser cannot create a past or future page via public RPC', () => {
    expect(publicShared).not.toContain('p_journal_date')
    expect(publicPersonal).not.toContain('p_journal_date')
    expect(publicShared).toContain('management_journal_create_shared_page_for_date')
    expect(publicPersonal).toContain('management_journal_create_personal_page_for_date')
  })

  it('dated helpers are not executable by authenticated clients', () => {
    expect(grantsFor(sql, 'management_journal_create_shared_page_for_date')).toContain(
      'FROM authenticated',
    )
    expect(grantsFor(sql, 'management_journal_create_shared_page_for_date')).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.management_journal_create_shared_page_for_date/,
    )
    expect(grantsFor(sql, 'management_journal_create_personal_page_for_date')).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.management_journal_create_personal_page_for_date/,
    )
  })

  it('current-day uniqueness is preserved and open is idempotent when safe', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX management_journal_pages_one_shared_per_institution_date')
    expect(sql).toContain('CREATE UNIQUE INDEX management_journal_pages_one_personal_per_owner_date')
    expect(datedShared).toContain("'unchanged', true")
    expect(datedPersonal).toContain("'unchanged', true")
  })

  it('public APIs cannot insert out-of-order historical pages', () => {
    expect(publicShared).toContain('management_journal_current_date()')
    expect(publicPersonal).toContain('management_journal_current_date()')
    expect(datedShared).toContain('journal_date = p_journal_date')
  })
})

describe('J1 concurrency, ACL, history', () => {
  const sql = read(J1)
  const assign = functionBody(sql, 'assign_management_journal_task')
  const carry = functionBody(sql, 'management_journal_carry_into_page')

  it('assign locks users FOR UPDATE before the task FOR UPDATE', () => {
    const userLock = assign.indexOf('management_journal_lock_validate_target_user')
    const taskForUpdate = assign.indexOf('FOR UPDATE', assign.indexOf('FROM public.management_journal_tasks'))
    const secondTask = assign.lastIndexOf('FROM public.management_journal_tasks')
    const taskLock = assign.indexOf('FOR UPDATE', secondTask)
    expect(userLock).toBeGreaterThan(0)
    expect(taskLock).toBeGreaterThan(userLock)
    expect(taskForUpdate).toBeGreaterThan(0)
  })

  it('carry locks assignee users before source tasks', () => {
    const usersLock = carry.indexOf('FROM public.users AS u')
    const taskLock = carry.indexOf('FROM public.management_journal_tasks')
    expect(usersLock).toBeGreaterThan(0)
    expect(taskLock).toBeGreaterThan(usersLock)
    expect(carry).toContain('FOR UPDATE OF u')
  })

  it('authenticated has SELECT only — no INSERT/UPDATE/DELETE grants on journal tables', () => {
    expect(sql).toContain('GRANT SELECT ON TABLE public.management_journal_pages TO authenticated')
    expect(sql).toContain('GRANT SELECT ON TABLE public.management_journal_tasks TO authenticated')
    expect(sql).toContain('GRANT SELECT ON TABLE public.management_journal_events TO authenticated')
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE)\b/i)
  })

  it('updated_at trigger function is closed to PUBLIC, anon, and authenticated', () => {
    const grants = grantsFor(sql, 'management_journal_set_updated_at')
    expect(grants).toContain('REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM PUBLIC')
    expect(grants).toContain('REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM anon')
    expect(grants).toContain(
      'REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM authenticated',
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.management_journal_set_updated_at/,
    )
    expect(sql).toContain(
      'EXECUTE PROCEDURE public.management_journal_set_updated_at()',
    )
  })

  it('history writer is not executable by authenticated', () => {
    const grants = grantsFor(sql, 'management_journal_history_write')
    expect(grants).toContain('REVOKE ALL')
    expect(grants).toContain('FROM authenticated')
    expect(grants).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.management_journal_history_write/)
  })

  it('public mutation RPCs are granted to authenticated and revoked from anon/PUBLIC', () => {
    for (const name of [
      'create_management_journal_shared_page',
      'create_management_journal_personal_page',
      'add_management_journal_page_participant',
      'create_management_journal_task',
      'update_management_journal_task_content',
      'update_management_journal_task_note',
      'assign_management_journal_task',
      'update_management_journal_task_status',
    ]) {
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}`)
    }
  })

  it('does not grant authenticated UPDATE on public.users or broaden users ACL', () => {
    expect(sql).not.toMatch(/GRANT[\s\S]{0,40}ON(\s+TABLE)?\s+public\.users/i)
    expect(sql).not.toContain('users_table_acl')
    const acl = read(ACL)
    expect(acl).toContain('GRANT SELECT (')
  })

  it('RLS uses membership/owner visibility helper', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('auth_user_can_read_management_journal_page(id)')
    expect(sql).toContain('auth_user_can_read_management_journal_page(page_id)')
  })

  it('journal events cover required action types', () => {
    for (const eventType of [
      'page_created',
      'participant_added',
      'participant_added_automatic',
      'task_created',
      'task_content_edited',
      'task_assigned',
      'task_status_changed',
      'task_note_changed',
      'task_carried_forward',
    ]) {
      expect(sql).toContain(`'${eventType}'`)
    }
  })
})

describe('J1 isolation from other domains', () => {
  const sql = read(J1)

  it('does not modify claim/transfer/release or staff deactivate/reactivate', () => {
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.transfer_request_handler')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.release_request_handler')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.deactivate_staff_member')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.reactivate_staff_member')
    expect(read(R1)).toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(read(LOCK)).toContain('CREATE OR REPLACE FUNCTION public.claim_request')
    expect(read(S2)).toContain('CREATE OR REPLACE FUNCTION public.deactivate_staff_member')
    expect(read(S4)).toContain('CREATE OR REPLACE FUNCTION public.reactivate_staff_member')
  })

  it('Phase 3 quotation/PDF paths are untouched', () => {
    for (const token of PHASE3_PATHS) {
      expect(sql).not.toContain(token)
    }
  })

  it('does not add a report RPC or PDF generator', () => {
    expect(sql).not.toContain('create_management_journal_report')
    expect(sql).not.toContain('quotationPdf')
    expect(sql).not.toContain('PDFDocument')
  })
})
