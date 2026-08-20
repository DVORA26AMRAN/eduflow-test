import { useState } from 'react'
import type { ManagementJournalParticipant } from '../../types/managementJournal'
import type { PrimaryRole } from '../../types/user'
import {
  MANAGEMENT_JOURNAL_ADD_TASK_LABEL,
  filterAssignableJournalParticipants,
} from '../../utils/managementJournalDisplay'

type ManagementJournalTaskComposerProps = {
  pageType: 'personal' | 'shared'
  actorUserId: string
  actorRole: PrimaryRole
  participants: ManagementJournalParticipant[]
  disabled: boolean
  onCreate: (input: {
    title: string
    details: string
    responsibleUserId: string
    targetTime: string
  }) => void
}

export function ManagementJournalTaskComposer({
  pageType,
  actorUserId,
  actorRole,
  participants,
  disabled,
  onCreate,
}: ManagementJournalTaskComposerProps) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [targetTime, setTargetTime] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState(actorUserId)
  const assignable = filterAssignableJournalParticipants(actorRole, actorUserId, participants)
  const showAssigneePicker = pageType === 'shared'

  function handleSubmit() {
    const trimmed = title.trim()
    if (!trimmed || disabled) {
      return
    }
    onCreate({
      title: trimmed,
      details: details.trim(),
      responsibleUserId: pageType === 'personal' ? actorUserId : responsibleUserId,
      targetTime,
    })
    setTitle('')
    setDetails('')
    setTargetTime('')
    setResponsibleUserId(actorUserId)
  }

  return (
    <form
      className="management-journal__composer"
      data-testid="journal-add-task-composer"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <h3 className="management-journal__composer-title">{MANAGEMENT_JOURNAL_ADD_TASK_LABEL}</h3>
      <label className="management-journal__field">
        <span>טקסט המשימה</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          disabled={disabled}
        />
      </label>
      <label className="management-journal__field">
        <span>הנחיות</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          disabled={disabled}
          rows={2}
        />
      </label>
      {showAssigneePicker ? (
        <label className="management-journal__field" data-testid="journal-assignee-picker">
          <span>אחראית</span>
          <select
            value={responsibleUserId}
            onChange={(event) => setResponsibleUserId(event.target.value)}
            disabled={disabled}
          >
            {assignable.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="management-journal__self-assignee" data-testid="journal-personal-self-assignee">
          אחראית: את
        </p>
      )}
      <label className="management-journal__field">
        <span>שעת יעד (אופציונלי)</span>
        <input
          type="time"
          value={targetTime}
          onChange={(event) => setTargetTime(event.target.value)}
          disabled={disabled}
        />
      </label>
      <button
        type="submit"
        className="ds-btn ds-btn--primary management-journal__primary"
        disabled={disabled || !title.trim()}
      >
        {MANAGEMENT_JOURNAL_ADD_TASK_LABEL}
      </button>
    </form>
  )
}
