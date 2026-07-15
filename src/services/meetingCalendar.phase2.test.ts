import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}))

import {
  confirmMeeting,
  createMeeting,
  proposeMeetingSlots,
  selectMeetingSlot,
  setMeetingDuration,
  approveMeetingByOwner,
} from './meetingCalendar'

describe('meeting calendar Phase 2 RPC integration', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('creates a Workflow A meeting with an owner-selected duration', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, meeting_id: 'm1', current_state: 'WAITING_FOR_SLOT_PROPOSAL' },
      error: null,
    })

    const result = await createMeeting({
      recipientId: 'u2',
      subject: 'פגישה',
      reason: 'תיאום',
      durationMinutes: 30,
    })

    expect(rpcMock).toHaveBeenCalledWith('meeting_calendar_create_meeting', {
      p_recipient_id: 'u2',
      p_subject: 'פגישה',
      p_reason: 'תיאום',
      p_duration_minutes: 30,
      p_institution_timezone: 'UTC',
    })
    expect(result.ok).toBe(true)
  })

  it('creates a Workflow B meeting with duration_minutes NULL', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, meeting_id: 'm2', current_state: 'WAITING_FOR_OWNER_APPROVAL' },
      error: null,
    })

    const result = await createMeeting({
      recipientId: 'u2',
      subject: 'בקשה',
      reason: 'תיאום',
      durationMinutes: null,
    })

    expect(rpcMock).toHaveBeenCalledWith('meeting_calendar_create_meeting', {
      p_recipient_id: 'u2',
      p_subject: 'בקשה',
      p_reason: 'תיאום',
      p_duration_minutes: null,
      p_institution_timezone: 'UTC',
    })
    expect(result.ok).toBe(true)
  })

  it('approves, sets duration, proposes, selects, and confirms through RPCs', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { ok: true, current_state: 'WAITING_FOR_SLOT_PROPOSAL' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, current_state: 'WAITING_FOR_SLOT_PROPOSAL' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, current_state: 'WAITING_FOR_SLOT_SELECTION' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, current_state: 'WAITING_FOR_FINAL_CONFIRMATION' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, current_state: 'CONFIRMED' },
        error: null,
      })

    await approveMeetingByOwner('meeting-1')
    await setMeetingDuration('meeting-1', 45)
    await proposeMeetingSlots(
      'meeting-1',
      [{ startsAt: '2099-05-01T10:00:00.000Z', endsAt: '2099-05-01T10:45:00.000Z' }],
      45,
    )
    await selectMeetingSlot('meeting-1', 'slot-1')
    await confirmMeeting('meeting-1')

    expect(rpcMock.mock.calls.map((call) => call[0])).toEqual([
      'meeting_calendar_approve_by_owner',
      'meeting_calendar_set_duration',
      'meeting_calendar_propose_slots',
      'meeting_calendar_select_slot',
      'meeting_calendar_confirm_meeting',
    ])

    expect(rpcMock.mock.calls[2][1]).toEqual({
      p_meeting_id: 'meeting-1',
      p_slots: [{ starts_at: '2099-05-01T10:00:00.000Z', ends_at: '2099-05-01T10:45:00.000Z' }],
    })
  })

  it('maps authorization failures from RPC to Hebrew messages', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Only the calendar owner may propose meeting slots.' },
    })

    const result = await proposeMeetingSlots(
      'meeting-1',
      [{ startsAt: '2099-05-01T10:00:00.000Z', endsAt: '2099-05-01T10:30:00.000Z' }],
      30,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toBe('אין הרשאה לבצע פעולה זו')
    }
  })

  it('maps conflict failures from confirm RPC', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Selected slot conflicts with another confirmed meeting.' },
    })

    const result = await confirmMeeting('meeting-1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toBe('קיימת פגישה אחרת בזמן זה')
    }
  })
})
