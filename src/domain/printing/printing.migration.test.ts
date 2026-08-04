import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const schemaSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20250804120000_printing_requests_phase1.sql'),
  'utf8',
)
const commandsSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20250804120100_printing_requests_phase1_commands.sql'),
  'utf8',
)

describe('printing requests Phase 1 — schema migration', () => {
  it('creates printing request, items, audit, and number counters', () => {
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS public.printing_requests')
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS public.print_items')
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS public.printing_request_audit_events')
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS public.printing_request_number_counters')
    expect(schemaSql).toContain('request_number')
    expect(schemaSql).toContain('assigned_secretary_user_id')
    expect(schemaSql).toContain('processing_started_at')
    expect(schemaSql).toContain('files_purged_at')
  })

  it('adds institution printing settings with defaults including 90-day retention', () => {
    expect(schemaSql).toContain('minimum_print_notice_minutes')
    expect(schemaSql).toContain('deadline_warning_minutes')
    expect(schemaSql).toContain('file_retention_days')
    expect(schemaSql).toContain('SET DEFAULT 90')
  })

  it('creates a private printing-files bucket with 50MB limit', () => {
    expect(schemaSql).toContain("'printing-files'")
    expect(schemaSql).toContain('public = FALSE')
    expect(schemaSql).toContain('52428800')
  })

  it('enforces RLS teacher isolation and staff institution scope', () => {
    expect(schemaSql).toContain('printing_requests_teacher_select_own')
    expect(schemaSql).toContain('teacher_user_id = auth.uid()')
    expect(schemaSql).toContain('printing_requests_staff_select_institution')
    expect(schemaSql).toContain('auth_user_is_active_secretary_for_institution')
    expect(schemaSql).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(schemaSql).toContain('print_items_teacher_select_own')
    expect(schemaSql).toContain('print_items_staff_select_institution')
  })

  it('does not grant authenticated INSERT/UPDATE/DELETE on printing tables', () => {
    expect(schemaSql).toContain('REVOKE ALL ON TABLE public.printing_requests FROM authenticated')
    expect(schemaSql).toContain('REVOKE ALL ON TABLE public.print_items FROM authenticated')
    expect(schemaSql).toContain(
      'REVOKE ALL ON TABLE public.printing_request_audit_events FROM authenticated',
    )
    expect(schemaSql).toContain('GRANT SELECT ON public.printing_requests TO authenticated')
    expect(schemaSql).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE).*ON public\.printing_requests TO authenticated/,
    )
  })

  it('keeps audit append-only via triggers', () => {
    expect(schemaSql).toContain('printing_audit_reject_mutation')
    expect(schemaSql).toContain('printing_audit_no_update')
    expect(schemaSql).toContain('printing_audit_no_delete')
  })

  it('scopes storage policies to own teacher or institution staff', () => {
    expect(schemaSql).toContain('printing_files_teacher_select')
    expect(schemaSql).toContain('printing_files_teacher_insert')
    expect(schemaSql).toContain('printing_files_staff_select')
    expect(schemaSql).toContain("bucket_id = 'printing-files'")
  })

  it('centralizes allowed MIME types and page selection validation', () => {
    expect(schemaSql).toContain('printing_allowed_file_types')
    expect(schemaSql).toContain('printing_is_valid_page_selection')
    expect(schemaSql).toContain('application/pdf')
    expect(schemaSql).toContain('image/heic')
  })
})

