import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMeetProvisionRequestKey,
  getGoogleConnectionStatus,
  getMeetProvisionStatus,
  requestMeetProvision,
} from '../services/meetingGoogleMeet'
import {
  isGoogleApiEligibleOutboxStatus,
  shouldEnqueueGoogleApiAttempt,
} from './meetingMeetProvision'

const rpc = vi.fn()

vi.mock('../services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('Meet provision idempotency helpers', () => {
  it('builds deterministic request keys matching SQL adoflow-{meeting}-{slot}', () => {
    expect(
      buildMeetProvisionRequestKey(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ),
    ).toBe(
      'adoflow-11111111-1111-1111-1111-111111111111-22222222-2222-2222-2222-222222222222',
    )
  })

  it('does not mark awaiting_connection as Google-API eligible', () => {
    expect(isGoogleApiEligibleOutboxStatus('awaiting_connection')).toBe(false)
    expect(isGoogleApiEligibleOutboxStatus('pending')).toBe(true)
    expect(isGoogleApiEligibleOutboxStatus('processing')).toBe(true)
    expect(isGoogleApiEligibleOutboxStatus('succeeded')).toBe(false)
  })

  it('keeps confirm path enqueue rules: disconnected ⇒ no Google attempt', () => {
    expect(
      shouldEnqueueGoogleApiAttempt({
        meetingFormat: 'online',
        ownerGoogleConnected: false,
      }),
    ).toEqual({
      meetingStatus: 'google_not_connected',
      outboxStatus: 'awaiting_connection',
      enqueued: false,
    })

    expect(
      shouldEnqueueGoogleApiAttempt({
        meetingFormat: 'online',
        ownerGoogleConnected: true,
      }),
    ).toEqual({
      meetingStatus: 'pending',
      outboxStatus: 'pending',
      enqueued: true,
    })

    expect(
      shouldEnqueueGoogleApiAttempt({
        meetingFormat: 'in_person',
        ownerGoogleConnected: true,
      }),
    ).toEqual({
      meetingStatus: 'not_applicable',
      outboxStatus: 'cancelled',
      enqueued: false,
    })
  })
})

describe('Meet provision client RPCs (authorization surface)', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('requestMeetProvision maps GOOGLE_NOT_CONNECTED without inventing a Meet URL', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        meet_provision_status: 'google_not_connected',
        enqueued: false,
        google_connected: false,
        request_key: 'adoflow-m-s',
        code: 'GOOGLE_NOT_CONNECTED',
      },
      error: null,
    })

    const result = await requestMeetProvision('meeting-1')
    expect(rpc).toHaveBeenCalledWith('meeting_calendar_request_meet_provision', {
      p_meeting_id: 'meeting-1',
    })
    expect(result).toEqual({
      ok: true,
      meetProvisionStatus: 'google_not_connected',
      enqueued: false,
      googleConnected: false,
      requestKey: 'adoflow-m-s',
      code: 'GOOGLE_NOT_CONNECTED',
      idempotent: false,
      meetUrl: null,
    })
  })

  it('getMeetProvisionStatus exposes status flags for UI without secrets', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        meeting_id: 'meeting-1',
        meet_provision_status: 'pending',
        meet_provision_error: null,
        meet_url: null,
        outbox_status: 'pending',
        can_request_meet: true,
        owner_google_connected: true,
      },
      error: null,
    })

    const result = await getMeetProvisionStatus('meeting-1')
    expect(result).toMatchObject({
      ok: true,
      meetProvisionStatus: 'pending',
      ownerGoogleConnected: true,
      canRequestMeet: true,
      meetUrl: null,
    })
  })

  it('getGoogleConnectionStatus never returns token material', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, connected: true, email: 'owner@school.example' },
      error: null,
    })

    const result = await getGoogleConnectionStatus()
    expect(result).toEqual({
      ok: true,
      connected: true,
      email: 'owner@school.example',
    })
    expect(JSON.stringify(result)).not.toMatch(/token|cipher|nonce/i)
  })
})
