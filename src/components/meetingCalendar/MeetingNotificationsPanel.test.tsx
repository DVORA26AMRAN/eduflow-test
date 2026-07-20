import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../services/notifications'
import { MeetingNotificationsPanel } from './MeetingNotificationsPanel'

const {
  loadNotificationsMock,
  markNotificationAsReadMock,
  subscribeToUserNotificationsMock,
  unsubscribeFromUserNotificationsMock,
} = vi.hoisted(() => ({
  loadNotificationsMock: vi.fn(),
  markNotificationAsReadMock: vi.fn(),
  subscribeToUserNotificationsMock: vi.fn(),
  unsubscribeFromUserNotificationsMock: vi.fn(),
}))

vi.mock('../../services/notifications', () => ({
  loadNotifications: loadNotificationsMock,
  markNotificationAsRead: markNotificationAsReadMock,
  subscribeToUserNotifications: subscribeToUserNotificationsMock,
  unsubscribeFromUserNotifications: unsubscribeFromUserNotificationsMock,
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
}))

const meetingNotification: AppNotification = {
  id: 'n1',
  notification_type: 'MEETING_CANCELLED',
  title: 'הפגישה בוטלה',
  message: 'פגישה ביומן הפגישות בוטלה.',
  is_read: false,
  metadata: { meeting_id: 'm1' },
  created_at: '2026-07-02T12:00:00.000Z',
}

const otherNotification: AppNotification = {
  id: 'n2',
  notification_type: 'REQUEST_CREATED',
  title: 'בקשה',
  message: 'לא רלוונטי',
  is_read: false,
  metadata: {},
  created_at: '2026-07-02T11:00:00.000Z',
}

describe('MeetingNotificationsPanel', () => {
  beforeEach(() => {
    loadNotificationsMock.mockReset()
    markNotificationAsReadMock.mockReset()
    subscribeToUserNotificationsMock.mockReset()
    unsubscribeFromUserNotificationsMock.mockReset()
    subscribeToUserNotificationsMock.mockReturnValue({ unsubscribe: vi.fn() })
    markNotificationAsReadMock.mockResolvedValue({ ok: true })
  })

  it('shows only meeting lifecycle notifications and opens the related meeting', async () => {
    loadNotificationsMock.mockResolvedValue({
      ok: true,
      notifications: [meetingNotification, otherNotification],
    })
    const onOpenMeeting = vi.fn()

    render(
      <MeetingNotificationsPanel actorUserId="u1" onOpenMeeting={onOpenMeeting} />,
    )

    expect(await screen.findByText('הפגישה בוטלה')).toBeInTheDocument()
    expect(screen.queryByText('בקשה')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /הפגישה בוטלה/ }))

    await waitFor(() => {
      expect(markNotificationAsReadMock).toHaveBeenCalledWith('n1')
      expect(onOpenMeeting).toHaveBeenCalledWith('m1')
    })
  })

  it('shows an empty state when there are no meeting notifications', async () => {
    loadNotificationsMock.mockResolvedValue({
      ok: true,
      notifications: [otherNotification],
    })

    render(<MeetingNotificationsPanel actorUserId="u1" />)

    await waitFor(() => {
      expect(screen.getByText('אין התראות פגישות.')).toBeInTheDocument()
    })
  })
})
