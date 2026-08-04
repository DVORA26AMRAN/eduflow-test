import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mergeOwnerGoogleConnectionForMeetUi,
  resolveMeetProvisionUi,
  shouldShowGoogleReauthorization,
} from './meetingMeetProvisionUi'

const phase1Path = resolve(
  process.cwd(),
  'supabase/migrations/20250729100000_meeting_calendar_google_meet_provision_phase1.sql',
)
const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250729140000_meeting_calendar_google_meet_provision_phase4.sql',
)
const staleReauthMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250801120000_clear_stale_meet_reauth_on_google_reconnect.sql',
)

function extractCreateOrReplaceFunction(sql: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const afterParen = start + marker.length
  const closingParen = sql.indexOf(')', afterParen)
  expect(closingParen).toBeGreaterThan(afterParen)
  // Include signature through RETURNS line for default comparisons.
  const returnsIdx = sql.indexOf('RETURNS', closingParen)
  expect(returnsIdx).toBeGreaterThan(closingParen)
  return sql.slice(start, returnsIdx).replace(/\s+/g, ' ').trim()
}

describe('meeting calendar Google Meet Phase 4 migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const phase1 = readFileSync(phase1Path, 'utf8')

  it('adds Meet provision audit event types', () => {
    expect(migration).toContain('MEET_PROVISION_REQUESTED')
    expect(migration).toContain('MEET_PROVISION_STARTED')
    expect(migration).toContain('MEET_PROVISION_READY')
    expect(migration).toContain('MEET_PROVISION_FAILED')
    expect(migration).toContain('MEET_PROVISION_RETRY')
    expect(migration).toContain('MEET_REAUTH_REQUIRED')
  })

  it('sanitizes audit metadata and never allows token or Meet URL keys', () => {
    expect(migration).toContain('meeting_calendar_sanitize_meet_audit_metadata')
    expect(migration).toContain('meeting_calendar_write_meet_provision_audit')
    expect(migration).toMatch(/token|refresh|meet_url|authorization/)
    expect(migration).toContain("'trigger_source'")
    expect(migration).toContain("'error_code'")
  })

  it('wires audits into sync/claim/complete/fail paths', () => {
    expect(migration).toContain("v_audit_event := CASE")
    expect(migration).toContain("'MEET_PROVISION_STARTED'")
    expect(migration).toContain("'MEET_PROVISION_READY'")
    expect(migration).toContain("'MEET_PROVISION_FAILED'")
    expect(migration).toContain("'MEET_REAUTH_REQUIRED'")
  })

  it('exposes owner connection status on live context without tokens', () => {
    expect(migration).toContain('owner_google_connection_status')
    expect(migration).toContain('meeting_calendar_owner_google_connection_status')
    expect(migration).toContain('is_calendar_owner')
    const liveContextFn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.meeting_calendar_get_live_context'),
    )
    expect(liveContextFn).toContain("'owner_google_connection_status', v_owner_connection_status")
    expect(liveContextFn).not.toMatch(/'refresh_token/)
    expect(liveContextFn).not.toMatch(/'access_token/)
    expect(liveContextFn).not.toMatch(/'authorization_code/)
  })

  it('preserves Phase 1 parameter defaults on CREATE OR REPLACE upgrade path (42P13)', () => {
    const phase1Sync = extractCreateOrReplaceFunction(
      phase1,
      'meeting_calendar_sync_meet_provision_request',
    )
    const phase4Sync = extractCreateOrReplaceFunction(
      migration,
      'meeting_calendar_sync_meet_provision_request',
    )

    expect(phase1Sync).toContain('p_previous_confirmed_slot_id UUID DEFAULT NULL')
    expect(phase1Sync).toContain("p_trigger_source TEXT DEFAULT 'confirm'")
    expect(phase4Sync).toContain('p_previous_confirmed_slot_id UUID DEFAULT NULL')
    expect(phase4Sync).toContain("p_trigger_source TEXT DEFAULT 'confirm'")

    // Must not redefine without defaults (PostgreSQL ERROR 42P13).
    expect(phase4Sync).not.toMatch(
      /p_previous_confirmed_slot_id UUID,\s*p_trigger_source TEXT\s*\)/,
    )
    expect(migration).not.toMatch(/DROP FUNCTION[\s\S]*meeting_calendar_sync_meet_provision_request[\s\S]*CASCADE/i)

    // Other replaced worker RPCs must keep Phase 1 defaults too.
    const claimP4 = extractCreateOrReplaceFunction(
      migration,
      'meeting_calendar_claim_meet_provision_batch',
    )
    expect(claimP4).toContain('p_limit INTEGER DEFAULT 10')
    expect(claimP4).toContain('p_lease_seconds INTEGER DEFAULT 60')
    expect(claimP4).toContain("p_worker_id TEXT DEFAULT 'meet-provisioner'")

    const completeP4 = extractCreateOrReplaceFunction(
      migration,
      'meeting_calendar_complete_meet_provision',
    )
    expect(completeP4).toContain('p_google_event_id TEXT DEFAULT NULL')

    const failP4 = extractCreateOrReplaceFunction(
      migration,
      'meeting_calendar_fail_meet_provision',
    )
    expect(failP4).toContain('p_retry_delay_seconds INTEGER DEFAULT 0')
  })

  it('is safe to rerun after a failed mid-migration attempt', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS meeting_audit_events_type_valid')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_sanitize_meet_audit_metadata')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_write_meet_provision_audit')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_owner_google_connection_status')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.meeting_calendar_sync_meet_provision_request')
  })
})

