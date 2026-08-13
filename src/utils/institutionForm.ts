import type { InstitutionFormFields } from '../types/institutionAdmin'

export type InstitutionFormValidationResult =
  | { ok: true; values: InstitutionFormFields }
  | { ok: false; errorMessage: string }

function trimRequired(value: string, label: string): { ok: true; value: string } | { ok: false; errorMessage: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, errorMessage: `${label} הוא שדה חובה.` }
  }
  return { ok: true, value: trimmed }
}

export function isValidInstitutionEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** Accepts common Israeli local/international formatting without rejecting spaces/dashes. */
export function isValidInstitutionPhone(phone: string): boolean {
  return /^\+?[0-9][0-9\s\-()]{5,24}$/.test(phone.trim())
}

export function validateInstitutionForm(fields: InstitutionFormFields): InstitutionFormValidationResult {
  const name = trimRequired(fields.name, 'שם בית הספר')
  if (!name.ok) {
    return name
  }

  const institutionCode = trimRequired(fields.institutionCode, 'סמל מוסד')
  if (!institutionCode.ok) {
    return institutionCode
  }

  const address = trimRequired(fields.address, 'כתובת מלאה')
  if (!address.ok) {
    return address
  }

  const city = trimRequired(fields.city, 'עיר')
  if (!city.ok) {
    return city
  }

  const phone = trimRequired(fields.phone, 'טלפון')
  if (!phone.ok) {
    return phone
  }
  if (!isValidInstitutionPhone(phone.value)) {
    return { ok: false, errorMessage: 'מספר הטלפון אינו תקין.' }
  }

  const email = trimRequired(fields.email, 'אימייל')
  if (!email.ok) {
    return email
  }
  if (!isValidInstitutionEmail(email.value)) {
    return { ok: false, errorMessage: 'כתובת האימייל אינה תקינה.' }
  }

  return {
    ok: true,
    values: {
      name: name.value,
      institutionCode: institutionCode.value,
      address: address.value,
      city: city.value,
      phone: phone.value,
      email: email.value.trim().toLowerCase(),
    },
  }
}
