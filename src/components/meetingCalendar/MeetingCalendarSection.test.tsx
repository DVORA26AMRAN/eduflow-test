import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MeetingCalendarSection } from './MeetingCalendarSection'

const {
  loadPendingMeetingsMock,
  loadConfirmedMeetingsInRangeMock,
  loadUpcomingConfirmedMeetingsMock,
  loadMeetingUserDirectoryMock,
} = vi.hoisted(() => ({
  loadPendingMeetingsMock: vi.fn(),
  loadConfirmedMeetingsInRangeMock: vi.fn(),
  loadUpcomingConfirmedMeetingsMock: vi.fn(),
  loadMeetingUserDirectoryMock: vi.fn(),
}))

vi.mock('../../services/meetingCalendar', () => ({
  loadPendingMeetings: loadPendingMeetingsMock,
  loadConfirmedMeetingsInRange: loadConfirmedMeetingsInRangeMock,
  loadUpcomingConfirmedMeetings: loadUpcomingConfirmedMeetingsMock,
}))

vi.mock('../../services/meetingRecipients', () => ({
  loadMeetingUserDirectory: loadMeetingUserDirectoryMock,
  loadEligibleMeetingRecipients: () => [],
}))

vi.mock('../../services/notifications', () => ({
  loadNotifications: vi.fn().mockResolvedValue({ ok: true, notifications: [] }),
  markNotificationAsRead: vi.fn(),
  subscribeToUserNotifications: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  unsubscribeFromUserNotifications: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
}))

describe('MeetingCalendarSection', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadPendingMeetingsMock.mockReset()
    loadConfirmedMeetingsInRangeMock.mockReset()
    loadUpcomingConfirmedMeetingsMock.mockReset()
    loadMeetingUserDirectoryMock.mockReset()
  })

  it('shows a Hebrew error state when pending meetings fail to load', async () => {
    loadPendingMeetingsMock.mockResolvedValue({
      ok: false,
      errorMessage: 'לא ניתן לטעון פגישות.',
    })
    loadConfirmedMeetingsInRangeMock.mockResolvedValue({ ok: true, items: [] })
    loadUpcomingConfirmedMeetingsMock.mockResolvedValue({ ok: true, items: [] })
    loadMeetingUserDirectoryMock.mockResolvedValue({ ok: true, users: [] })

    render(<MeetingCalendarSection actorUserId="u1" actorRole="institution_manager" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן לטעון פגישות.')
  })

  it('loads pending, upcoming, and range-specific confirmed meetings separately', async () => {
    loadPendingMeetingsMock.mockResolvedValue({ ok: true, meetings: [] })
    loadConfirmedMeetingsInRangeMock.mockResolvedValue({ ok: true, items: [] })
    loadUpcomingConfirmedMeetingsMock.mockResolvedValue({ ok: true, items: [] })
    loadMeetingUserDirectoryMock.mockResolvedValue({ ok: true, users: [] })

    render(<MeetingCalendarSection actorUserId="u1" actorRole="institution_manager" />)

    await waitFor(() => {
      expect(loadPendingMeetingsMock).toHaveBeenCalled()
      expect(loadUpcomingConfirmedMeetingsMock).toHaveBeenCalled()
      expect(loadConfirmedMeetingsInRangeMock).toHaveBeenCalled()
    })

    const rangeArgs = loadConfirmedMeetingsInRangeMock.mock.calls[0]?.[0] as {
      rangeStart: Date
      rangeEnd: Date
    }
    expect(rangeArgs.rangeStart).toBeInstanceOf(Date)
    expect(rangeArgs.rangeEnd).toBeInstanceOf(Date)
    expect(rangeArgs.rangeEnd.getTime()).toBeGreaterThan(rangeArgs.rangeStart.getTime())

    const board = await screen.findByRole('region', { name: 'לוח שנה' })
    expect(within(board).getByText('אין פגישות מתוכננות.')).toBeInTheDocument()
    expect(within(board).getByRole('grid', { name: 'תצוגת חודש' })).toBeInTheDocument()
  })
})
