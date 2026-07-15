import type { MeetingDurationMinutes } from '../../types/meetingCalendar'
import {
  createEmptySlotDraft,
  draftSlotsToProposedInputs,
  type SlotDraft,
} from '../../utils/meetingCalendarForm'
import { MEETING_MAX_SLOTS, MEETING_MIN_SLOTS } from '../../types/meetingCalendar'
import { translateMeetingDuration } from '../../utils/meetingCalendarDisplay'

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
    <fieldset className="mc-slots-form">
      <legend>הצעת מועדים ({translateMeetingDuration(durationMinutes)})</legend>
      <p className="mc-help-text">יש להציע בין {MEETING_MIN_SLOTS} ל־{MEETING_MAX_SLOTS} מועדים מדויקים.</p>

      {drafts.map((draft, index) => {
        const preview = draftSlotsToProposedInputs([draft], durationMinutes)
        const endPreview =
          preview.ok && preview.slots[0]
            ? new Date(preview.slots[0].endsAt).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—'

        return (
          <div key={draft.id} className="mc-slot-row">
            <p className="mc-slot-row__title">מועד {index + 1}</p>
            <label className="ds-field">
              <span>תאריך</span>
              <input
                type="date"
                value={draft.date}
                onChange={(event) => updateDraft(draft.id, { date: event.target.value })}
              />
            </label>
            <label className="ds-field">
              <span>שעת התחלה</span>
              <input
                type="time"
                value={draft.startTime}
                onChange={(event) => updateDraft(draft.id, { startTime: event.target.value })}
              />
            </label>
            <p className="mc-slot-end">שעת סיום מחושבת: {endPreview}</p>
            <button
              type="button"
              className="ds-button ds-button--secondary"
              onClick={() => removeDraft(draft.id)}
            >
              הסרת מועד
            </button>
          </div>
        )
      })}

      <div className="mc-actions">
        <button
          type="button"
          className="ds-button ds-button--secondary"
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
