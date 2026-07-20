import { useId } from 'react'
import type { MeetingDurationMinutes } from '../../types/meetingCalendar'
import { MEETING_MAX_SLOTS, MEETING_MIN_SLOTS } from '../../types/meetingCalendar'
import {
  createEmptySlotDraft,
  draftSlotsToProposedInputs,
  type SlotDraft,
} from '../../utils/meetingCalendarForm'
import { translateMeetingDuration } from '../../utils/meetingCalendarDisplay'
import './MeetingCalendar.css'

type MeetingProposeSlotsFormProps = {
  durationMinutes: MeetingDurationMinutes
  drafts: SlotDraft[]
  onDraftsChange: (drafts: SlotDraft[]) => void
  validationMessage: string
}

export function MeetingProposeSlotsForm({
  durationMinutes,
  drafts,
  onDraftsChange,
  validationMessage,
}: MeetingProposeSlotsFormProps) {
  const formId = useId()

  function updateDraft(id: string, patch: Partial<SlotDraft>) {
    onDraftsChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  function addDraft() {
    if (drafts.length >= MEETING_MAX_SLOTS) {
      return
    }
    onDraftsChange([...drafts, createEmptySlotDraft()])
  }

  function removeDraft(id: string) {
    if (drafts.length <= MEETING_MIN_SLOTS) {
      onDraftsChange([createEmptySlotDraft()])
      return
    }
    onDraftsChange(drafts.filter((draft) => draft.id !== id))
  }

  return (
    <fieldset className="ds-fieldset mc-slots-form">
      <legend className="ds-label">
        הצעת מועדים ({translateMeetingDuration(durationMinutes)})
      </legend>
      <p className="mc-help-text">
        יש להציע בין {MEETING_MIN_SLOTS} ל־{MEETING_MAX_SLOTS} מועדים מדויקים.
      </p>

      <div className="mc-slot-rows">
        {drafts.map((draft, index) => {
          const dateId = `${formId}-date-${draft.id}`
          const timeId = `${formId}-time-${draft.id}`
          const preview = draftSlotsToProposedInputs([draft], durationMinutes)
          const endPreview =
            preview.ok && preview.slots[0]
              ? new Date(preview.slots[0].endsAt).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'

          return (
            <article key={draft.id} className="mc-slot-row" aria-labelledby={`${formId}-title-${draft.id}`}>
              <p id={`${formId}-title-${draft.id}`} className="mc-slot-row__title">
                מועד {index + 1}
              </p>

              <div className="mc-slot-row__fields">
                <label className="ds-field" htmlFor={dateId}>
                  <span className="ds-label">תאריך</span>
                  <input
                    id={dateId}
                    className="ds-input"
                    type="date"
                    value={draft.date}
                    onChange={(event) => updateDraft(draft.id, { date: event.target.value })}
                  />
                </label>

                <label className="ds-field" htmlFor={timeId}>
                  <span className="ds-label">שעת התחלה</span>
                  <input
                    id={timeId}
                    className="ds-input"
                    type="time"
                    value={draft.startTime}
                    onChange={(event) => updateDraft(draft.id, { startTime: event.target.value })}
                  />
                </label>
              </div>

              <p className="mc-slot-end ds-helper-text">שעת סיום מחושבת: {endPreview}</p>

              <div className="mc-slot-row__actions">
                <button
                  type="button"
                  className="ds-btn ds-btn--danger mc-slot-row__remove"
                  onClick={() => removeDraft(draft.id)}
                  aria-label={`הסרת מועד ${index + 1}`}
                >
                  הסרת מועד
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <div className="mc-actions">
        <button
          type="button"
          className="ds-btn ds-btn--primary"
          onClick={addDraft}
          disabled={drafts.length >= MEETING_MAX_SLOTS}
        >
          הוספת מועד
        </button>
      </div>

      {validationMessage ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {validationMessage}
        </p>
      ) : null}
    </fieldset>
  )
}
