import { describe, expect, it } from 'vitest'
import { upsertReminderSummary } from '../services/requestReminders'

describe('requestReminders realtime summary updates', () => {
  it('updates the affected request row summary without reloading all rows', () => {
    const initial = new Map([
      [
        'req-1',
        {
          request_id: 'req-1',
          reminder_count: 1,
          latest_reminder_at: '2026-07-01T10:00:00.000Z',
        },
      ],
    ])

    const updated = upsertReminderSummary(initial, {
      request_id: 'req-1',
      reminder_count: 2,
      latest_reminder_at: '2026-07-02T10:00:00.000Z',
    })

    expect(updated.get('req-1')).toEqual({
      request_id: 'req-1',
      reminder_count: 2,
      latest_reminder_at: '2026-07-02T10:00:00.000Z',
    })
  })
})
