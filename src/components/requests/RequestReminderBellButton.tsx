import type { RequestStatus } from '../../types/request'
import { NavBellIcon } from '../dashboard/dashboardNav'

type RequestReminderBellButtonProps = {
  requestStatus: RequestStatus
  isVisible: boolean
  isDisabled: boolean
  isSending: boolean
  disabledReason?: string
  onSendReminder: () => void
}

function getReminderBellLabel(
  requestStatus: RequestStatus,
  isSending: boolean,
  isDisabled: boolean,
  disabledReason?: string,
): string {
  if (isSending) {
    return 'שולח תזכורת...'
  }

  if (isDisabled) {
    return disabledReason ?? 'לא ניתן לשלוח תזכורת כרגע'
  }

  if (requestStatus === 'in_progress') {
    return 'שליחת תזכורת לבקשה בטיפול'
  }

  return 'שליחת תזכורת לבקשה חדשה'
}

export function RequestReminderBellButton({
  requestStatus,
  isVisible,
  isDisabled,
  isSending,
  disabledReason,
  onSendReminder,
}: RequestReminderBellButtonProps) {
  if (!isVisible) {
    return null
  }

  const title = getReminderBellLabel(requestStatus, isSending, isDisabled, disabledReason)

  return (
    <button
      type="button"
      className="request-reminder-bell"
      onClick={onSendReminder}
      disabled={isDisabled || isSending}
      aria-label={title}
      title={title}
    >
      <span
        className={
          isSending ? 'request-reminder-bell__icon request-reminder-bell__icon--sending' : 'request-reminder-bell__icon'
        }
        aria-hidden="true"
      >
        <NavBellIcon />
      </span>
      <span className="request-reminder-bell__label">
        {isSending ? 'שולח...' : 'תזכורת'}
      </span>
    </button>
  )
}
