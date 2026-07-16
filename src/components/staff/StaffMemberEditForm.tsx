import { useState, type FormEvent } from 'react'
import type { StaffMemberDetails, UpdateStaffMemberInput } from '../../types/staffDirectory'
import { formatStaffJoinDate } from '../../utils/staffDirectoryDisplay'
import { validateStaffMemberEdit } from '../../utils/staffMemberEdit'

type StaffMemberEditFormProps = {
  member: StaffMemberDetails
  institutionName: string
  isSaving: boolean
  onCancel: () => void
  onSave: (input: UpdateStaffMemberInput) => Promise<void>
}

export function StaffMemberEditForm({
  member,
  institutionName,
  isSaving,
  onCancel,
  onSave,
}: StaffMemberEditFormProps) {
  const [fullName, setFullName] = useState(member.fullName)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? '')
  const [weeklyHours, setWeeklyHours] = useState(
    member.weeklyHours === null ? '' : String(member.weeklyHours),
  )
  const [nationalId, setNationalId] = useState(member.nationalId ?? '')
  const [validationMessage, setValidationMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationMessage('')

    const validation = validateStaffMemberEdit({
      fullName,
      phone,
      jobTitle,
      weeklyHours,
      nationalId,
    })

    if (!validation.ok) {
      setValidationMessage(validation.errorMessage)
      return
    }

    await onSave({
      userId: member.id,
      ...validation.values,
    })
  }

  return (
    <form className="staff-directory__edit-form" onSubmit={handleSubmit}>
      <label className="ds-field" htmlFor="staff-edit-full-name">
        <span className="ds-label">שם מלא</span>
        <input
          id="staff-edit-full-name"
          className="ds-input"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
        />
      </label>

      <label className="ds-field" htmlFor="staff-edit-phone">
        <span className="ds-label">טלפון</span>
        <input
          id="staff-edit-phone"
          className="ds-input"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>

      <label className="ds-field" htmlFor="staff-edit-job-title">
        <span className="ds-label">תפקיד</span>
        <input
          id="staff-edit-job-title"
          className="ds-input"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
        />
      </label>

      <label className="ds-field" htmlFor="staff-edit-weekly-hours">
        <span className="ds-label">היקף משרה בשעות</span>
        <input
          id="staff-edit-weekly-hours"
          className="ds-input"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={weeklyHours}
          onChange={(event) => setWeeklyHours(event.target.value)}
        />
      </label>

      <label className="ds-field" htmlFor="staff-edit-national-id">
        <span className="ds-label">תעודת זהות</span>
        <input
          id="staff-edit-national-id"
          className="ds-input"
          value={nationalId}
          onChange={(event) => setNationalId(event.target.value)}
        />
      </label>

      <dl className="staff-directory__readonly-list">
        <div className="staff-directory__details-row">
          <dt>מייל</dt>
          <dd>{member.email}</dd>
        </div>
        <div className="staff-directory__details-row">
          <dt>מוסד</dt>
          <dd>{institutionName || '—'}</dd>
        </div>
        <div className="staff-directory__details-row">
          <dt>תאריך הצטרפות</dt>
          <dd>{formatStaffJoinDate(member.createdAt)}</dd>
        </div>
        <div className="staff-directory__details-row">
          <dt>תפקיד במערכת</dt>
          <dd>מורה</dd>
        </div>
      </dl>

      {validationMessage ? (
        <p className="ds-form-message ds-form-message--error">{validationMessage}</p>
      ) : null}

      <div className="ds-form-actions">
        <button type="submit" className="ds-btn ds-btn--primary" disabled={isSaving}>
          {isSaving ? 'שומר...' : 'שמירת שינויים'}
        </button>
        <button type="button" className="ds-btn ds-btn--secondary" onClick={onCancel} disabled={isSaving}>
          ביטול
        </button>
      </div>
    </form>
  )
}
