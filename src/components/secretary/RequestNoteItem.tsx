import { useState } from 'react'
import type { RequestNote } from '../../types/note'
import { formatRequestDateTime } from '../../utils/requests'

type RequestNoteItemProps = {
  note: RequestNote
  isSaving: boolean
  onUpdate: (noteId: string, noteText: string) => Promise<boolean>
  onDelete: (noteId: string) => Promise<boolean>
}

function wasNoteUpdated(note: RequestNote): boolean {
  return new Date(note.updated_at).getTime() > new Date(note.created_at).getTime()
}

export function RequestNoteItem({
  note,
  isSaving,
  onUpdate,
  onDelete,
}: RequestNoteItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(note.note_text)

  async function handleSaveEdit() {
    const success = await onUpdate(note.id, editText)
    if (success) {
      setIsEditing(false)
    }
  }

  function handleCancelEdit() {
    setEditText(note.note_text)
    setIsEditing(false)
  }

  async function handleDelete() {
    await onDelete(note.id)
  }

  return (
    <li className="secretary-dashboard__note-item">
      {isEditing ? (
        <div className="secretary-dashboard__note-edit">
          <textarea
            className="secretary-dashboard__notes-textarea"
            rows={4}
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            disabled={isSaving}
          />
          <div className="secretary-dashboard__note-actions">
            <button
              type="button"
              className="secretary-dashboard__note-soft-button secretary-dashboard__note-soft-button--primary"
              onClick={() => void handleSaveEdit()}
              disabled={isSaving}
            >
              שמירה
            </button>
            <button
              type="button"
              className="secretary-dashboard__note-soft-button"
              onClick={handleCancelEdit}
              disabled={isSaving}
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="secretary-dashboard__note-body">
          <p className="secretary-dashboard__note-text">{note.note_text}</p>
          <div className="secretary-dashboard__note-meta-group">
            {note.created_by_full_name && (
              <p className="secretary-dashboard__note-meta">
                נוצר על ידי: {note.created_by_full_name}
              </p>
            )}
            <p className="secretary-dashboard__note-meta">
              נוצר: {formatRequestDateTime(note.created_at)}
            </p>
            {wasNoteUpdated(note) && (
              <p className="secretary-dashboard__note-meta">
                עודכן: {formatRequestDateTime(note.updated_at)}
              </p>
            )}
          </div>
          <div className="secretary-dashboard__note-actions">
            <button
              type="button"
              className="secretary-dashboard__note-icon-button secretary-dashboard__note-icon-button--edit"
              onClick={() => setIsEditing(true)}
              disabled={isSaving}
              aria-label="עריכה"
              title="עריכה"
            >
              ✎
            </button>
            <button
              type="button"
              className="secretary-dashboard__note-icon-button secretary-dashboard__note-icon-button--delete"
              onClick={() => void handleDelete()}
              disabled={isSaving}
              aria-label="מחיקה"
              title="מחיקה"
            >
              🗑
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
