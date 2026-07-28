import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveMeetProvisionUi } from './meetingMeetProvisionUi'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250729140000_meeting_calendar_google_meet_provision_phase4.sql',
)

describe('meeting calendar Google Meet Phase 4 migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')

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
})
