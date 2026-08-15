import type {
  SchoolRegistrationApplicantRole,
  SchoolRegistrationFormFields,
} from '../types/schoolRegistration'
import { SCHOOL_REGISTRATION_PATH } from '../types/schoolRegistration'

export type SchoolRegistrationValidationResult =
  | {
      ok: true
      values: {
        school_name: string
        institution_symbol: string
        city: string
        applicant_role: SchoolRegistrationApplicantRole
        contact_full_name: string
        email: string
        phone: string
      }
    }
  | { ok: false; errorMessage: string }

function trimRequired(
  value: string,
  label: string,
): { ok: true; value: string } | { ok: false; errorMessage: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, errorMessage: `${label} הוא שדה חובה.` }
  }
  return { ok: true, value: trimmed }
}

export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidRegistrationEmail(email: string): boolean {
  const normalized = normalizeRegistrationEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254
}

export function isValidRegistrationPhone(phone: string): boolean {
  return /^\+?[0-9][0-9\s\-()]{5,24}$/.test(phone.trim())
}

export function isApplicantRole(
  value: string,
): value is SchoolRegistrationApplicantRole {
  return value === 'principal' || value === 'vice_principal'
}

/** Institution symbol is always treated as text (never Number()). */
export function normalizeInstitutionSymbol(value: string): string {
  return String(value).trim()
}

export function validateSchoolRegistrationForm(
  fields: SchoolRegistrationFormFields,
): SchoolRegistrationValidationResult {
  const schoolName = trimRequired(fields.schoolName, 'שם בית הספר')
  if (!schoolName.ok) return schoolName

  const institutionSymbolRaw = trimRequired(fields.institutionSymbol, 'סמל מוסד')
  if (!institutionSymbolRaw.ok) return institutionSymbolRaw
  const institution_symbol = normalizeInstitutionSymbol(institutionSymbolRaw.value)
  if (!institution_symbol) {
    return { ok: false, errorMessage: 'סמל מוסד הוא שדה חובה.' }
  }

  const city = trimRequired(fields.city, 'עיר')
  if (!city.ok) return city

  if (!isApplicantRole(fields.applicantRole)) {
    return { ok: false, errorMessage: 'יש לבחור תפקיד.' }
  }

  const contactFullName = trimRequired(fields.contactFullName, 'שם מלא')
  if (!contactFullName.ok) return contactFullName

  const emailRaw = trimRequired(fields.email, 'אימייל')
  if (!emailRaw.ok) return emailRaw
  if (!isValidRegistrationEmail(emailRaw.value)) {
    return { ok: false, errorMessage: 'כתובת האימייל אינה תקינה.' }
  }

  const phone = trimRequired(fields.phone, 'טלפון')
  if (!phone.ok) return phone
  if (!isValidRegistrationPhone(phone.value)) {
    return { ok: false, errorMessage: 'מספר הטלפון אינו תקין.' }
  }

  return {
    ok: true,
    values: {
      school_name: schoolName.value,
      institution_symbol,
      city: city.value,
      applicant_role: fields.applicantRole,
      contact_full_name: contactFullName.value,
      email: normalizeRegistrationEmail(emailRaw.value),
      phone: phone.value.trim(),
    },
  }
}

export function getSchoolRegistrationPublicUrl(
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}${SCHOOL_REGISTRATION_PATH}`
}

export function isSchoolRegistrationPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === SCHOOL_REGISTRATION_PATH
}
