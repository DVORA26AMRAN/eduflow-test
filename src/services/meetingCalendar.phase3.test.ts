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
  loadConfirmedMeetingsInRange,
  loadPendingMeetings,
  loadUpcomingConfirmedMeetings,
  UPCOMING_CONFIRMED_MEETINGS_LIMIT,
} from './meetingCalendar'

const confirmedRow = {
  id: 'm1',
  institution_id: 'inst-1',
  creator_id: 'u1',
  requester_id: 'u1',
  calendar_owner_id: 'u1',
  recipient_id: 'u2',
  subject: 'פגישה',
  reason: 'תיאום',
  duration_minutes: 30,
  institution_timezone: 'Asia/Jerusalem',
  current_state: 'CONFIRMED',
  active_proposal_cycle: 1,
  rescheduling_active: false,
  rescheduling_initiated_at: null,
  rescheduling_initiated_by_user_id: null,
  confirmed_slot_id: 'slot-1',
  pending_slot_id: null,
  slot_selected_by_user_id: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  slot_id: 'slot-1',
  slot_starts_at: '2026-07-20T09:00:00.000Z',
  slot_ends_at: '2026-07-20T09:30:00.000Z',
  slot_status: 'confirmed',
  slot_proposal_cycle: 1,
  slot_created_by_user_id: 'u1',
  slot_created_at: '2026-07-01T00:00:00.000Z',
}

describe('meeting calendar Phase 3 range reads', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('loads confirmed meetings for a visible calendar range via RPC', async () => {
    rpcMock.mockResolvedValue({ data: [confirmedRow], error: null })

    const result = await loadConfirmedMeetingsInRange({
      rangeStart: new Date('2026-07-01T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-01T00:00:00.000Z'),
    })

    expect(rpcMock).toHaveBeenCalledWith('meeting_calendar_list_confirmed_in_range', {
      p_range_start: '2026-07-01T00:00:00.000Z',
      p_range_end: '2026-08-01T00:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.meeting.id).toBe('m1')
      expect(result.items[0]?.slot.id).toBe('slot-1')
    }
  })

  it('loads upcoming confirmed meetings with a bounded limit', async () => {
    rpcMock.mockResolvedValue({ data: [confirmedRow], error: null })

    const result = await loadUpcomingConfirmedMeetings({
      from: new Date('2026-07-19T00:00:00.000Z'),
    })

    expect(rpcMock).toHaveBeenCalledWith('meeting_calendar_list_upcoming_confirmed', {
      p_from: '2026-07-19T00:00:00.000Z',
      p_limit: UPCOMING_CONFIRMED_MEETINGS_LIMIT,
    })
    expect(result.ok).toBe(true)
  })

  it('loads pending meetings without confirmed history', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...confirmedRow,
          current_state: 'WAITING_FOR_OWNER_APPROVAL',
          confirmed_slot_id: null,
          slot_id: undefined,
        },
      ],
      error: null,
    })

    const result = await loadPendingMeetings()

    expect(rpcMock).toHaveBeenCalledWith('meeting_calendar_list_pending_meetings')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meetings[0]?.currentState).toBe('WAITING_FOR_OWNER_APPROVAL')
    }
  })
})
