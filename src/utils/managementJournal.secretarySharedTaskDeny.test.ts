/**
 * Secretary shared-page task create/assign deny — forward-only migration contract.
 * Source analysis only. Does not apply SQL.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const HARDENING = 'supabase/migrations/20250820108000_management_journal_secretary_shared_task_create_deny.sql'
const ACL = 'supabase/migrations/20250818102500_users_table_acl_hardening.sql'

const PHASE3_MARKERS = [
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

function sharedBranch(body: string): string {
  const personalIdx = body.indexOf("IF v_page.page_type = 'personal' THEN")
  expect(personalIdx).toBeGreaterThan(0)
  const elseMatch = body.slice(personalIdx).match(/\r?\n\s+ELSE\r?\n/)
  expect(elseMatch).toBeTruthy()
  const elseIdx = personalIdx + (elseMatch?.index ?? 0)
  const afterElse = body.slice(elseIdx)
  const endMarker = afterElse.includes('SELECT COALESCE(MAX(sort_order)')
    ? 'SELECT COALESCE(MAX(sort_order)'
    : 'v_previous :='
  const endRel = afterElse.indexOf(endMarker)
  expect(endRel).toBeGreaterThan(0)
  return afterElse.slice(0, endRel)
}

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, '\n')
}

function secretarySharedDeny(branch: string): boolean {
  const normalized = normalizeSql(branch)
  return (
    normalized.includes("v_caller.primary_role = 'secretary'::public.user_role") &&
    normalized.includes("RAISE EXCEPTION 'Permission denied.'") &&
    normalized.includes("ERRCODE = '42501'")
  )
}

describe('108000 secretary shared task create/assign deny', () => {
  const sql = read(HARDENING)
  const j1 = read(J1)
  const createTask = functionBody(sql, 'create_management_journal_task')
  const assignTask = functionBody(sql, 'assign_management_journal_task')
  const createShared = sharedBranch(createTask)
  const assignShared = sharedBranch(assignTask)
  const createPersonal = createTask.slice(
    createTask.indexOf("IF v_page.page_type = 'personal' THEN"),
    createTask.indexOf('ELSE', createTask.indexOf("IF v_page.page_type = 'personal' THEN")),
  )
  const assignPersonal = assignTask.slice(
    assignTask.indexOf("IF v_page.page_type = 'personal' THEN"),
    assignTask.indexOf('ELSE', assignTask.indexOf("IF v_page.page_type = 'personal' THEN")),
  )

  it('replaces only create and assign public RPCs with the same signatures', () => {
    const normalized = normalizeSql(sql)
    expect(normalized).toContain(
      'CREATE OR REPLACE FUNCTION public.create_management_journal_task(\n    p_page_id UUID,\n    p_title TEXT,\n    p_responsible_user_id UUID,\n    p_details TEXT DEFAULT NULL,\n    p_target_time TIME DEFAULT NULL\n)',
    )
    expect(normalized).toContain(
      'CREATE OR REPLACE FUNCTION public.assign_management_journal_task(\n    p_task_id UUID,\n    p_target_user_id UUID\n)',
    )
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_management_journal_task_status')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_management_journal_task_note')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_management_journal_task_content')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.management_journal_can_assign')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.add_management_journal_page_participant')
  })

  it('denies secretary shared create with Permission denied / 42501', () => {
    expect(secretarySharedDeny(createShared)).toBe(true)
  })

  it('denies secretary shared assign/reassign with Permission denied / 42501', () => {
    expect(secretarySharedDeny(assignShared)).toBe(true)
  })

  it('preserves manager/deputy shared create participant + can_assign checks', () => {
    expect(createShared).toContain('management_journal_page_participants')
    expect(createShared).toContain('management_journal_can_assign')
    expect(createShared).toContain('v_caller.primary_role')
    expect(createShared).toContain('v_target.primary_role')
  })

  it('preserves manager/deputy shared assign participant + can_assign checks', () => {
    expect(assignShared).toContain('management_journal_page_participants')
    expect(assignShared).toContain('management_journal_can_assign')
  })

  it('preserves personal-page owner create / self-assignment semantics', () => {
    expect(createPersonal).toContain('v_target.id <> v_page.owner_user_id')
    expect(createPersonal).toContain('v_caller.id <> v_page.owner_user_id')
    expect(createPersonal).not.toContain("'secretary'::public.user_role")
    expect(assignPersonal).toContain('v_target.id <> v_page.owner_user_id')
    expect(assignPersonal).toContain('v_caller.id <> v_page.owner_user_id')
    expect(assignPersonal).not.toContain("'secretary'::public.user_role")
  })

  it('does not rewrite status or note RPCs (secretary responsible path unchanged by this file)', () => {
    expect(sql).not.toContain('update_management_journal_task_status')
    expect(sql).not.toContain('update_management_journal_task_note')
    expect(j1).toContain('CREATE OR REPLACE FUNCTION public.update_management_journal_task_status')
    expect(j1).toContain('CREATE OR REPLACE FUNCTION public.update_management_journal_task_note')
    const statusBody = functionBody(j1, 'update_management_journal_task_status')
    const noteBody = functionBody(j1, 'update_management_journal_task_note')
    expect(statusBody).toContain('v_task.responsible_user_id IS DISTINCT FROM v_caller.id')
    expect(noteBody).toContain('v_task.responsible_user_id IS DISTINCT FROM v_caller.id')
  })

  it('keeps SECURITY DEFINER, search_path, and execute grants', () => {
    for (const body of [createTask, assignTask]) {
      expect(body).toContain('SECURITY DEFINER')
      expect(body).toContain('SET search_path = public')
    }
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM PUBLIC',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM anon',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) TO authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM PUBLIC',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM anon',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.assign_management_journal_task(UUID, UUID) TO authenticated',
    )
  })

  it('makes no RLS or users ACL changes', () => {
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('ALTER POLICY')
    expect(sql).not.toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).not.toContain('ALTER TABLE public.users')
    expect(sql).not.toContain('GRANT SELECT ON TABLE public.users')
    expect(read(ACL)).toContain('users')
  })

  it('does not touch Phase 3 quotation artifacts', () => {
    for (const marker of PHASE3_MARKERS) {
      expect(sql).not.toContain(marker)
    }
  })

  it('leaves 107000 unchanged (forward-only; no secretary shared deny in J1 create/assign)', () => {
    const j1CreateShared = sharedBranch(functionBody(j1, 'create_management_journal_task'))
    const j1AssignShared = sharedBranch(functionBody(j1, 'assign_management_journal_task'))
    expect(secretarySharedDeny(j1CreateShared)).toBe(false)
    expect(secretarySharedDeny(j1AssignShared)).toBe(false)
    expect(j1).not.toContain('Shared: Secretary may read/work assigned tasks but must not create')
    expect(j1).not.toContain('Shared: Secretary may not assign or reassign tasks')
    const hash = createHash('sha256').update(j1).digest('hex')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(sql).not.toContain('CREATE TABLE public.management_journal_pages')
  })
})
