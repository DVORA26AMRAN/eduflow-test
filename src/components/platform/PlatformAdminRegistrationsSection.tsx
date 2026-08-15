import { useCallback, useEffect, useState } from 'react'
import {
  APPLICANT_ROLE_LABELS,
  REGISTRATION_STATUS_LABELS,
  SCHOOL_REGISTRATION_PATH,
  type SchoolRegistrationRecord,
} from '../../types/schoolRegistration'
import {
  loadSchoolRegistrationForPlatformAdmin,
  loadSchoolRegistrationsForPlatformAdmin,
} from '../../services/schoolRegistration'
import { getSchoolRegistrationPublicUrl } from '../../utils/schoolRegistrationForm'
import './PlatformAdminRegistrationsSection.css'

function formatSubmittedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function PlatformAdminRegistrationsSection() {
  const [registrations, setRegistrations] = useState<SchoolRegistrationRecord[]>([])
  const [selected, setSelected] = useState<SchoolRegistrationRecord | null>(null)
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)

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

  async function openDetails(id: string) {
    setDetailError('')
    const result = await loadSchoolRegistrationForPlatformAdmin(id)
    if (!result.ok) {
      setDetailError(result.errorMessage)
      setSelected(null)
      return
    }
    setSelected(result.registration)
  }

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email)
    } catch {
      // ignore
    }
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
                  <th scope="col">עיר</th>
                  <th scope="col">איש קשר</th>
                  <th scope="col">תפקיד</th>
                  <th scope="col">טלפון</th>
                  <th scope="col">אימייל</th>
                  <th scope="col">סטטוס</th>
                  <th scope="col">נשלח ב־</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((row) => (
                  <tr key={row.id}>
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
                    <td>{row.city}</td>
                    <td>{row.contactFullName}</td>
                    <td>{APPLICANT_ROLE_LABELS[row.applicantRole]}</td>
                    <td>
                      <a href={`tel:${row.phone}`}>{row.phone}</a>
                    </td>
                    <td>
                      <a href={`mailto:${row.email}`}>{row.email}</a>
                    </td>
                    <td>{REGISTRATION_STATUS_LABELS[row.status]}</td>
                    <td>{formatSubmittedAt(row.createdAt)}</td>
                  </tr>
                ))}
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
          onClick={() => setSelected(null)}
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
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={() => setSelected(null)}
              >
                סגירה
              </button>
            </header>
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
                  <a href={`mailto:${selected.email}`}>{selected.email}</a>{' '}
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary"
                    onClick={() => void copyEmail(selected.email)}
                  >
                    העתקת אימייל
                  </button>
                </dd>
              </div>
              <div>
                <dt>טלפון</dt>
                <dd>
                  <a href={`tel:${selected.phone}`}>{selected.phone}</a>
                </dd>
              </div>
              <div>
                <dt>סטטוס</dt>
                <dd>{REGISTRATION_STATUS_LABELS[selected.status]}</dd>
              </div>
              <div>
                <dt>נשלח ב־</dt>
                <dd>{formatSubmittedAt(selected.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  )
}
