import { describe, expect, it } from 'vitest'
import type { TeacherNotification } from '../types/notification'
import { NOTIFICATION_TYPE_REQUEST_MESSAGE } from '../types/requestMessage'
import { NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED } from '../types/teacherNotification'
import {
  buildTeacherRequestNotificationDisplay,
  collectTeacherRequestNotificationIds,
  isTeacherRequestNotification,
  resolveTeacherRequestNotificationContextText,
  truncateNotificationText,
} from './teacherNotificationDisplay'

const statusNotification: TeacherNotification = {
  id: 'notif-status',
  notification_type: NOTIFICATION_TYPE_REQUEST_STATUS_CHANGED,
  title: 'עדכון לבקשה שלך',
  message: 'הבקשה שלך סומנה כהושלמה.',
  is_read: false,
  metadata: { request_id: 'req-1', previous_status: 'in_progress', new_status: 'completed' },
  created_at: '2026-07-01T10:00:00.000Z',
}

describe('teacherNotificationDisplay', () => {
  it('identifies request-related teacher notifications', () => {
    expect(isTeacherRequestNotification(statusNotification)).toBe(true)
    expect(
      isTeacherRequestNotification({
        ...statusNotification,
        notification_type: NOTIFICATION_TYPE_REQUEST_MESSAGE,
      }),
    ).toBe(true)
    expect(
      isTeacherRequestNotification({
        ...statusNotification,
        notification_type: 'SUBSTITUTE_BOARD_APPROVED',
      }),
    ).toBe(false)
  })

  it('builds a status notification card with request type title and context', () => {
    const display = buildTeacherRequestNotificationDisplay(
      statusNotification,
      {
        requestId: 'req-1',
        requestType: 'absence',
        description: 'היעדרות בתאריך 15 ביולי',
        status: 'completed',
        archivedAt: null,
      },
      'req-1',
    )

    expect(display.title).toBe('עדכון לבקשת היעדרות')
    expect(display.context).toBe('היעדרות בתאריך 15 ביולי')
    expect(display.event).toBe('הבקשה שלך סומנה כהושלמה.')
    expect(display.ariaLabel).toContain('עדכון לבקשת היעדרות')
    expect(display.ariaLabel).toContain('היעדרות בתאריך 15 ביולי')
  })

  it('uses the general request subject as context', () => {
    const display = buildTeacherRequestNotificationDisplay(
      statusNotification,
      {
        requestId: 'req-general',
        requestType: 'general_request',
        description: 'בקשה לעזרה בטיול',
        status: 'in_progress',
        archivedAt: null,
      },
      'req-general',
    )

    expect(display.title).toBe('עדכון לבקשה אחרת')
    expect(display.context).toBe('בקשה לעזרה בטיול')
  })

  it('falls back to request type label when description is missing', () => {
    const contextText = resolveTeacherRequestNotificationContextText(
      {
        requestId: 'req-2',
        requestType: 'budget_or_equipment',
        description: '   ',
        status: 'new',
        archivedAt: null,
      },
      'req-2',
    )

    expect(contextText).toBe('בקשת תקציב / ציוד')
  })

  it('falls back to shortened request id when context is unavailable', () => {
    const contextText = resolveTeacherRequestNotificationContextText(
      undefined,
      '12345678-abcd-efgh-ijkl-1234567890ab',
    )

    expect(contextText).toBe('בקשה 12345678')
  })

  it('truncates long context safely', () => {
    const longText = 'א'.repeat(150)
    expect(truncateNotificationText(longText)).toHaveLength(120)
    expect(truncateNotificationText(longText).endsWith('…')).toBe(true)
  })

  it('collects unique request ids for batch loading', () => {
    const notifications: TeacherNotification[] = [
      statusNotification,
      {
        ...statusNotification,
        id: 'notif-message',
        notification_type: NOTIFICATION_TYPE_REQUEST_MESSAGE,
        metadata: { request_id: 'req-1' },
      },
      {
        ...statusNotification,
        id: 'notif-other',
        notification_type: 'SUBSTITUTE_BOARD_APPROVED',
        metadata: { substitute_board_post_id: 'post-1' },
      },
      {
        ...statusNotification,
        id: 'notif-second',
        metadata: { request_id: 'req-2' },
      },
    ]

    expect(collectTeacherRequestNotificationIds(notifications).sort()).toEqual(['req-1', 'req-2'])
  })
})
