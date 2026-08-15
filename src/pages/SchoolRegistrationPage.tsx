import { useState, type FormEvent } from 'react'
import organizationLogo from '../assets/images/logo.png.png'
import {
  APPLICANT_ROLE_LABELS,
  SCHOOL_REGISTRATION_SUCCESS_MESSAGE,
  type SchoolRegistrationFormFields,
} from '../types/schoolRegistration'
import { submitSchoolRegistration } from '../services/schoolRegistration'
import { validateSchoolRegistrationForm } from '../utils/schoolRegistrationForm'
import './SchoolRegistrationPage.css'

const EMPTY_FORM: SchoolRegistrationFormFields = {
  schoolName: '',
  institutionSymbol: '',
  city: '',
  applicantRole: '',
  contactFullName: '',
  email: '',
  phone: '',
}

export function SchoolRegistrationPage() {
  const [fields, setFields] = useState<SchoolRegistrationFormFields>(EMPTY_FORM)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField<K extends keyof SchoolRegistrationFormFields>(
    key: K,
    value: SchoolRegistrationFormFields[K],
  ) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setIsError(false)

    const validation = validateSchoolRegistrationForm(fields)
    if (!validation.ok) {
      setIsError(true)
      setMessage(validation.errorMessage)
      return
    }

    setIsSubmitting(true)
    const result = await submitSchoolRegistration(fields)
    setIsSubmitting(false)

    if (!result.ok) {
      setIsError(true)
      setMessage(result.errorMessage)
      return
    }

    setSubmitted(true)
    setIsError(false)
    setMessage(SCHOOL_REGISTRATION_SUCCESS_MESSAGE)
  }

  return (
    <main dir="rtl" className="school-registration-page">
      <section
        className="school-registration-page__shell"
        aria-label="טופס הרשמת בית ספר"
      >
        <div className="ds-card ds-card--flat school-registration-page__card">
          <header className="school-registration-page__header">
            <h1 className="school-registration-page__brand">
              <img
                className="school-registration-page__brand-logo"
                src={organizationLogo}
                alt="MPEX"
              />
            </h1>
            <p className="ds-card__subtitle school-registration-page__intro">
              הרשמת בית ספר למערכת MPEX. לאחר שליחת הטופס ניצור איתכם קשר — הטופס אינו
              מעניק גישה למערכת.
            </p>
          </header>

          {submitted ? (
            <p
              className="ds-form-message ds-form-message--success school-registration-page__message"
              role="status"
            >
              {SCHOOL_REGISTRATION_SUCCESS_MESSAGE}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="school-registration-page__form" noValidate>
              <label className="ds-field" htmlFor="reg-school-name">
                <span className="ds-label">שם בית הספר</span>
                <input
                  id="reg-school-name"
                  className="ds-input"
                  name="school_name"
                  autoComplete="organization"
                  value={fields.schoolName}
                  onChange={(e) => updateField('schoolName', e.target.value)}
                  required
                />
              </label>

              <label className="ds-field" htmlFor="reg-institution-symbol">
                <span className="ds-label">סמל מוסד</span>
                <input
                  id="reg-institution-symbol"
                  className="ds-input"
                  name="institution_symbol"
                  inputMode="text"
                  autoComplete="off"
                  value={fields.institutionSymbol}
                  onChange={(e) => updateField('institutionSymbol', e.target.value)}
                  required
                />
              </label>

              <label className="ds-field" htmlFor="reg-city">
                <span className="ds-label">עיר</span>
                <input
                  id="reg-city"
                  className="ds-input"
                  name="city"
                  autoComplete="address-level2"
                  value={fields.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  required
                />
              </label>

              <label className="ds-field" htmlFor="reg-applicant-role">
                <span className="ds-label">תפקיד הפונה</span>
                <select
                  id="reg-applicant-role"
                  className="ds-input"
                  name="applicant_role"
                  value={fields.applicantRole}
                  onChange={(e) =>
                    updateField(
                      'applicantRole',
                      e.target.value as SchoolRegistrationFormFields['applicantRole'],
                    )
                  }
                  required
                >
                  <option value="">בחרו תפקיד</option>
                  <option value="principal">{APPLICANT_ROLE_LABELS.principal}</option>
                  <option value="vice_principal">
                    {APPLICANT_ROLE_LABELS.vice_principal}
                  </option>
                </select>
              </label>

              <label className="ds-field" htmlFor="reg-full-name">
                <span className="ds-label">שם מלא</span>
                <input
                  id="reg-full-name"
                  className="ds-input"
                  name="contact_full_name"
                  autoComplete="name"
                  value={fields.contactFullName}
                  onChange={(e) => updateField('contactFullName', e.target.value)}
                  required
                />
              </label>

              <label className="ds-field" htmlFor="reg-email">
                <span className="ds-label">אימייל</span>
                <input
                  id="reg-email"
                  className="ds-input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={fields.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  required
                />
              </label>

              <label className="ds-field" htmlFor="reg-phone">
                <span className="ds-label">טלפון</span>
                <input
                  id="reg-phone"
                  className="ds-input"
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  value={fields.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  required
                />
              </label>

              {message ? (
                <p
                  className={
                    isError
                      ? 'ds-form-message ds-form-message--error school-registration-page__message'
                      : 'ds-form-message school-registration-page__message'
                  }
                  role={isError ? 'alert' : 'status'}
                >
                  {message}
                </p>
              ) : null}

              <button
                type="submit"
                className="ds-btn ds-btn--primary school-registration-page__submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'שולח...' : 'שליחת הרשמה'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
