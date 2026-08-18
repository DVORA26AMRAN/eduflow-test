import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../utils/bodyScrollLock'
import {
  TEACHER_INACTIVITY_CONTINUE_LABEL,
  TEACHER_INACTIVITY_WARNING_TEXT,
} from '../../security/teacherInactivityPolicy'
import './TeacherInactivityWarningDialog.css'

type TeacherInactivityWarningDialogProps = {
  isOpen: boolean
  remainingMs: number
  onContinueWorking: () => void
}

function formatRemainingLabel(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds} שניות`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Teacher inactivity warning — Hebrew copy fixed by security policy.
 * Continue is the only dismiss path (no silent close that skips reset).
 */
export function TeacherInactivityWarningDialog({
  isOpen,
  remainingMs,
  onContinueWorking,
}: TeacherInactivityWarningDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <div
      className="teacher-inactivity-warning"
      dir="rtl"
      role="presentation"
      data-testid="teacher-inactivity-warning"
    >
      <div
        ref={panelRef}
        className="teacher-inactivity-warning__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="teacher-inactivity-warning__title">
          {TEACHER_INACTIVITY_WARNING_TEXT}
        </h2>
        <p className="teacher-inactivity-warning__countdown" aria-live="polite">
          זמן נותר: {formatRemainingLabel(remainingMs)}
        </p>
        <button
          type="button"
          className="ds-btn ds-btn--primary teacher-inactivity-warning__continue"
          onClick={onContinueWorking}
        >
          {TEACHER_INACTIVITY_CONTINUE_LABEL}
        </button>
      </div>
    </div>,
    document.body,
  )
}
