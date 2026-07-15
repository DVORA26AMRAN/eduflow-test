import { useId, useMemo, useState } from 'react'
import { translateRole } from '../../utils/roles'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'
import { searchMeetingRecipients } from '../../utils/meetingCalendarDisplay'
import { Modal } from '../ui/Modal'
import './MeetingCalendar.css'

type MeetingRecipientPickerProps = {
  isOpen: boolean
  recipients: MeetingUserDirectoryEntry[]
  selectedRecipientId: string | null
  onClose: () => void
  onSelect: (recipient: MeetingUserDirectoryEntry) => void
}

export function MeetingRecipientPicker({
  isOpen,
  recipients,
  selectedRecipientId,
  onClose,
  onSelect,
}: MeetingRecipientPickerProps) {
  const searchId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')

  const filtered = useMemo(
    () => searchMeetingRecipients(recipients, query),
    [recipients, query],
  )

  return (
    <Modal isOpen={isOpen} title="בחירת נמען לפגישה" onClose={onClose} size="medium">
      <div className="mc-recipient-picker">
        <label className="ds-field" htmlFor={searchId}>
          <span>חיפוש לפי שם</span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="הקלידו שם משתמש"
            autoComplete="off"
          />
        </label>

        <div
          id={listId}
          className="mc-recipient-list"
          role="radiogroup"
          aria-label="נמענים זמינים לתיאום פגישה"
        >
          {filtered.length === 0 ? (
            <p className="ds-empty-state">לא נמצאו נמענים מתאימים.</p>
          ) : (
            filtered.map((recipient) => {
              const inputId = `${listId}-${recipient.id}`
              return (
                <label key={recipient.id} className="mc-recipient-option" htmlFor={inputId}>
                  <input
                    id={inputId}
                    type="radio"
                    name="meeting-recipient"
                    checked={selectedRecipientId === recipient.id}
                    onChange={() => onSelect(recipient)}
                  />
                  <span className="mc-recipient-option__body">
                    <strong>{recipient.fullName}</strong>
                    <span>{translateRole(recipient.primaryRole)}</span>
                  </span>
                </label>
              )
            })
          )}
        </div>

        <div className="mc-actions">
          <button type="button" className="ds-button ds-button--secondary" onClick={onClose}>
            סיום בחירה
          </button>
        </div>
      </div>
    </Modal>
  )
}
