import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Meeting, MeetingSlot } from '../../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { MeetingActionModal } from './MeetingActionModal'

const {
  loadMeetingSlotsMock,
  loadMeetingAuditEventsMock,
  loadMeetingLiveContextMock,
  proposeMeetingSlotsMock,
  setMeetingDurationMock,
} = vi.hoisted(() => ({
  loadMeetingSlotsMock: vi.fn(),
  loadMeetingAuditEventsMock: vi.fn(),
  loadMeetingLiveContextMock: vi.fn(),
  proposeMeetingSlotsMock: vi.fn(),
  setMeetingDurationMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  loadMeetingSlots: loadMeetingSlotsMock,
  loadMeetingAuditEvents: loadMeetingAuditEventsMock,
  loadMeetingLiveContext: loadMeetingLiveContextMock,
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
  meetingFormat: 'online',
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
    loadMeetingLiveContextMock.mockReset()
    proposeMeetingSlotsMock.mockReset()
    setMeetingDurationMock.mockReset()
    loadMeetingAuditEventsMock.mockResolvedValue({ ok: true, events: [] })
    loadMeetingSlotsMock.mockResolvedValue({ ok: true, slots: [confirmedSlot] })
    loadMeetingLiveContextMock.mockResolvedValue({
      ok: true,
      context: {
        meetingId: 'm1',
        currentState: 'CONFIRMED',
        meetingFormat: 'online',
        meetUrl: null,
        meetProvisionStatus: 'google_not_connected',
        meetProvisionError: null,
        phoneNumber: null,
        startsAt: null,
        endsAt: null,
        delayMinutes: null,
        delayReportedByUserId: null,
        delayReportedAt: null,
        primaryActionAvailable: false,
        delayActionAvailable: false,
        canSetConnectionDetails: true,
        canRequestMeetProvision: true,
        isCalendarOwner: true,
        ownerGoogleConnected: false,
        ownerGoogleConnectionStatus: 'not_connected',
      },
    })
    proposeMeetingSlotsMock.mockResolvedValue({
      ok: true,
      currentState: 'CONFIRMED',
    })
  })

  it('lets the calendar owner propose new slots without editing meeting type', async () => {
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
    expect(await screen.findByText('מקוונת (Google Meet)')).toBeInTheDocument()
    expect(screen.queryByLabelText('סוג פגישה')).not.toBeInTheDocument()

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
