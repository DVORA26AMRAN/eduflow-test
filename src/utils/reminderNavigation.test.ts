import { describe, expect, it } from 'vitest'
import type { AppNotification } from '../services/notifications'
import { NOTIFICATION_TYPE_REQUEST_REMINDER } from '../types/requestReminder'
import {
  getNewestUnreadReminderNotification,
  getReminderSectionIdForLocation,
  shouldResetSecretaryInboxFilters,
  SECRETARY_INBOX_DEFAULT_FILTERS,
} from './reminderNavigation'

function buildReminderNotification(
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id: 'notification-1',
    notification_type: NOTIFICATION_TYPE_REQUEST_REMINDER,
    title: 'תזכורת',
    message: 'תזכורת על בקשה',
    is_read: false,
    metadata: { request_id: 'req-1' },
    created_at: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('reminderNavigation utils', () => {
  it('selects the newest unread reminder notification', () => {
    const notifications = [
      buildReminderNotification({
        id: 'older',
        created_at: '2026-07-01T10:00:00.000Z',
        metadata: { request_id: 'req-old' },
      }),
      buildReminderNotification({
        id: 'newer',
        created_at: '2026-07-02T12:00:00.000Z',
        metadata: { request_id: 'req-new' },
      }),
      buildReminderNotification({
        id: 'read',
        is_read: true,
        created_at: '2026-07-03T12:00:00.000Z',
      }),
    ]

    const newest = getNewestUnreadReminderNotification(notifications)

    expect(newest?.id).toBe('newer')
    expect(newest?.metadata.request_id).toBe('req-new')
  })

  it('routes secretary reminders to inbox or institutional archive sections', () => {
    expect(getReminderSectionIdForLocation({ kind: 'secretary_inbox' }, 'secretary')).toBe(
      'requestsInbox',
    )
    expect(
      getReminderSectionIdForLocation(
        { kind: 'secretary_institutional_archive', page: 2 },
        'secretary',
      ),
    ).toBe('institutionalArchive')
  })

  it('routes manager personal archive reminders to הארכיון שלי', () => {
    expect(
      getReminderSectionIdForLocation(
        { kind: 'manager_personal_archive', page: 1 },
        'institution_manager',
      ),
    ).toBe('archive')
  })

  it('routes manager active reminders to recent activity', () => {
    expect(getReminderSectionIdForLocation({ kind: 'manager_recent' }, 'institution_manager')).toBe(
      'teacherRequests',
    )
  })

  it('detects when secretary inbox filters must be reset to reveal a request', () => {
    const requests = [{ id: 'req-1' }]
    const filteredRequestIds = new Set<string>()

    expect(
      shouldResetSecretaryInboxFilters(
        { ...SECRETARY_INBOX_DEFAULT_FILTERS, requestStatus: 'completed' },
        'req-1',
        requests,
        filteredRequestIds,
      ),
    ).toBe(true)
  })
})
