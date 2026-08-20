import { useState } from 'react'
import type {
  ManagementJournalParticipant,
  ManagementJournalTask,
  ManagementJournalTaskStatus,
} from '../../types/managementJournal'
import type { PrimaryRole } from '../../types/user'
import {
  MANAGEMENT_JOURNAL_CARRIED_LABEL,
  MANAGEMENT_JOURNAL_NOTE_LABEL,
  MANAGEMENT_JOURNAL_STATUS_LABELS,
  MANAGEMENT_JOURNAL_UNASSIGNED_LABEL,
  canAssignManagementJournalTask,
  canReassignManagementJournalTaskUi,
  filterAssignableJournalParticipants,
  formatManagementJournalTargetTime,
  isManagementJournalTaskStatus,
  translateManagementJournalTaskStatus,
} from '../../utils/managementJournalDisplay'

const STATUS_OPTIONS: ManagementJournalTaskStatus[] = ['new', 'in_progress', 'completed', 'blocked']

type ManagementJournalTaskRowProps = {
  task: ManagementJournalTask
  actorUserId: string
  actorRole: PrimaryRole
  pageType: 'personal' | 'shared'
  participants: ManagementJournalParticipant[]
  readOnly: boolean
  busy: boolean
  onUpdateStatus: (task: ManagementJournalTask, nextStatus: ManagementJournalTaskStatus) => void
  onUpdateNote: (task: ManagementJournalTask, note: string) => void
  onUpdateContent: (task: ManagementJournalTask, input: { title: string; details: string; targetTime: string }) => void
  onAssign: (task: ManagementJournalTask, targetUserId: string) => void
}

export function ManagementJournalTaskRow({
  task,
  actorUserId,
  actorRole,
  pageType,
  participants,
  readOnly,
  busy,
  onUpdateStatus,
  onUpdateNote,
  onUpdateContent,
  onAssign,
}: ManagementJournalTaskRowProps) {
  const responsible = participants.find((participant) => participant.userId === task.responsibleUserId)
  const isResponsible = task.responsibleUserId === actorUserId
  const isCreator = task.createdByUserId === actorUserId
  const canEditStatus = !readOnly && isResponsible
  const canEditNote = !readOnly && isResponsible
  const canEditContent = !readOnly && isCreator
  const assignable = filterAssignableJournalParticipants(actorRole, actorUserId, participants)
  const canReassign =
    !readOnly &&
    canReassignManagementJournalTaskUi(actorRole, pageType) &&
    assignable.some((participant) =>
      canAssignManagementJournalTask(actorRole, actorUserId, participant.primaryRole, participant.userId),
    )
  const [noteDraft, setNoteDraft] = useState(task.note ?? '')
  const [editingContent, setEditingContent] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [detailsDraft, setDetailsDraft] = useState(task.details ?? '')
  const [timeDraft, setTimeDraft] = useState(formatManagementJournalTargetTime(task.targetTime) ?? '')
  const [assignTo, setAssignTo] = useState(task.responsibleUserId ?? '')
  const displayTime = formatManagementJournalTargetTime(task.targetTime)

  return (
    <article className="management-journal__task-block" data-testid={`journal-task-${task.id}`}>
      <div className="management-journal__task-main">
        <h4 className="management-journal__task-title">{task.title}</h4>
        {task.carriedForward ? (
          <span className="management-journal__carried" data-testid="journal-carried-label">
            {MANAGEMENT_JOURNAL_CARRIED_LABEL}
          </span>
        ) : null}
      </div>

      <dl className="management-journal__task-meta">
        {displayTime ? (
          <div>
            <dt>שעה</dt>
            <dd>{displayTime}</dd>
          </div>
        ) : null}
        <div>
          <dt>אחראית</dt>
          <dd>
            {task.responsibleUserId ? (
              responsible?.fullName ?? 'אחראית'
            ) : (
              <strong data-testid="journal-unassigned-label">{MANAGEMENT_JOURNAL_UNASSIGNED_LABEL}</strong>
            )}
          </dd>
        </div>
        <div>
          <dt>סטטוס</dt>
          <dd>
            {canEditStatus ? (
              <select
                aria-label="סטטוס משימה"
                value={task.status}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value
                  if (isManagementJournalTaskStatus(next)) {
                    onUpdateStatus(task, next)
                  }
                }}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {MANAGEMENT_JOURNAL_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            ) : (
              <span data-testid="journal-status-readonly">{translateManagementJournalTaskStatus(task.status)}</span>
            )}
          </dd>
        </div>
      </dl>

      {task.details ? <p className="management-journal__task-details">{task.details}</p> : null}

      {task.note && !canEditNote ? (
        <p className="management-journal__task-note">
          <span>{MANAGEMENT_JOURNAL_NOTE_LABEL}: </span>
          {task.note}
        </p>
      ) : null}

      {canEditNote ? (
        <label className="management-journal__field">
          <span>{MANAGEMENT_JOURNAL_NOTE_LABEL}</span>
          <textarea
            value={noteDraft}
            disabled={busy}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={2}
          />
          <button
            type="button"
            className="management-journal__secondary"
            disabled={busy}
            onClick={() => onUpdateNote(task, noteDraft)}
          >
            שמירת הערה
          </button>
        </label>
      ) : null}

      {canEditContent ? (
        <div className="management-journal__content-edit">
          {editingContent ? (
            <>
              <label className="management-journal__field">
                <span>טקסט המשימה</span>
                <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} disabled={busy} />
              </label>
              <label className="management-journal__field">
                <span>הנחיות</span>
                <textarea
                  value={detailsDraft}
                  onChange={(event) => setDetailsDraft(event.target.value)}
                  disabled={busy}
                  rows={2}
                />
              </label>
              <label className="management-journal__field">
                <span>שעת יעד</span>
                <input
                  type="time"
                  value={timeDraft}
                  onChange={(event) => setTimeDraft(event.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="management-journal__secondary"
                disabled={busy || !titleDraft.trim()}
                onClick={() => {
                  onUpdateContent(task, {
                    title: titleDraft.trim(),
                    details: detailsDraft,
                    targetTime: timeDraft,
                  })
                  setEditingContent(false)
                }}
              >
                שמירת תוכן
              </button>
            </>
          ) : (
            <button type="button" className="management-journal__secondary" onClick={() => setEditingContent(true)}>
              עריכת תוכן המשימה
            </button>
          )}
        </div>
      ) : null}

      {canReassign ? (
        <div className="management-journal__reassign" data-testid="journal-reassign">
          <label className="management-journal__field">
            <span>העברת אחריות</span>
            <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)} disabled={busy}>
              <option value="">בחירת אחראית</option>
              {assignable.map((participant) => (
                <option key={participant.userId} value={participant.userId}>
                  {participant.fullName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="management-journal__secondary"
            disabled={busy || !assignTo}
            onClick={() => onAssign(task, assignTo)}
          >
            עדכון אחראית
          </button>
        </div>
      ) : null}
    </article>
  )
}
