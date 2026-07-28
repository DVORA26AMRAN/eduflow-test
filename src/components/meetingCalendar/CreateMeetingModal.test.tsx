import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { CreateMeetingModal } from './CreateMeetingModal'

const { createMeetingMock, proposeMeetingSlotsMock } = vi.hoisted(() => ({
  createMeetingMock: vi.fn(),
  proposeMeetingSlotsMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  createMeeting: createMeetingMock,
  proposeMeetingSlots: proposeMeetingSlotsMock,
}))

const recipients: MeetingUserDirectoryEntry[] = [
  {
    id: 'teacher-1',
    fullName: 'יעל כהן',
    primaryRole: 'teacher',
    status: 'active',
  },
  {
    id: 'manager-1',
    fullName: 'דוד לוי',
    primaryRole: 'institution_manager',
    status: 'active',
  },
]

function renderModal(
  actorRole: 'institution_manager' | 'teacher' | 'secretary' = 'institution_manager',
) {
  const onClose = vi.fn()
  const onCreated = vi.fn()

  render(
    <CreateMeetingModal
      isOpen
      actorRole={actorRole}
      eligibleRecipients={recipients}
      onClose={onClose}
      onCreated={onCreated}
    />,
  )

  return { onClose, onCreated }
}

function fillCommonFields() {
  fireEvent.change(screen.getByLabelText('נושא'), { target: { value: 'שיחת הורים' } })
  fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'תיאום שבועי' } })
}

describe('CreateMeetingModal UI', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    createMeetingMock.mockReset()
    proposeMeetingSlotsMock.mockReset()
    createMeetingMock.mockResolvedValue({ ok: true, meetingId: 'meeting-1' })
    proposeMeetingSlotsMock.mockResolvedValue({ ok: true })
  })

  it('renders meeting type selector for all create flows', () => {
    renderModal()
    expect(screen.getByLabelText('סוג פגישה')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'פרונטלית' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'טלפונית' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מקוונת (Google Meet)' })).toBeInTheDocument()
  })

  it('requires meeting type before submit', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))
    fillCommonFields()
    fireEvent.click(screen.getByRole('radio', { name: /30 דקות/i }))

    fireEvent.click(screen.getByRole('button', { name: 'שליחת הזמנה' }))

    expect(await screen.findByText('נא לבחור סוג פגישה.')).toBeInTheDocument()
    expect(createMeetingMock).not.toHaveBeenCalled()
  })

  it('requires phone number for phone meetings', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))
    fillCommonFields()
    fireEvent.change(screen.getByLabelText('סוג פגישה'), { target: { value: 'phone' } })
    fireEvent.click(screen.getByRole('radio', { name: /30 דקות/i }))

    fireEvent.click(screen.getByRole('button', { name: 'שליחת הזמנה' }))

    expect(await screen.findByText('נא להזין מספר טלפון לפגישה טלפונית.')).toBeInTheDocument()
    expect(createMeetingMock).not.toHaveBeenCalled()
  })

  it('shows auto Meet message and never exposes manual URL for online', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('סוג פגישה'), { target: { value: 'online' } })
    expect(
      screen.getByText('קישור Google Meet ייווצר אוטומטית לאחר אישור הפגישה.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/קישור Google Meet/i)).not.toBeInTheDocument()
  })

  it('lets manager select type during initial creation and persists it', async () => {
    renderModal('institution_manager')
    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))
    fillCommonFields()
    fireEvent.change(screen.getByLabelText('סוג פגישה'), { target: { value: 'online' } })
    fireEvent.click(screen.getByRole('radio', { name: /30 דקות/i }))

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 2)
    const dateValue = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, '0'),
      String(tomorrow.getDate()).padStart(2, '0'),
    ].join('-')
    fireEvent.change(screen.getByLabelText('תאריך'), { target: { value: dateValue } })
    fireEvent.change(screen.getByLabelText('שעת התחלה'), { target: { value: '14:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'שליחת הזמנה' }))

    await waitFor(() => {
      expect(createMeetingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'teacher-1',
          meetingFormat: 'online',
          phoneNumber: null,
          durationMinutes: 30,
        }),
      )
    })
    expect(proposeMeetingSlotsMock).toHaveBeenCalled()
  }, 10_000)

  it('lets teacher select type during initial creation', async () => {
    renderModal('teacher')
    fireEvent.click(screen.getByRole('radio', { name: /דוד/i }))
    fillCommonFields()
    fireEvent.change(screen.getByLabelText('סוג פגישה'), { target: { value: 'in_person' } })
    fireEvent.click(screen.getByRole('button', { name: 'שליחת בקשה' }))

    await waitFor(() => {
      expect(createMeetingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingFormat: 'in_person',
          durationMinutes: null,
        }),
      )
    })
  })

  it('lets secretary select phone type with phone number during initial creation', async () => {
    renderModal('secretary')
    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))
    fillCommonFields()
    fireEvent.change(screen.getByLabelText('סוג פגישה'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByLabelText('מספר טלפון'), { target: { value: '050-1234567' } })
    fireEvent.click(screen.getByRole('radio', { name: /30 דקות/i }))

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 2)
    const dateValue = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, '0'),
      String(tomorrow.getDate()).padStart(2, '0'),
    ].join('-')
    fireEvent.change(screen.getByLabelText('תאריך'), { target: { value: dateValue } })
    fireEvent.change(screen.getByLabelText('שעת התחלה'), { target: { value: '11:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'שליחת הזמנה' }))

    await waitFor(() => {
      expect(createMeetingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingFormat: 'phone',
          phoneNumber: '050-1234567',
        }),
      )
    })
  }, 10_000)
})
