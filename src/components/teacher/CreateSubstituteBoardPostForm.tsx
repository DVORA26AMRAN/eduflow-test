import { useState } from 'react'
import type { SubstituteBoardPostType } from '../../types/substituteBoard'
import { SUBSTITUTE_BOARD_POST_TYPE_OPTIONS } from '../../utils/substituteBoard'

type CreateSubstituteBoardPostFormProps = {
  isSubmitting: boolean
  submitMessage: string
  onSubmit: (input: {
    postType: SubstituteBoardPostType
    date: string
    startTime: string
    endTime: string
    className: string
    subject: string
    description: string
  }) => void
}

export function CreateSubstituteBoardPostForm({
  isSubmitting,
  submitMessage,
  onSubmit,
}: CreateSubstituteBoardPostFormProps) {
  const [postType, setPostType] = useState<SubstituteBoardPostType | ''>('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [className, setClassName] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [validationMessage, setValidationMessage] = useState('')

  function handleSubmit() {
    if (!postType) {
      setValidationMessage('נא לבחור סוג פרסום.')
      return
    }

    if (!date) {
      setValidationMessage('נא לבחור תאריך.')
      return
    }

    setValidationMessage('')
    onSubmit({
      postType,
      date,
      startTime,
      endTime,
      className,
      subject,
      description,
    })
  }

  return (
    <>
      <h3 className="teacher-dashboard__subsection-title">פרסום חדש</h3>

      <label className="ds-field" htmlFor="substitute-post-type">
        <span className="ds-label">סוג פרסום</span>
        <select
          id="substitute-post-type"
          className="ds-select"
          value={postType}
          onChange={(event) => {
            setPostType(event.target.value as SubstituteBoardPostType | '')
            setValidationMessage('')
          }}
          disabled={isSubmitting}
        >
          <option value="">בחרי סוג פרסום</option>
          {SUBSTITUTE_BOARD_POST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ds-field" htmlFor="substitute-date">
        <span className="ds-label">תאריך</span>
        <input
          id="substitute-date"
          type="date"
          className="ds-input teacher-dashboard__date-input"
          value={date}
          onChange={(event) => {
            setDate(event.target.value)
            setValidationMessage('')
          }}
          disabled={isSubmitting}
        />
      </label>

      <div className="teacher-dashboard__substitute-time-row">
        <label className="ds-field" htmlFor="substitute-start-time">
          <span className="ds-label">שעת התחלה</span>
          <input
            id="substitute-start-time"
            type="time"
            className="ds-input"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            disabled={isSubmitting}
          />
        </label>

        <label className="ds-field" htmlFor="substitute-end-time">
          <span className="ds-label">שעת סיום</span>
          <input
            id="substitute-end-time"
            type="time"
            className="ds-input"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            disabled={isSubmitting}
          />
        </label>
      </div>

      <label className="ds-field" htmlFor="substitute-class-name">
        <span className="ds-label">כיתה</span>
        <input
          id="substitute-class-name"
          type="text"
          className="ds-input"
          value={className}
          onChange={(event) => setClassName(event.target.value)}
          disabled={isSubmitting}
        />
      </label>

      <label className="ds-field" htmlFor="substitute-subject">
        <span className="ds-label">מקצוע</span>
        <input
          id="substitute-subject"
          type="text"
          className="ds-input"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={isSubmitting}
        />
      </label>

      <label className="ds-field" htmlFor="substitute-description">
        <span className="ds-label">תיאור / הערות</span>
        <textarea
          id="substitute-description"
          className="ds-textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isSubmitting}
        />
      </label>

      <button
        type="button"
        className="ds-btn ds-btn--primary teacher-dashboard__submit"
        onClick={handleSubmit}
        disabled={isSubmitting}
      >
        פרסום
      </button>

      {validationMessage && (
        <p className="ds-form-message ds-form-message--error">{validationMessage}</p>
      )}

      {submitMessage && (
        <p
          className={
            submitMessage.includes('נכשל')
              ? 'ds-form-message ds-form-message--error'
              : 'ds-form-message ds-form-message--success'
          }
        >
          {submitMessage}
        </p>
      )}
    </>
  )
}
