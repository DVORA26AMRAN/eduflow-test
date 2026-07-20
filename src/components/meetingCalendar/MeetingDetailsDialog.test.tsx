import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Meeting, MeetingSlot } from '../../types/meetingCalendar'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { MeetingDetailsDialog } from './MeetingDetailsDialog'

const {
  loadMeetingSlotsMock,
  loadMeetingAuditEventsMock,
  cancelMeetingMock,
  rescheduleMeetingMock,
} = vi.hoisted(() => ({
  loadMeetingSlotsMock: vi.fn(),
  loadMeetingAuditEventsMock: vi.fn(),
  cancelMeetingMock: vi.fn(),
  rescheduleMeetingMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  loadMeetingSlots: loadMeetingSlotsMock,
  loadMeetingAuditEvents: loadMeetingAuditEventsMock,
  cancelMeeting: cancelMeetingMock,
  rescheduleMeeting: rescheduleMeetingMock,
}))

vi.mock('./MeetingHistoryList', () => ({
  MeetingHistoryList: () => <div data-testid="meeting-history">היסטוריית פגישה</div>,
}))

const directory = new Map<string, MeetingUserDirectoryEntry>([
  [
    'teacher-1',
    {
      id: 'teacher-1',
      fullName: 'יעל כהן',
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
  subject: 'שיחת סטטוס',
  reason: 'מעקב שבועי',
  durationMinutes: 45,
  institutionTimezone: 'UTC',
  currentState: 'CONFIRMED',
  activeProposalCycle: 1,
  reschedulingActive: false,
  reschedulingInitiatedAt: null,
  reschedulingInitiatedByUserId: null,
  confirmedSlotId: 'slot-1',
  pendingSlotId: null,
  slotSelectedByUserId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const confirmedSlot: MeetingSlot = {
  id: 'slot-1',
  meetingId: 'm1',
  institutionId: 'inst-1',
  proposalCycle: 1,
  startsAt: '2026-07-20T09:00:00.000Z',
  endsAt: '2026-07-20T09:45:00.000Z',
  slotStatus: 'confirmed',
  createdByUserId: 'manager-1',
  createdAt: '2026-07-01T00:00:00.000Z',
}

describe('MeetingDetailsDialog', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    window.scrollTo = vi.fn()
    loadMeetingSlotsMock.mockReset()
    loadMeetingAuditEventsMock.mockReset()
    cancelMeetingMock.mockReset()
    rescheduleMeetingMock.mockReset()
    loadMeetingAuditEventsMock.mockResolvedValue({ ok: true, events: [] })
  })

  it('renders read-only meeting details and closes', () => {
    const onClose = vi.fn()

    render(
      <MeetingDetailsDialog
        isOpen
        meeting={meeting}
        actorUserId="manager-1"
        directory={directory}
        confirmedSlot={confirmedSlot}
        onClose={onClose}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('שיחת סטטוס')).toBeInTheDocument()
    expect(screen.getByText('מעקב שבועי')).toBeInTheDocument()
    expect(screen.getByText(/יעל כהן/)).toBeInTheDocument()
    expect(screen.getByText('45 דקות')).toBeInTheDocument()
    expect(screen.getByText('פגישה מאושרת')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'עריכת פרטים' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('allows only the calendar owner to cancel with confirmation and optional reason', async () => {
    cancelMeetingMock.mockResolvedValue({ ok: true, currentState: 'CANCELLED' })
    const onChanged = vi.fn()
    const onClose = vi.fn()

    render(
      <MeetingDetailsDialog
        isOpen
        meeting={meeting}
        actorUserId="manager-1"
        directory={directory}
        confirmedSlot={confirmedSlot}
        onClose={onClose}
        onChanged={onChanged}
      />,
    )

    const details = screen.getByRole('dialog', { name: 'פרטי פגישה' })
    fireEvent.click(within(details).getByRole('button', { name: 'ביטול פגישה' }))

    const cancelDialog = screen.getByRole('dialog', { name: 'ביטול פגישה' })
    fireEvent.change(within(cancelDialog).getByLabelText('סיבת ביטול (אופציונלי)'), {
      target: { value: 'שינוי תוכנית' },
    })
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'אישור ביטול' }))

    await waitFor(() => {
      expect(cancelMeetingMock).toHaveBeenCalledWith('m1', 'שינוי תוכנית')
      expect(onChanged).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('hides cancel and reschedule actions for non-owners', () => {
    render(
      <MeetingDetailsDialog
        isOpen
        meeting={meeting}
        actorUserId="teacher-1"
        directory={directory}
        confirmedSlot={confirmedSlot}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )

    const details = screen.getByRole('dialog', { name: 'פרטי פגישה' })
    expect(within(details).queryByRole('button', { name: 'ביטול פגישה' })).not.toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'תיאום מחדש' })).not.toBeInTheDocument()
  })

  it('starts reschedule for the calendar owner after confirmation', async () => {
    rescheduleMeetingMock.mockResolvedValue({
      ok: true,
      currentState: 'CONFIRMED',
      reschedulingActive: true,
    })
    const onRescheduleStarted = vi.fn()
    const onChanged = vi.fn()

    render(
      <MeetingDetailsDialog
        isOpen
        meeting={meeting}
        actorUserId="manager-1"
        directory={directory}
        confirmedSlot={confirmedSlot}
        onClose={vi.fn()}
        onChanged={onChanged}
        onRescheduleStarted={onRescheduleStarted}
      />,
    )

    const details = screen.getByRole('dialog', { name: 'פרטי פגישה' })
    fireEvent.click(within(details).getByRole('button', { name: 'תיאום מחדש' }))
    fireEvent.click(screen.getByRole('button', { name: 'התחלת תיאום מחדש' }))

    await waitFor(() => {
      expect(rescheduleMeetingMock).toHaveBeenCalledWith('m1')
      expect(onChanged).toHaveBeenCalled()
      expect(onRescheduleStarted).toHaveBeenCalledWith('m1')
    })
  })
})
