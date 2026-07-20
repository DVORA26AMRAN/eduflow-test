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

function renderModal(actorRole: 'institution_manager' | 'teacher' = 'institution_manager') {
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

  it('renders modal title, subtitle, and meeting details fields', () => {
    renderModal()

    expect(screen.getByRole('heading', { name: 'יצירת פגישה חדשה' })).toBeInTheDocument()
    expect(screen.getByText('תאם פגישה חדשה עם משתמש במוסד.')).toBeInTheDocument()
    expect(screen.getByText('עם מי תרצה להיפגש?')).toBeInTheDocument()
    expect(screen.getByText('פרטי הפגישה')).toBeInTheDocument()
    expect(screen.getByLabelText('נושא')).toBeInTheDocument()
    expect(screen.getByLabelText('סיבה')).toBeInTheDocument()
  })

  it('shows inline searchable recipients and selected recipient row', () => {
    renderModal()

    expect(screen.getByLabelText('חיפוש לפי שם')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))

    expect(screen.getByText(/יעל כהן · מורה/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שינוי' })).toBeInTheDocument()
    expect(screen.queryByLabelText('חיפוש לפי שם')).not.toBeInTheDocument()
  })

  it('shows owner workflow with duration controls and slot form for manager recipient', () => {
    renderModal()

    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))

    expect(screen.getByRole('radiogroup', { name: /משך הפגישה/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /30 דקות/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שליחת הזמנה' })).toBeInTheDocument()
    expect(
      screen.queryByText('משך הפגישה והמועדים ייקבעו על ידי בעל היומן.'),
    ).not.toBeInTheDocument()
  })

  it('shows teacher workflow help text and request submit label', () => {
    renderModal('teacher')

    fireEvent.click(screen.getByRole('radio', { name: /דוד/i }))

    expect(
      screen.getByText('משך הפגישה והמועדים ייקבעו על ידי בעל היומן.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שליחת בקשה' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: /משך הפגישה/i })).not.toBeInTheDocument()
  })

  it('updates reason character counter', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'שיחה' } })

    expect(screen.getByText(/\d+\/\d+/)).toHaveTextContent('4/')
  })

  it('submits owner-initiated meeting with duration and slots', async () => {
    renderModal()

    fireEvent.click(screen.getByRole('radio', { name: /יעל כהן/i }))
    fireEvent.change(screen.getByLabelText('נושא'), { target: { value: 'שיחת הורים' } })
    fireEvent.change(screen.getByLabelText('סיבה'), { target: { value: 'תיאום שבועי' } })
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

    await waitFor(
      () => {
        expect(createMeetingMock).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: 'teacher-1',
            subject: 'שיחת הורים',
            reason: 'תיאום שבועי',
            durationMinutes: 30,
          }),
        )
      },
      { timeout: 3000 },
    )

    expect(proposeMeetingSlotsMock).toHaveBeenCalled()
  }, 10000)
})
