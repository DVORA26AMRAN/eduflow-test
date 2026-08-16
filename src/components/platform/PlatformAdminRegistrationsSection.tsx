import { useCallback, useEffect, useState } from 'react'
import {
  APPLICANT_ROLE_LABELS,
  REGISTRATION_ACTIVITY_LABELS,
  REGISTRATION_STATUS_LABELS,
  SCHOOL_REGISTRATION_NOTE_MAX_LENGTH,
  SCHOOL_REGISTRATION_PATH,
  SCHOOL_REGISTRATION_STATUSES,
  type SchoolRegistrationActivity,
  type SchoolRegistrationNote,
  type SchoolRegistrationRecord,
  type SchoolRegistrationStatus,
} from '../../types/schoolRegistration'
import {
  addSchoolRegistrationNoteForPlatformAdmin,
  loadSchoolRegistrationActivityForPlatformAdmin,
  loadSchoolRegistrationForPlatformAdmin,
  loadSchoolRegistrationNotesForPlatformAdmin,
  loadSchoolRegistrationsForPlatformAdmin,
  setSchoolRegistrationFollowUpForPlatformAdmin,
  updateSchoolRegistrationStatusForPlatformAdmin,
} from '../../services/schoolRegistration'
import { getSchoolRegistrationPublicUrl } from '../../utils/schoolRegistrationForm'
import {
  followUpUrgencyLabel,
  fromDateTimeLocalValue,
  getFollowUpUrgency,
  toDateTimeLocalValue,
} from '../../utils/schoolRegistrationSales'
import './PlatformAdminRegistrationsSection.css'

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function activityDetail(activity: SchoolRegistrationActivity): string {
  const payload = activity.payload
  switch (activity.eventType) {
    case 'status_changed': {
      const previous = payload.previous_status
      const next = payload.new_status
      const previousLabel =
        typeof previous === 'string' && previous in REGISTRATION_STATUS_LABELS
          ? REGISTRATION_STATUS_LABELS[previous as SchoolRegistrationStatus]
          : String(previous ?? '')
      const nextLabel =
        typeof next === 'string' && next in REGISTRATION_STATUS_LABELS
          ? REGISTRATION_STATUS_LABELS[next as SchoolRegistrationStatus]
          : String(next ?? '')
      return `${previousLabel} → ${nextLabel}`
    }
    case 'note_added': {
      const preview = typeof payload.preview === 'string' ? payload.preview : ''
      return preview
    }
    case 'follow_up_set':
    case 'follow_up_rescheduled': {
      const at = payload.follow_up_at
      return typeof at === 'string' ? formatDateTime(at) : ''
    }
    case 'follow_up_cleared':
      return 'בוטל'
    default:
      return ''
  }
}