describe('printing requests Phase 1 — command RPCs', () => {
  it('exposes typed command RPCs for required Phase 1 operations', () => {
    for (const name of [
      'printing_create_request',
      'printing_update_request',
      'printing_cancel_request',
      'printing_claim_request',
      'printing_release_request',
      'printing_transfer_request',
      'printing_return_item_for_correction',
      'printing_resubmit_item',
      'printing_reject_item',
      'printing_mark_item_printed',
      'printing_update_institution_settings',
    ]) {
      expect(commandsSql).toContain(`CREATE OR REPLACE FUNCTION public.${name}`)
      expect(commandsSql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}`,
      )
    }
  })

  it('returns machine-readable error_code contracts', () => {
    const combined = `${schemaSql}\n${commandsSql}`
    for (const code of [
      'PRINT_REQUEST_TOO_LATE',
      'PRINT_REQUEST_LOCKED',
      'PRINT_REQUEST_NOT_FOUND',
      'PRINT_REQUEST_FORBIDDEN',
      'PRINT_REQUEST_ALREADY_CLAIMED',
      'PRINT_ITEM_LIMIT_EXCEEDED',
      'PRINT_FILE_TOO_LARGE',
      'PRINT_FILE_TYPE_NOT_ALLOWED',
      'INVALID_PRINT_SETTINGS',
      'INVALID_STATUS_TRANSITION',
      'SECRETARY_NOT_AUTHORIZED',
      'CROSS_INSTITUTION_ACCESS_DENIED',
    ]) {
      expect(combined).toContain(`'${code}'`)
    }
    expect(commandsSql).toContain("'error_code'")
  })

  it('claims atomically with FOR UPDATE and assigned_secretary IS NULL guard', () => {
    const claimIdx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_claim_request',
    )
    const claimBody = commandsSql.slice(claimIdx, claimIdx + 4500)
    expect(claimBody).toContain('FOR UPDATE')
    expect(claimBody).toContain('assigned_secretary_user_id IS NULL')
    expect(claimBody).toContain('PRINT_REQUEST_ALREADY_CLAIMED')
    expect(claimBody).toContain('secretary_claimed')
  })

  it('locks teacher edit/cancel after processing begins', () => {
    const updateIdx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_update_request',
    )
    const updateBody = commandsSql.slice(updateIdx, updateIdx + 3500)
    expect(updateBody).toContain('PRINT_REQUEST_LOCKED')
    expect(updateBody).toContain('processing_started_at IS NOT NULL')
    expect(updateBody).toContain('assigned_secretary_user_id IS NOT NULL')

    const cancelIdx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_cancel_request',
    )
    const cancelBody = commandsSql.slice(cancelIdx, cancelIdx + 2500)
    expect(cancelBody).toContain('PRINT_REQUEST_LOCKED')
    expect(cancelBody).toContain("status = 'cancelled'")
  })

  it('rejects cross-institution transfer and unauthorized targets', () => {
    const transferIdx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_transfer_request',
    )
    const body = commandsSql.slice(transferIdx, transferIdx + 4000)
    expect(body).toContain('CROSS_INSTITUTION_ACCESS_DENIED')
    expect(body).toContain("primary_role IS DISTINCT FROM 'secretary'")
    expect(body).toContain('secretary_transferred')
  })

  it('derives parent status on the backend and audits completion', () => {
    expect(schemaSql).toContain('printing_derive_parent_status')
    expect(schemaSql).toContain('printing_sync_parent_status')
    expect(commandsSql).toContain('parent_request_completed')
    expect(commandsSql).toContain('item_marked_printed')
    expect(commandsSql).toContain('item_returned_for_correction')
  })

  it('validates required_by against institution minimum_print_notice_minutes', () => {
    expect(schemaSql).toContain('printing_validate_required_by')
    expect(schemaSql).toContain('minimum_print_notice_minutes')
    expect(schemaSql).toContain('PRINT_REQUEST_TOO_LATE')
    expect(schemaSql).toContain('make_interval(mins => v_notice)')
  })

  it('does not auto-release assignments on inactivity', () => {
    expect(commandsSql).not.toContain('auto_release')
    expect(commandsSql).not.toContain('inactivity')
    const releaseIdx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_release_request',
    )
    const body = commandsSql.slice(releaseIdx, releaseIdx + 2500)
    expect(body).toContain('secretary_released')
    expect(body).toContain('keep processing_started_at')
  })

  it('restricts institution settings updates to secretary/manager', () => {
    const idx = commandsSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.printing_update_institution_settings',
    )
    const body = commandsSql.slice(idx, idx + 3000)
    expect(body).toContain('auth_user_is_active_secretary_for_institution')
    expect(body).toContain('auth_user_is_active_institution_manager_for_institution')
    expect(body).toContain('SECRETARY_NOT_AUTHORIZED')
  })
})
