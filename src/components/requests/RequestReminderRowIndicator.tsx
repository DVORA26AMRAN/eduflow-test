import type { RequestReminderSummary } from '../../types/requestReminder'
import { formatRequestDateTime } from '../../utils/requests'
import { getReminderRowBadgeLabel } from '../../utils/requestReminders'

type RequestReminderRowIndicatorProps = {
  summary?: RequestReminderSummary
  hasUnreadReminder: boolean
  badgeClassName: string
  metaClassName: string
}

export function RequestReminderRowIndicator({
  summary,
  hasUnreadReminder,
  badgeClassName,
  metaClassName,
}: RequestReminderRowIndicatorProps) {
  if (!summary) {
    return null
  }

  return (
    <>
      <span
        className={
          hasUnreadReminder ? `${badgeClassName} ${badgeClassName}--unread` : badgeClassName
        }
      >
        <span className="request-reminder-row-indicator__icon" aria-hidden="true">
          🔔
        </span>
        {getReminderRowBadgeLabel(summary.reminder_count)}
      </span>
      <p className={metaClassName}>{formatRequestDateTime(summary.latest_reminder_at)}</p>
    </>
  )
}
