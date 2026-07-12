import { describe, expect, it } from 'vitest'
import { canSendRequestReminder } from '../services/requestReminders'
import {
  formatReminderCount,
  getReminderRowBadgeLabel,
  getReminderSummaryLabel,
} from '../utils/requestReminders'

describe('requestReminders eligibility', () => {
  it('allows reminders for new and in_progress requests', () => {
    expect(canSendRequestReminder('new')).toBe(true)
    expect(canSendRequestReminder('in_progress')).toBe(true)
  })

  it('rejects reminders for completed and rejected requests', () => {
    expect(canSendRequestReminder('completed')).toBe(false)
    expect(canSendRequestReminder('rejected')).toBe(false)
  })

  it('formats reminder counts in Hebrew', () => {
    expect(formatReminderCount(1)).toBe('תזכורת אחת')
    expect(formatReminderCount(3)).toBe('3 תזכורות')
  })

  it('formats reminder row badges with optional count suffix', () => {
    expect(getReminderRowBadgeLabel(1)).toBe('התקבלה תזכורת')
    expect(getReminderRowBadgeLabel(2)).toBe('התקבלה תזכורת · 2')
  })

  it('keeps cooldown timestamps independent of request status changes', () => {
    const summary = {
      request_id: 'req-1',
      reminder_count: 1,
      latest_reminder_at: '2026-07-01T10:00:00.000Z',
    }

    expect(getReminderSummaryLabel(summary)).toContain('תזכורת אחת')
    expect(getReminderSummaryLabel(summary)).toContain('2026')
  })
})
