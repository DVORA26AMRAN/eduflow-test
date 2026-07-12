import { useCallback, useEffect, useState } from 'react'
import type { RequestNote } from '../../types/note'
import {
  NOTE_CREATE_SUCCESS_MESSAGE,
  NOTE_DELETE_SUCCESS_MESSAGE,
  NOTE_UPDATE_SUCCESS_MESSAGE,
  NOTES_EMPTY_MESSAGE,
  NOTES_LOADING_MESSAGE,
} from '../../types/note'
import {
  createRequestNote,
  deleteRequestNote,
  loadRequestNotes,
  updateRequestNote,
} from '../../services/notes'
import { RequestNoteItem } from '../secretary/RequestNoteItem'

type RequestDetailsNotesSectionProps = {
  requestId: string
  isActive: boolean
}

export function RequestDetailsNotesSection({
  requestId,
  isActive,
}: RequestDetailsNotesSectionProps) {
  const [notes, setNotes] = useState<RequestNote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [newNoteText, setNewNoteText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionMessageIsError, setActionMessageIsError] = useState(false)

  const fetchNotes = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    setActionMessage('')

    const result = await loadRequestNotes(requestId)

    if (!result.ok) {
      setNotes([])
      setLoadError(result.errorMessage)
    } else {
      setNotes(result.notes)
    }

    setIsLoading(false)
  }, [requestId])

  useEffect(() => {
    if (!isActive) {
      return
    }

    queueMicrotask(() => {
      setNewNoteText('')
      setActionMessage('')
      setActionMessageIsError(false)
      void fetchNotes()
    })
  }, [isActive, fetchNotes])

  async function handleCreateNote() {
    const trimmedText = newNoteText.trim()
    if (!trimmedText) {
      return
    }

    setIsSaving(true)
    setActionMessage('')

    const result = await createRequestNote({
      requestId,
      noteText: trimmedText,
    })

    setIsSaving(false)

    if (!result.ok) {
      setActionMessage(result.errorMessage)
      setActionMessageIsError(true)
      return
    }

    setNotes((currentNotes) => [...currentNotes, result.note])
    setNewNoteText('')
    setActionMessage(NOTE_CREATE_SUCCESS_MESSAGE)
    setActionMessageIsError(false)
  }

  async function handleUpdateNote(noteId: string, noteText: string): Promise<boolean> {
    setIsSaving(true)
    setActionMessage('')

    const result = await updateRequestNote({ noteId, noteText })

    setIsSaving(false)

    if (!result.ok) {
      setActionMessage(result.errorMessage)
      setActionMessageIsError(true)
      return false
    }

    const reloadResult = await loadRequestNotes(requestId)
    if (reloadResult.ok) {
      setNotes(reloadResult.notes)
    }

    setActionMessage(NOTE_UPDATE_SUCCESS_MESSAGE)
    setActionMessageIsError(false)
    return true
  }

  async function handleDeleteNote(noteId: string): Promise<boolean> {
    setIsSaving(true)
    setActionMessage('')

    const result = await deleteRequestNote(noteId)

    setIsSaving(false)

    if (!result.ok) {
      setActionMessage(result.errorMessage)
      setActionMessageIsError(true)
      return false
    }

    setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId))
    setActionMessage(NOTE_DELETE_SUCCESS_MESSAGE)
    setActionMessageIsError(false)
    return true
  }

  return (
    <section className="request-details__section" aria-label="הערות פנימיות">
      <h3 className="request-details__section-title">הערות פנימיות</h3>

      <div className="secretary-dashboard__notes-paper">
        {isLoading && (
          <p className="ds-form-message secretary-dashboard__notes-status">{NOTES_LOADING_MESSAGE}</p>
        )}

        {!isLoading && loadError && (
          <p className="ds-form-message ds-form-message--error secretary-dashboard__notes-status">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && notes.length === 0 && (
          <div className="ds-state secretary-dashboard__notes-empty">
            <span className="ds-state__icon" aria-hidden="true">
              📝
            </span>
            <p className="ds-state__title">{NOTES_EMPTY_MESSAGE}</p>
          </div>
        )}

        {!isLoading && !loadError && notes.length > 0 && (
          <ul className="secretary-dashboard__notes-list">
            {notes.map((note) => (
              <RequestNoteItem
                key={note.id}
                note={note}
                isSaving={isSaving}
                onUpdate={handleUpdateNote}
                onDelete={handleDeleteNote}
              />
            ))}
          </ul>
        )}

        {!isLoading && !loadError && (
          <div className="secretary-dashboard__notes-compose">
            <textarea
              className="ds-textarea secretary-dashboard__notes-textarea secretary-dashboard__notes-textarea--compose"
              rows={4}
              value={newNoteText}
              onChange={(event) => setNewNoteText(event.target.value)}
              placeholder="הוספת הערה..."
              disabled={isSaving}
            />
            <p className="ds-helper-text">ההערות פנימיות בלבד ומיועדות לצוות המזכירות.</p>
            <div className="ds-form-actions">
              <button
                type="button"
                className="ds-btn ds-btn--primary secretary-dashboard__notes-save-button"
                onClick={() => void handleCreateNote()}
                disabled={isSaving || !newNoteText.trim()}
              >
                שמירת הערה
              </button>
            </div>
          </div>
        )}
      </div>

      {actionMessage && (
        <p
          className={
            actionMessageIsError
              ? 'secretary-dashboard__notes-feedback ds-form-message ds-form-message--error'
              : 'secretary-dashboard__notes-feedback ds-form-message ds-form-message--success'
          }
        >
          {actionMessage}
        </p>
      )}
    </section>
  )
}
