import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Meeting, MeetingSlot } from '../../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { MeetingActionModal } from './MeetingActionModal'

const {
  loadMeetingSlotsMock,
  loadMeetingAuditEventsMock,
  proposeMeetingSlotsMock,
  setMeetingDurationMock,
} = vi.hoisted(() => ({
  loadMeetingSlotsMock: vi.fn(),
  loadMeetingAuditEventsMock: vi.fn(),
  proposeMeetingSlotsMock: vi.fn(),
  setMeetingDurationMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  loadMeetingSlots: loadMeetingSlotsMock,
  loadMeetingAuditEvents: loadMeetingAuditEventsMock,
  proposeMeetingSlots: proposeMeetingSlotsMock,
  setMeetingDuration: setMeetingDurationMock,
  approveMeetingByOwner: vi.fn(),
  selectMeetingSlot: vi.fn(),
  confirmMeeting: vi.fn(),
}))

const directory = new Map<string, MeetingUserDirectoryEntry>([
  [
    'teacher-1',
    {
      id: 'teacher-1',
      fullName: 'יעל',
      primaryRole: 'teacher',
      status: 'active',
    },
  ],
])

const meeting: Meeting = {
  id: 'm1',
  institutionId: 'inst-1',
  creatorId: 'manager-1',
  requesterId: 'manager-1',
  calendarOwnerId: 'manager-1',
  recipientId: 'teacher-1',
  subject: 'שיחה',
  reason: 'תיאום',
  durationMinutes: 30,
  institutionTimezone: 'UTC',
  currentState: 'CONFIRMED',
  activeProposalCycle: 2,
  reschedulingActive: true,
  reschedulingInitiatedAt: '2026-07-02T00:00:00.000Z',
  reschedulingInitiatedByUserId: 'manager-1',
  confirmedSlotId: 'slot-old',
  pendingSlotId: null,
  slotSelectedByUserId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
}

const confirmedSlot: MeetingSlot = {
  id: 'slot-old',
  meetingId: 'm1',
  institutionId: 'inst-1',
  proposalCycle: 1,
  startsAt: '2026-07-20T09:00:00.000Z',
  endsAt: '2026-07-20T09:30:00.000Z',
  slotStatus: 'confirmed',
  createdByUserId: 'manager-1',
  createdAt: '2026-07-01T00:00:00.000Z',
}

describe('MeetingActionModal reschedule propose', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    window.scrollTo = vi.fn()
    loadMeetingSlotsMock.mockReset()
    loadMeetingAuditEventsMock.mockReset()
    proposeMeetingSlotsMock.mockReset()
    setMeetingDurationMock.mockReset()
    loadMeetingAuditEventsMock.mockResolvedValue({ ok: true, events: [] })
    loadMeetingSlotsMock.mockResolvedValue({ ok: true, slots: [confirmedSlot] })
    proposeMeetingSlotsMock.mockResolvedValue({
      ok: true,
      currentState: 'CONFIRMED',
    })
  })

  it('lets the calendar owner propose new slots during active rescheduling without changing duration', async () => {
    const onChanged = vi.fn()
    const onClose = vi.fn()

    render(
      <MeetingActionModal
        isOpen
        meeting={meeting}
        actorUserId="manager-1"
        directory={directory}
        onClose={onClose}
        onChanged={onChanged}
      />,
    )

    expect(await screen.findByRole('button', { name: 'שליחת מועדים' })).toBeInTheDocument()
    expect(await screen.findByText(/נשאר בתוקף עד אישור מועד חדש/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('תאריך'), {
      target: { value: '2099-08-01' },
    })
    fireEvent.change(screen.getByLabelText('שעת התחלה'), {
      target: { value: '10:00' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'שליחת מועדים' }))

    await waitFor(() => {
      expect(setMeetingDurationMock).not.toHaveBeenCalled()
      expect(proposeMeetingSlotsMock).toHaveBeenCalled()
      expect(onChanged).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  }, 15_000)
})
