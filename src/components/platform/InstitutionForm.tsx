import type { FormEvent } from 'react'
import type { InstitutionFormFields } from '../../types/institutionAdmin'

type InstitutionFormProps = {
  title: string
  values: InstitutionFormFields
  submitLabel: string
  isSubmitting: boolean
  message: string
  messageIsError: boolean
  onChange: (field: keyof InstitutionFormFields, value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  cancelLabel?: string
}

export function InstitutionForm({
  title,
  values,
  submitLabel,
  isSubmitting,
  message,
  messageIsError,
  onChange,
  onSubmit,
  onCancel,
  cancelLabel = 'ביטול',
}: InstitutionFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form className="platform-admin-institution-form" onSubmit={handleSubmit} noValidate>
      <h3 className="platform-admin-institution-form__title">{title}</h3>

      <div className="ds-fieldset">
        <label className="ds-field" htmlFor="institution-name">
          <span className="ds-label">שם בית הספר</span>
          <input
            id="institution-name"
            className="ds-input"
            value={values.name}
            onChange={(event) => onChange('name', event.target.value)}
            required
            autoComplete="organization"
          />
        </label>

        <label className="ds-field" htmlFor="institution-code">
          <span className="ds-label">סמל מוסד</span>
          <input
            id="institution-code"
            className="ds-input"
            value={values.institutionCode}
            onChange={(event) => onChange('institutionCode', event.target.value)}
            required
          />
        </label>

        <label className="ds-field" htmlFor="institution-address">
          <span className="ds-label">כתובת מלאה</span>
          <input
            id="institution-address"
            className="ds-input"
            value={values.address}
            onChange={(event) => onChange('address', event.target.value)}
            required
            autoComplete="street-address"
          />
        </label>

        <label className="ds-field" htmlFor="institution-city">
          <span className="ds-label">עיר</span>
          <input
            id="institution-city"
            className="ds-input"
            value={values.city}
            onChange={(event) => onChange('city', event.target.value)}
            required
            autoComplete="address-level2"
          />
        </label>

        <label className="ds-field" htmlFor="institution-phone">
          <span className="ds-label">טלפון</span>
          <input
            id="institution-phone"
            className="ds-input"
            type="tel"
            value={values.phone}
            onChange={(event) => onChange('phone', event.target.value)}
            required
            autoComplete="tel"
          />
        </label>

        <label className="ds-field" htmlFor="institution-email">
          <span className="ds-label">אימייל</span>
          <input
            id="institution-email"
            className="ds-input"
            type="email"
            value={values.email}
            onChange={(event) => onChange('email', event.target.value)}
            required
            autoComplete="email"
          />
        </label>
      </div>

      <div className="ds-form-actions platform-admin-institution-form__actions">
        <button type="submit" className="ds-btn ds-btn--primary" disabled={isSubmitting}>
          {isSubmitting ? 'שומר...' : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          className={
            messageIsError
              ? 'ds-form-message ds-form-message--error'
              : 'ds-form-message ds-form-message--success'
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  )
}
