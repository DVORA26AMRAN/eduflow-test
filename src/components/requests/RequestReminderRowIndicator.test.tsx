import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestReminderRowIndicator } from './RequestReminderRowIndicator'

afterEach(() => {
  cleanup()
})

describe('RequestReminderRowIndicator', () => {
  it('shows bell icon, label, count, and timestamp on the request row', () => {
    render(
      <RequestReminderRowIndicator
        summary={{
          request_id: 'req-1',
          reminder_count: 2,
          latest_reminder_at: '2026-07-02T12:00:00.000Z',
        }}
        hasUnreadReminder={false}
        badgeClassName="secretary-dashboard__reminder-badge"
        metaClassName="secretary-dashboard__reminder-meta"
      />,
    )

    expect(screen.getByText('🔔')).toBeInTheDocument()
    expect(screen.getByText('התקבלה תזכורת · 2')).toBeInTheDocument()
  })
})
