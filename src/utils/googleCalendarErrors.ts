/**
 * Google Calendar API failure classification (Vitest + UI).
 * Edge mirror: supabase/functions/_shared/googleCalendarErrors.ts — keep in sync.
 */

export const CALENDAR_FAILURE_CODES = [
  'CALENDAR_AUTH_REQUIRED',
  'CALENDAR_INSUFFICIENT_SCOPE',
  'CALENDAR_API_DISABLED',
  'CALENDAR_PERMISSION_DENIED',
  'CALENDAR_RATE_LIMIT',
  'CALENDAR_INVALID_REQUEST',
  'CALENDAR_OTHER',
] as const

export type CalendarFailureCode = (typeof CALENDAR_FAILURE_CODES)[number]

export type SanitizedGoogleCalendarError = {
  httpStatus: number
  reason: string | null
  message: string | null
  operation: string
  classification: CalendarFailureCode
  invalidateOAuth: boolean
}

/** Strip tokens/URLs/secrets from Google error text before log/persist. */
export function sanitizeGoogleErrorText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (!text) return null
  text = text
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/(ya29\.|1\/\/|GOCSPX-|AIza)[A-Za-z0-9_.-]+/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
  if (text.length > 240) {
    text = `${text.slice(0, 240)}…`
  }
  return text
}

function extractGoogleReason(body: Record<string, unknown> | null | undefined): string | null {
  if (!body) return null
  const error = body.error
  if (typeof error === 'string') {
    return sanitizeGoogleErrorText(error)
  }
  if (!error || typeof error !== 'object') return null
  const errObj = error as Record<string, unknown>
  const errors = errObj.errors
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (entry && typeof entry === 'object') {
        const reason = (entry as Record<string, unknown>).reason
        if (typeof reason === 'string' && reason.trim()) {
          return sanitizeGoogleErrorText(reason)
        }
      }
    }
  }
  if (typeof errObj.status === 'string' && errObj.status.trim()) {
    return sanitizeGoogleErrorText(errObj.status)
  }
  return null
}

function extractGoogleMessage(body: Record<string, unknown> | null | undefined): string | null {
  if (!body) return null
  const error = body.error
  if (!error || typeof error !== 'object') return null
  const message = (error as Record<string, unknown>).message
  return sanitizeGoogleErrorText(message)
}

function normalizeReason(reason: string | null): string {
  return (reason ?? '').trim().toLowerCase()
}

/**
 * Classify Calendar HTTP failures. Only auth-required / insufficient-scope
 * prove the OAuth grant is unusable and may invalidate the stored refresh token.
 */
export function classifyGoogleCalendarHttpFailure(args: {
  httpStatus: number
  responseBody?: Record<string, unknown> | null
  operation: string
}): SanitizedGoogleCalendarError {
  const reason = extractGoogleReason(args.responseBody)
  const message = extractGoogleMessage(args.responseBody)
  const r = normalizeReason(reason)
  const msg = normalizeReason(message)

  let classification: CalendarFailureCode = 'CALENDAR_OTHER'

  if (args.httpStatus === 401) {
    classification = 'CALENDAR_AUTH_REQUIRED'
  } else if (args.httpStatus === 429) {
    classification = 'CALENDAR_RATE_LIMIT'
  } else if (args.httpStatus === 403) {
    if (
      r === 'accessnotconfigured' ||
      r === 'notconfigured' ||
      r === 'service_disabled' ||
      msg.includes('has not been used') ||
      msg.includes('is disabled') ||
      msg.includes('api is not enabled')
    ) {
      classification = 'CALENDAR_API_DISABLED'
    } else if (
      r === 'insufficientpermissions' ||
      r === 'access_token_scope_insufficient' ||
      r === 'insufficientauthenticationscopes' ||
      msg.includes('insufficient authentication scopes') ||
      msg.includes('insufficient permission')
    ) {
      classification = 'CALENDAR_INSUFFICIENT_SCOPE'
    } else if (
      r === 'ratelimitexceeded' ||
      r === 'userratelimitexceeded' ||
      r === 'quotaexceeded' ||
      r === 'dailylimitexceeded' ||
      r === 'sharingratelimitexceeded' ||
      msg.includes('rate limit') ||
      msg.includes('quota')
    ) {
      classification = 'CALENDAR_RATE_LIMIT'
    } else if (
      r === 'forbidden' ||
      r === 'requiredaccesslevel' ||
      r === 'notanull' ||
      msg.includes('permission') ||
      msg.includes('forbidden')
    ) {
      classification = 'CALENDAR_PERMISSION_DENIED'
    } else {
      classification = 'CALENDAR_OTHER'
    }
  } else if (args.httpStatus === 400 || args.httpStatus === 404 || args.httpStatus === 409 || args.httpStatus === 412) {
    classification = 'CALENDAR_INVALID_REQUEST'
  } else if (args.httpStatus >= 500) {
    classification = 'CALENDAR_OTHER'
  }

  return {
    httpStatus: args.httpStatus,
    reason,
    message,
    operation: args.operation,
    classification,
    invalidateOAuth: shouldInvalidateOAuthForCalendarFailure(classification),
  }
}

/** Only these Calendar outcomes prove the stored OAuth grant must be cleared. */
export function shouldInvalidateOAuthForCalendarFailure(
  classification: CalendarFailureCode | string,
): boolean {
  return (
    classification === 'CALENDAR_AUTH_REQUIRED' ||
    classification === 'CALENDAR_INSUFFICIENT_SCOPE'
  )
}

export function isCalendarFailureCode(code: string): code is CalendarFailureCode {
  return (CALENDAR_FAILURE_CODES as readonly string[]).includes(code)
}

/** Meeting-level errors that should prompt Google reconnect in the UI. */
export function isMeetProvisionReauthErrorCode(error: string | null): boolean {
  if (!error) return false
  return (
    error === 'REAUTHORIZATION_REQUIRED' ||
    error === 'GOOGLE_NOT_CONNECTED' ||
    error === 'CALENDAR_AUTH_REQUIRED' ||
    error === 'CALENDAR_INSUFFICIENT_SCOPE'
  )
}