export function PlatformAdminRegistrationsSection() {
  const [registrations, setRegistrations] = useState<SchoolRegistrationRecord[]>([])
  const [selected, setSelected] = useState<SchoolRegistrationRecord | null>(null)
  const [notes, setNotes] = useState<SchoolRegistrationNote[]>([])
  const [activities, setActivities] = useState<SchoolRegistrationActivity[]>([])
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [draftStatus, setDraftStatus] = useState<SchoolRegistrationStatus>('new')
  const [draftFollowUp, setDraftFollowUp] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const publicUrl = getSchoolRegistrationPublicUrl()

  const reload = useCallback(async () => {
    setIsLoading(true)
    setListError('')
    const result = await loadSchoolRegistrationsForPlatformAdmin()
    setIsLoading(false)
    if (!result.ok) {
      setListError(result.errorMessage)
      setRegistrations([])
      return
    }
    setRegistrations(result.registrations)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void reload()
    })
  }, [reload])

  async function handleCopyLink() {
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopyMessage('הקישור הועתק')
    } catch {
      setCopyMessage('העתקת הקישור נכשלה')
    }
  }

  function handlePreviewForm() {
    window.open(publicUrl, '_blank', 'noopener,noreferrer')
  }

  async function loadDetailBundle(id: string) {
    setIsDetailLoading(true)
    setDetailError('')
    setActionError('')
    setActionMessage('')

    const [registrationResult, notesResult, activityResult] = await Promise.all([
      loadSchoolRegistrationForPlatformAdmin(id),
      loadSchoolRegistrationNotesForPlatformAdmin(id),
      loadSchoolRegistrationActivityForPlatformAdmin(id),
    ])

    setIsDetailLoading(false)

    if (!registrationResult.ok) {
      setDetailError(registrationResult.errorMessage)
      setSelected(null)
      setNotes([])
      setActivities([])
      return
    }

    setSelected(registrationResult.registration)
    setDraftStatus(registrationResult.registration.status)
    setDraftFollowUp(toDateTimeLocalValue(registrationResult.registration.followUpAt))
    setNotes(notesResult.ok ? notesResult.notes : [])
    setActivities(activityResult.ok ? activityResult.activities : [])
    if (!notesResult.ok) {
      setActionError(notesResult.errorMessage)
    } else if (!activityResult.ok) {
      setActionError(activityResult.errorMessage)
    }
  }

  async function openDetails(id: string) {
    await loadDetailBundle(id)
  }

  function closeDetails() {
    setSelected(null)
    setNotes([])
    setActivities([])
    setDraftNote('')
    setActionError('')
    setActionMessage('')
  }

  async function refreshAfterMutation(registrationId: string) {
    await Promise.all([loadDetailBundle(registrationId), reload()])
  }

  async function handleSaveStatus() {
    if (!selected) return
    setIsSaving(true)
    setActionError('')
    setActionMessage('')
    const result = await updateSchoolRegistrationStatusForPlatformAdmin(
      selected.id,
      draftStatus,
    )
    setIsSaving(false)
    if (!result.ok) {
      setActionError(result.errorMessage)
      return
    }
    setActionMessage('הסטטוס עודכן')
    await refreshAfterMutation(selected.id)
  }

  async function handleSaveFollowUp() {
    if (!selected) return
    setIsSaving(true)
    setActionError('')
    setActionMessage('')
    const iso = fromDateTimeLocalValue(draftFollowUp)
    const result = await setSchoolRegistrationFollowUpForPlatformAdmin(selected.id, iso)
    setIsSaving(false)
    if (!result.ok) {
      setActionError(result.errorMessage)
      return
    }
    setActionMessage(iso ? 'המעקב עודכן' : 'המעקב בוטל')
    await refreshAfterMutation(selected.id)
  }

  async function handleClearFollowUp() {
    if (!selected) return
    setDraftFollowUp('')
    setIsSaving(true)
    setActionError('')
    setActionMessage('')
    const result = await setSchoolRegistrationFollowUpForPlatformAdmin(selected.id, null)
    setIsSaving(false)
    if (!result.ok) {
      setActionError(result.errorMessage)
      return
    }
    setActionMessage('המעקב בוטל')
    await refreshAfterMutation(selected.id)
  }

  async function handleAddNote() {
    if (!selected) return
    setIsSaving(true)
    setActionError('')
    setActionMessage('')
    const result = await addSchoolRegistrationNoteForPlatformAdmin(selected.id, draftNote)
    setIsSaving(false)
    if (!result.ok) {
      setActionError(result.errorMessage)
      return
    }
    setDraftNote('')
    setActionMessage('ההערה נוספה')
    await refreshAfterMutation(selected.id)
  }

  return (
    <div className="platform-admin-registrations">
      <section
        className="platform-admin-registrations__link-card"
        aria-label="קישור להרשמה ציבורית"
      >
        <h2 className="platform-admin-registrations__heading">טופס הרשמה ציבורי</h2>
        <p className="platform-admin-registrations__hint">
          הטופס זמין ללא התחברות ואינו מעניק גישה למערכת.
        </p>
        <code className="platform-admin-registrations__url">{publicUrl}</code>
        <div className="platform-admin-registrations__link-actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={handleCopyLink}>
            העתקת קישור
          </button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={handlePreviewForm}>
            תצוגה מקדימה
          </button>
        </div>
        {copyMessage ? (
          <p className="ds-form-message platform-admin-registrations__copy-msg" role="status">
            {copyMessage}
          </p>
        ) : null}
        <p className="platform-admin-registrations__path-note">
          נתיב: <span>{SCHOOL_REGISTRATION_PATH}</span>
        </p>
      </section>

      <section aria-label="רשימת הרשמות">
        <div className="platform-admin-registrations__list-header">
          <h2 className="platform-admin-registrations__heading">הרשמות שהתקבלו</h2>
          <button type="button" className="ds-btn ds-btn--secondary" onClick={() => void reload()}>
            רענון
          </button>
        </div>

        {listError ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {listError}
          </p>
        ) : null}

        {isLoading ? (
          <p className="platform-admin-registrations__empty">טוען...</p>
        ) : registrations.length === 0 ? (
          <p className="platform-admin-registrations__empty">אין הרשמות עדיין.</p>
        ) : (
          <div className="platform-admin-registrations__table-wrap">
            <table className="platform-admin-registrations__table">
              <thead>
                <tr>
                  <th scope="col">בית ספר</th>
                  <th scope="col">סמל מוסד</th>
                  <th scope="col">איש קשר</th>
                  <th scope="col">טלפון</th>
                  <th scope="col">סטטוס</th>
                  <th scope="col">מעקב</th>
                  <th scope="col">נשלח ב־</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((row) => {
                  const urgency = getFollowUpUrgency(row.followUpAt)
                  const rowClass =
                    urgency === 'overdue'
                      ? 'platform-admin-registrations__row--overdue'
                      : urgency === 'due_today'
                        ? 'platform-admin-registrations__row--due-today'
                        : row.status === 'new'
                          ? 'platform-admin-registrations__row--new'
                          : undefined
                  return (
                    <tr key={row.id} className={rowClass}>
                      <td>
                        <button
                          type="button"
                          className="platform-admin-registrations__row-link"
                          onClick={() => void openDetails(row.id)}
                        >
                          {row.schoolName}
                        </button>
                      </td>
                      <td>{row.institutionSymbol}</td>
                      <td>{row.contactFullName}</td>
                      <td>
                        <a href={`tel:${row.phone}`}>{row.phone}</a>
                      </td>
                      <td>
                        <span
                          className={`platform-admin-registrations__status platform-admin-registrations__status--${row.status}`}
                        >
                          {REGISTRATION_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td>
                        {row.followUpAt ? (
                          <span
                            className={`platform-admin-registrations__follow-up platform-admin-registrations__follow-up--${urgency}`}
                          >
                            {formatDateTime(row.followUpAt)}
                            {urgency !== 'none' && urgency !== 'future' ? (
                              <span className="platform-admin-registrations__follow-up-tag">
                                {followUpUrgencyLabel(urgency)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatDateTime(row.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detailError ? (
        <p className="ds-form-message ds-form-message--error" role="alert">
          {detailError}
        </p>
      ) : null}

      {selected ? (
        <div
          className="platform-admin-registrations__modal-backdrop"
          role="presentation"
          onClick={closeDetails}
        >
          <div
            className="platform-admin-registrations__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-details-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="platform-admin-registrations__modal-header">
              <h3 id="registration-details-title">פרטי הרשמה</h3>
              <button type="button" className="ds-btn ds-btn--secondary" onClick={closeDetails}>
                סגירה
              </button>
            </header>

            {isDetailLoading ? (
              <p className="platform-admin-registrations__empty">טוען פרטים...</p>
            ) : (
              <>
                <dl className="platform-admin-registrations__details">
                  <div>
                    <dt>שם בית הספר</dt>
                    <dd>{selected.schoolName}</dd>
                  </div>
                  <div>
                    <dt>סמל מוסד</dt>
                    <dd>{selected.institutionSymbol}</dd>
                  </div>
                  <div>
                    <dt>עיר</dt>
                    <dd>{selected.city}</dd>
                  </div>
                  <div>
                    <dt>תפקיד</dt>
                    <dd>{APPLICANT_ROLE_LABELS[selected.applicantRole]}</dd>
                  </div>
                  <div>
                    <dt>שם מלא</dt>
                    <dd>{selected.contactFullName}</dd>
                  </div>
                  <div>
                    <dt>אימייל</dt>
                    <dd>
                      <a href={`mailto:${selected.email}`}>{selected.email}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>טלפון</dt>
                    <dd>
                      <a
                        className="platform-admin-registrations__tel-action"
                        href={`tel:${selected.phone}`}
                      >
                        חייג {selected.phone}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>נשלח ב־</dt>
                    <dd>{formatDateTime(selected.createdAt)}</dd>
                  </div>
                </dl>

                <section
                  className="platform-admin-registrations__panel"
                  aria-label="עדכון סטטוס"
                >
                  <h4>סטטוס</h4>
                  <div className="platform-admin-registrations__inline-form">
                    <label className="platform-admin-registrations__field">
                      <span className="visually-hidden">סטטוס נוכחי</span>
                      <select
                        value={draftStatus}
                        onChange={(event) =>
                          setDraftStatus(event.target.value as SchoolRegistrationStatus)
                        }
                        disabled={isSaving}
                      >
                        {SCHOOL_REGISTRATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {REGISTRATION_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ds-btn ds-btn--primary"
                      disabled={isSaving || draftStatus === selected.status}
                      onClick={() => void handleSaveStatus()}
                    >
                      עדכון סטטוס
                    </button>
                  </div>
                </section>

                <section
                  className="platform-admin-registrations__panel"
                  aria-label="מעקב"
                >
                  <h4>מעקב</h4>
                  <div className="platform-admin-registrations__inline-form">
                    <label className="platform-admin-registrations__field">
                      <span className="visually-hidden">תאריך ושעת מעקב</span>
                      <input
                        type="datetime-local"
                        value={draftFollowUp}
                        onChange={(event) => setDraftFollowUp(event.target.value)}
                        disabled={isSaving}
                      />
                    </label>
                    <button
                      type="button"
                      className="ds-btn ds-btn--primary"
                      disabled={isSaving}
                      onClick={() => void handleSaveFollowUp()}
                    >
                      שמירת מעקב
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn--secondary"
                      disabled={isSaving || (!selected.followUpAt && !draftFollowUp)}
                      onClick={() => void handleClearFollowUp()}
                    >
                      ביטול מעקב
                    </button>
                  </div>
                  {selected.followUpAt ? (
                    <p
                      className={`platform-admin-registrations__follow-up platform-admin-registrations__follow-up--${getFollowUpUrgency(selected.followUpAt)}`}
                    >
                      נוכחי: {formatDateTime(selected.followUpAt)} (
                      {followUpUrgencyLabel(getFollowUpUrgency(selected.followUpAt)) ||
                        'מתוזמן'}
                      )
                    </p>
                  ) : (
                    <p className="platform-admin-registrations__hint">לא נקבע מעקב.</p>
                  )}
                </section>

                <section
                  className="platform-admin-registrations__panel"
                  aria-label="הערות פנימיות"
                >
                  <h4>הערות פנימיות</h4>
                  <label className="platform-admin-registrations__field">
                    <span className="visually-hidden">הערה חדשה</span>
                    <textarea
                      value={draftNote}
                      onChange={(event) => setDraftNote(event.target.value)}
                      rows={3}
                      maxLength={SCHOOL_REGISTRATION_NOTE_MAX_LENGTH}
                      placeholder="הוספת הערה פנימית…"
                      disabled={isSaving}
                    />
                  </label>
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary"
                    disabled={isSaving || !draftNote.trim()}
                    onClick={() => void handleAddNote()}
                  >
                    הוספת הערה
                  </button>
                  {notes.length === 0 ? (
                    <p className="platform-admin-registrations__hint">אין הערות עדיין.</p>
                  ) : (
                    <ul className="platform-admin-registrations__notes">
                      {notes.map((note) => (
                        <li key={note.id}>
                          <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
                          <p>{note.noteText}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section
                  className="platform-admin-registrations__panel"
                  aria-label="ציר פעילות"
                >
                  <h4>ציר פעילות</h4>
                  {activities.length === 0 ? (
                    <p className="platform-admin-registrations__hint">אין פעילות עדיין.</p>
                  ) : (
                    <ol className="platform-admin-registrations__timeline">
                      {activities.map((activity) => {
                        const detail = activityDetail(activity)
                        return (
                          <li key={activity.id}>
                            <time dateTime={activity.createdAt}>
                              {formatDateTime(activity.createdAt)}
                            </time>
                            <strong>{REGISTRATION_ACTIVITY_LABELS[activity.eventType]}</strong>
                            {detail ? <span>{detail}</span> : null}
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>

                {actionError ? (
                  <p className="ds-form-message ds-form-message--error" role="alert">
                    {actionError}
                  </p>
                ) : null}
                {actionMessage ? (
                  <p className="ds-form-message" role="status">
                    {actionMessage}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
