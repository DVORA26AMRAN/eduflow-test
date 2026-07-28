import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250729100000_meeting_calendar_google_meet_provision_phase1.sql',
)

describe('Google Meet provision Phase 1 migration — durable outbox + auth', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds meet provision status model on meetings', () => {
    expect(sql).toContain('meet_provision_status')
    expect(sql).toContain("'google_not_connected'")
    expect(sql).toContain("'not_applicable'")
    expect(sql).toContain("'pending'")
    expect(sql).toContain("'ready'")
    expect(sql).toContain("'failed'")
    expect(sql).toContain('google_meet_request_id')
    expect(sql).toContain('google_meet_event_id')
  })

  it('creates Google connection table without exposing secrets to authenticated', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.user_google_connections')
    expect(sql).toContain('refresh_token_ciphertext')
    expect(sql).toContain('refresh_token_nonce')
    expect(sql).toContain('REVOKE ALL ON TABLE public.user_google_connections FROM authenticated')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]*ON public\.user_google_connections[\s\S]*TO authenticated/,
    )
  })

  it('creates durable outbox with unique request_key and claim index', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.meeting_meet_provision_requests')
    expect(sql).toContain("'awaiting_connection'")
    expect(sql).toContain('meeting_meet_provision_requests_request_key_unique')
    expect(sql).toContain('meeting_meet_provision_requests_claim_idx')
    expect(sql).toContain("WHERE status = 'pending'")
    expect(sql).toContain('adoflow-')
  })

  it('writes Meet provision request inside confirm in the same transaction path', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_confirm_meeting')
    expect(sql).toContain('meeting_calendar_sync_meet_provision_request')
    expect(sql).toContain("'confirm'")
    expect(sql).toContain('Never blocked by Google')
    // Confirm must still schedule reminders (Phase 5) and set CONFIRMED before Meet sync.
    const confirmIdx = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.meeting_calendar_confirm_meeting',
    )
    const confirmBody = sql.slice(confirmIdx, confirmIdx + 8000)
    expect(confirmBody).toContain("current_state = 'CONFIRMED'")
    expect(confirmBody).toContain('meeting_calendar_schedule_reminders_for_slot')
    expect(confirmBody).toContain('meeting_calendar_sync_meet_provision_request')
    expect(confirmBody.indexOf("current_state = 'CONFIRMED'")).toBeLessThan(
      confirmBody.indexOf('meeting_calendar_sync_meet_provision_request'),
    )
  })

  it('does not enqueue Google API attempts when owner is disconnected', () => {
    expect(sql).toContain("v_outbox_status := 'awaiting_connection'")
    expect(sql).toContain("v_meeting_status := 'google_not_connected'")
    expect(sql).toContain("'enqueued', (v_outbox_status = 'pending')")
    expect(sql).toContain('meeting_calendar_owner_has_google_connection')
  })

  it('owner request RPC is calendar-owner only and idempotent for ready meetings', () => {
    expect(sql).toContain('meeting_calendar_request_meet_provision')
    expect(sql).toContain('Only the calendar owner may request Google Meet provisioning')
    expect(sql).toContain("'idempotent', true")
    expect(sql).toContain("'GOOGLE_NOT_CONNECTED'")
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.meeting_calendar_request_meet_provision(UUID) TO authenticated')
  })

  it('locks worker and token mutation RPCs to service_role JWT (not current_user)', () => {
    expect(sql).toContain('meeting_calendar_require_service_role_jwt')
    expect(sql).toContain("auth.jwt() ->> 'role'")
    expect(sql).toContain('meeting_calendar_claim_meet_provision_batch')
    expect(sql).toContain('meeting_calendar_complete_meet_provision')
    expect(sql).toContain('meeting_calendar_fail_meet_provision')
    expect(sql).toContain('meeting_calendar_service_upsert_google_connection')
    expect(sql).toContain('meeting_calendar_service_revoke_google_connection')

    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) FROM authenticated',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_claim_meet_provision_batch(INTEGER, INTEGER, TEXT) TO service_role',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) FROM authenticated',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_complete_meet_provision(UUID, TEXT, TEXT) TO service_role',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_fail_meet_provision(UUID, TEXT, INTEGER) FROM authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) FROM authenticated',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_attach_system_meet_url(UUID, TEXT) TO service_role',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_upsert_google_connection',
    )
  })

  it('enforces idempotency: unique request_key, succeeded short-circuit, attach same-URL', () => {
    expect(sql).toContain('UNIQUE (request_key)')
    expect(sql).toContain("v_existing.status = 'succeeded'")
    expect(sql).toContain('ON CONFLICT (request_key) DO UPDATE')
    expect(sql).toContain("'idempotent', true")
    expect(sql).toContain('Meet URL is already attached')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
  })

  it('restricts Google connection status RPC to manager/secretary and returns no tokens', () => {
    expect(sql).toContain('meeting_calendar_assert_google_integration_role')
    expect(sql).toContain("'institution_manager', 'secretary'")
    expect(sql).toContain('meeting_calendar_get_google_connection_status')
    expect(sql).toContain('Never returns Google tokens')

    const statusFnIdx = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_connection_status',
    )
    const statusBody = sql.slice(
      statusFnIdx,
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.meeting_calendar_get_meet_provision_status',
        statusFnIdx,
      ),
    )
    expect(statusBody).toContain("'connected', true")
    expect(statusBody).toContain("'email', v_row.google_account_email")
    expect(statusBody).toMatch(
      /jsonb_build_object\(\s*'ok',\s*true,\s*'connected',\s*true,\s*'email',\s*v_row\.google_account_email\s*\)/,
    )
    expect(statusBody).not.toMatch(/jsonb_build_object\([^)]*refresh_token/)
    expect(statusBody).not.toMatch(/jsonb_build_object\([^)]*ciphertext/)
  })

  it('documents worker-owned processing and does not add pg_cron', () => {
    expect(sql).toContain('meeting-meet-provisioner')
    expect(sql).toContain('No database cron is configured by this migration')
    expect(sql).not.toContain('cron.schedule')
    expect(sql).not.toContain("extname = 'pg_cron'")
  })

  it('does not introduce frontend fire-and-forget as the primary confirm trigger', () => {
    expect(sql).toContain('Frontend fire-and-forget is NOT the trigger')
    expect(sql).toContain('same transaction')
  })
})
