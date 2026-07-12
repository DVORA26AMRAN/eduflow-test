import { describe, expect, it } from 'vitest'
import { getUnreadMessageRequestIds } from './notifications'
import { NOTIFICATION_TYPE_REQUEST_MESSAGE } from '../types/requestMessage'

describe('request message notifications', () => {
  it('collects unread conversation request ids', () => {
    const requestIds = getUnreadMessageRequestIds([
      {
        id: '11111111-1111-1111-1111-111111111111',
        notification_type: NOTIFICATION_TYPE_REQUEST_MESSAGE,
        title: 'הודעה',
        message: 'הודעה חדשה',
        is_read: false,
        metadata: { request_id: 'req-1' },
        created_at: '2026-07-01T10:00:00.000Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        notification_type: NOTIFICATION_TYPE_REQUEST_MESSAGE,
        title: 'הודעה',
        message: 'הודעה חדשה',
        is_read: true,
        metadata: { request_id: 'req-2' },
        created_at: '2026-07-01T11:00:00.000Z',
      },
    ])

    expect(Array.from(requestIds)).toEqual(['req-1'])
  })

  it('ignores notifications for other request events', () => {
    const requestIds = getUnreadMessageRequestIds([
      {
        id: '33333333-3333-3333-3333-333333333333',
        notification_type: 'REQUEST_REMINDER',
        title: 'תזכורת',
        message: 'תזכורת',
        is_read: false,
        metadata: { request_id: 'req-3' },
        created_at: '2026-07-01T12:00:00.000Z',
      },
    ])

    expect(requestIds.size).toBe(0)
  })
})