describe('resolveMeetProvisionUi', () => {
  const base = {
    meetingFormat: 'online' as const,
    meetUrl: null as string | null,
    meetProvisionStatus: 'google_not_connected' as const,
    meetProvisionError: null as string | null,
    ownerGoogleConnected: false,
    ownerGoogleConnectionStatus: 'not_connected' as const,
    canRequestMeetProvision: true,
    isCalendarOwner: true,
    primaryActionAvailable: false,
  }

  it('maps the five Meeting Details Meet states', () => {
    expect(resolveMeetProvisionUi(base).kind).toBe('not_connected')
    expect(
      resolveMeetProvisionUi({
        ...base,
        ownerGoogleConnectionStatus: 'reauthorization_required',
        meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      }).kind,
    ).toBe('reauthorization_required')
    expect(
      resolveMeetProvisionUi({
        ...base,
        meetProvisionStatus: 'pending',
        ownerGoogleConnected: true,
        ownerGoogleConnectionStatus: 'connected',
      }).kind,
    ).toBe('creating')
    expect(
      resolveMeetProvisionUi({
        ...base,
        meetProvisionStatus: 'ready',
        meetUrl: 'https://meet.google.com/abc-defg-hij',
        ownerGoogleConnected: true,
        ownerGoogleConnectionStatus: 'connected',
        primaryActionAvailable: true,
      }),
    ).toMatchObject({ kind: 'ready', showStartMeeting: true })
    expect(
      resolveMeetProvisionUi({
        ...base,
        meetProvisionStatus: 'failed',
        ownerGoogleConnected: true,
        ownerGoogleConnectionStatus: 'connected',
      }).kind,
    ).toBe('failed')
  })

  it('offers create Meet after Google is connected', () => {
    const ui = resolveMeetProvisionUi({
      ...base,
      meetProvisionStatus: 'google_not_connected',
      ownerGoogleConnected: true,
      ownerGoogleConnectionStatus: 'connected',
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })
    expect(ui.kind).toBe('create_available')
    expect(ui.showCreateMeet).toBe(true)
  })

  it('does not hide an active Google connection behind stale meeting reauth state', () => {
    const ui = resolveMeetProvisionUi({
      ...base,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      ownerGoogleConnected: true,
      ownerGoogleConnectionStatus: 'connected',
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })

    expect(shouldShowGoogleReauthorization({
      meetUrl: null,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      ownerGoogleConnected: true,
      ownerGoogleConnectionStatus: 'connected',
    })).toBe(false)
    expect(ui.kind).toBe('create_available')
    expect(ui.showCreateMeet).toBe(true)
    expect(ui.showConnectGoogle).toBe(false)
  })

  it('still shows Connect Google when the live connection requires reauthorization', () => {
    const ui = resolveMeetProvisionUi({
      ...base,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      ownerGoogleConnected: false,
      ownerGoogleConnectionStatus: 'reauthorization_required',
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })

    expect(shouldShowGoogleReauthorization({
      meetUrl: null,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      ownerGoogleConnected: false,
      ownerGoogleConnectionStatus: 'reauthorization_required',
    })).toBe(true)
    expect(ui.kind).toBe('reauthorization_required')
    expect(ui.showConnectGoogle).toBe(true)
    expect(ui.showCreateMeet).toBe(false)
  })

  it('offers create Meet after successful reconnection clears stale meeting error', () => {
    const beforeReconnect = resolveMeetProvisionUi({
      ...base,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: 'REAUTHORIZATION_REQUIRED',
      ownerGoogleConnected: false,
      ownerGoogleConnectionStatus: 'reauthorization_required',
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })
    expect(beforeReconnect.showConnectGoogle).toBe(true)

    // Successful reconnect: live connection is active and meeting row is cleared
    // to google_not_connected with null error (no automatic enqueue).
    const afterReconnect = resolveMeetProvisionUi({
      ...base,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: null,
      ownerGoogleConnected: true,
      ownerGoogleConnectionStatus: 'connected',
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })
    expect(afterReconnect.kind).toBe('create_available')
    expect(afterReconnect.showCreateMeet).toBe(true)
    expect(afterReconnect.showConnectGoogle).toBe(false)
  })

  it('merges fresh reauthorization over stale connected liveContext fields', () => {
    const merged = mergeOwnerGoogleConnectionForMeetUi({
      ownerGoogleConnected: true,
      ownerGoogleConnectionStatus: 'connected',
      freshConnected: false,
      freshConnectionStatus: 'reauthorization_required',
    })
    expect(merged).toEqual({
      ownerGoogleConnected: false,
      ownerGoogleConnectionStatus: 'reauthorization_required',
    })

    const ui = resolveMeetProvisionUi({
      ...base,
      ...merged,
      meetProvisionStatus: 'google_not_connected',
      meetProvisionError: null,
      canRequestMeetProvision: true,
      isCalendarOwner: true,
    })
    expect(ui.showCreateMeet).toBe(false)
    expect(ui.showConnectGoogle).toBe(true)
    expect(ui.kind).toBe('reauthorization_required')
  })
})

describe('clear stale Meet reauth on Google reconnect migration', () => {
  const migration = readFileSync(staleReauthMigrationPath, 'utf8')

  it('clears stale meeting reauth state without auto-enqueueing provision', () => {
    expect(migration).toContain('meeting_calendar_clear_stale_meet_reauth_state')
    expect(migration).toContain("meet_provision_status = 'google_not_connected'")
    expect(migration).toContain('meet_provision_error = NULL')
    expect(migration).toContain("'REAUTHORIZATION_REQUIRED'")
    expect(migration).toContain("'GOOGLE_NOT_CONNECTED'")
    expect(migration).toContain('meeting_calendar_service_upsert_google_connection')
    expect(migration).toContain('cleared_stale_meet_reauth_count')
    expect(migration).toContain('Does not enqueue provisioning')
    expect(migration).not.toContain('meeting_calendar_sync_meet_provision_request')
    expect(migration).not.toContain('meeting_calendar_claim_meet_provision_batch')
  })
})
