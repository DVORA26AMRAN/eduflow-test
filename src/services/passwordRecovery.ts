import { supabase } from './supabase'

/** Production MPEX origin — only allow-listed recovery redirect for live hosts. */
export const MPEX_PRODUCTION_ORIGIN = 'https://mpex.school'

/**
 * Generic confirmation after a syntactically valid recovery request.
 * Must not reveal whether the email exists in Auth.
 */
export const PASSWORD_RECOVERY_CONFIRMATION_MESSAGE =
  'אם קיימת כתובת אימייל זו במערכת, נשלח אליה קישור להגדרת סיסמה חדשה.'

export const PASSWORD_RECOVERY_INVALID_EMAIL_MESSAGE =
  'נא להזין כתובת אימייל תקינה.'

export type PasswordRecoveryLocation = {
  origin: string
  hostname: string
}

/**
 * Fixed application-controlled redirect for password recovery emails.
 * Never reads query parameters or caller-supplied external URLs.
 */
export function resolvePasswordRecoveryRedirectTo(
  locationLike: PasswordRecoveryLocation =
    typeof window !== 'undefined'
      ? { origin: window.location.origin, hostname: window.location.hostname }
      : { origin: MPEX_PRODUCTION_ORIGIN, hostname: 'mpex.school' },
): string {
  const hostname = locationLike.hostname.toLowerCase()
  if (hostname === 'mpex.school' || hostname === 'www.mpex.school') {
    return MPEX_PRODUCTION_ORIGIN
  }
  return locationLike.origin
}

export function normalizePasswordRecoveryEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidPasswordRecoveryEmail(email: string): boolean {
  const normalized = normalizePasswordRecoveryEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254
}

export type RequestPasswordRecoveryResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/**
 * Requests a Supabase Auth password-recovery email.
 * Syntactically valid emails always return the generic confirmation (anti-enumeration).
 */
export async function requestPasswordRecoveryEmail(
  email: string,
  options?: {
    locationLike?: PasswordRecoveryLocation
  },
): Promise<RequestPasswordRecoveryResult> {
  if (!isValidPasswordRecoveryEmail(email)) {
    return { ok: false, message: PASSWORD_RECOVERY_INVALID_EMAIL_MESSAGE }
  }

  const normalized = normalizePasswordRecoveryEmail(email)
  const redirectTo = resolvePasswordRecoveryRedirectTo(options?.locationLike)

  const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
    redirectTo,
  })

  if (error && import.meta.env.DEV) {
    console.error('[auth] resetPasswordForEmail failed', {
      message: error.message,
      status: error.status,
      code: error.code,
      name: error.name,
      redirectTo,
    })
  }

  // Always the same confirmation for valid syntax — do not surface Auth errors.
  return { ok: true, message: PASSWORD_RECOVERY_CONFIRMATION_MESSAGE }
}
