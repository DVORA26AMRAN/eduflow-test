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
const grantHardeningSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20250902120000_printing_rpc_execute_grant_hardening.sql',
  ),
  'utf8',
)

/** Application RPCs: authenticated only after hardening. */
const printingAuthenticatedRpcSignatures = [
  'public.printing_resolve_actor_institution()',
  'public.printing_create_request(TIMESTAMPTZ, JSONB)',
  'public.printing_update_request(UUID, TIMESTAMPTZ, JSONB)',
  'public.printing_cancel_request(UUID, TEXT)',
  'public.printing_claim_request(UUID)',
  'public.printing_release_request(UUID)',
  'public.printing_transfer_request(UUID, UUID)',
  'public.printing_return_item_for_correction(UUID, TEXT)',
  'public.printing_resubmit_item(UUID, JSONB)',
  'public.printing_reject_item(UUID, TEXT)',
  'public.printing_mark_item_printed(UUID)',
  'public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER)',
  'public.printing_validate_required_by(UUID, TIMESTAMPTZ)',
  'public.printing_derive_parent_status(UUID)',
  'public.printing_institution_id_from_storage_path(TEXT)',
  'public.printing_request_id_from_storage_path(TEXT)',
] as const

/** Worker RPCs: service_role only. */
const printingServiceRoleRpcSignatures = [
  'public.printing_dispatch_overdue_notifications(INTEGER)',
  'public.printing_list_retention_purge_candidates(INTEGER)',
  'public.printing_mark_item_file_purged(UUID)',
] as const

/** Internal helpers: revoke client roles; no GRANT EXECUTE. */
const printingInternalHelperSignatures = [
  'public.printing_allocate_request_number(UUID)',
  'public.printing_write_audit(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)',
  'public.printing_sync_parent_status(UUID)',
  'public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB)',
  'public.printing_notify_teacher_item_returned(printing_requests, print_items, TEXT)',
  'public.printing_notify_teacher_item_rejected(printing_requests, print_items, TEXT)',
  'public.printing_notify_teacher_request_completed(printing_requests)',
  'public.printing_require_assigned_processor(printing_requests)',
  'public.printing_fail(TEXT)',
  'public.printing_validate_item_payload(JSONB)',
  'public.printing_allowed_file_types()',
  'public.printing_is_allowed_file_type(TEXT)',
  'public.printing_is_valid_page_selection(TEXT, TEXT)',
  'public.printing_item_transition_allowed(TEXT, TEXT)',
  'public.printing_is_overdue(TIMESTAMPTZ, TEXT, TIMESTAMPTZ)',
  'public.printing_audit_reject_mutation()',
] as const

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

describe('printing RPC EXECUTE grant hardening', () => {
  it('is grant-only and does not rewrite function bodies', () => {
    expect(grantHardeningSql).not.toContain('CREATE OR REPLACE FUNCTION')
    expect(grantHardeningSql).not.toContain('ALTER TABLE')
    expect(grantHardeningSql).toContain('RPC EXECUTE grant hardening')
  })

  it('revokes PUBLIC and anon for every authenticated application RPC and grants authenticated', () => {
    for (const fn of printingAuthenticatedRpcSignatures) {
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`)
      expect(grantHardeningSql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`)
    }
  })

  it('revokes PUBLIC, anon, and authenticated for worker RPCs and grants service_role only', () => {
    for (const fn of printingServiceRoleRpcSignatures) {
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM authenticated`)
      expect(grantHardeningSql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`)
      expect(grantHardeningSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`)
    }
  })

  it('revokes PUBLIC, anon, authenticated, and service_role for internal helpers without client grants', () => {
    for (const fn of printingInternalHelperSignatures) {
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM authenticated`)
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM service_role`)
      expect(grantHardeningSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`)
      expect(grantHardeningSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO anon`)
      expect(grantHardeningSql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`)
    }
  })

  it('covers the Phase 1 reported defect surface including settings and validate helpers', () => {
    for (const fn of [
      'public.printing_create_request(TIMESTAMPTZ, JSONB)',
      'public.printing_update_request(UUID, TIMESTAMPTZ, JSONB)',
      'public.printing_resubmit_item(UUID, JSONB)',
      'public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER)',
      'public.printing_validate_required_by(UUID, TIMESTAMPTZ)',
    ]) {
      expect(grantHardeningSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`)
      expect(grantHardeningSql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`)
    }
  })
})
