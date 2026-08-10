import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  classifyGoogleCalendarHttpFailure,
  sanitizeGoogleErrorText,
  shouldInvalidateOAuthForCalendarFailure,
} from './googleCalendarErrors'

describe('Google Calendar error classification', () => {
  it('maps Calendar 401 to CALENDAR_AUTH_REQUIRED and invalidates OAuth', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 401,
      responseBody: {
        error: {
          errors: [{ reason: 'authError' }],
          message: 'Invalid Credentials',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_AUTH_REQUIRED')
    expect(result.invalidateOAuth).toBe(true)
    expect(shouldInvalidateOAuthForCalendarFailure(result.classification)).toBe(true)
  })

  it('does not invalidate OAuth for generic Calendar 403', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 403,
      responseBody: {
        error: {
          errors: [{ reason: 'forbidden' }],
          message: 'Permission denied for calendar',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_PERMISSION_DENIED')
    expect(result.invalidateOAuth).toBe(false)
  })

  it('maps accessNotConfigured to CALENDAR_API_DISABLED without OAuth invalidation', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 403,
      responseBody: {
        error: {
          errors: [{ reason: 'accessNotConfigured' }],
          message: 'Google Calendar API has not been used in project before or it is disabled.',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_API_DISABLED')
    expect(result.invalidateOAuth).toBe(false)
  })

  it('maps insufficient-scope reasons to CALENDAR_INSUFFICIENT_SCOPE and invalidates OAuth', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 403,
      responseBody: {
        error: {
          errors: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
          message: 'Request had insufficient authentication scopes.',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_INSUFFICIENT_SCOPE')
    expect(result.invalidateOAuth).toBe(true)
  })

  it('maps quota/rate-limit reasons without reauthorization', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 403,
      responseBody: {
        error: {
          errors: [{ reason: 'rateLimitExceeded' }],
          message: 'Rate Limit Exceeded',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_RATE_LIMIT')
    expect(result.invalidateOAuth).toBe(false)
  })

  it('maps unknown 403 to CALENDAR_OTHER without OAuth invalidation', () => {
    const result = classifyGoogleCalendarHttpFailure({
      httpStatus: 403,
      responseBody: {
        error: {
          errors: [{ reason: 'somethingBrandNew' }],
          message: 'Unexpected policy block',
        },
      },
      operation: 'calendar.events.insert',
    })
    expect(result.classification).toBe('CALENDAR_OTHER')
    expect(result.invalidateOAuth).toBe(false)
  })

  it('sanitizes Google error text (tokens/URLs/bearer)', () => {
    const sanitized = sanitizeGoogleErrorText(
      'Failed Bearer ya29.a0AfH6SMC-secret https://meet.google.com/abc-defg-hij refresh_token=1//x',
    )
    expect(sanitized).not.toMatch(/ya29\./)
    expect(sanitized).not.toMatch(/meet\.google\.com/)
    expect(sanitized).toContain('[REDACTED]')
    expect(sanitized).toContain('[REDACTED_URL]')
  })
})

describe('Calendar classification Edge + provisioner contracts', () => {
  const edgeErrors = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/googleCalendarErrors.ts'),
    'utf8',
  )
  const edgeMeet = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/googleMeetProvision.ts'),
    'utf8',
  )
  const worker = readFileSync(
    resolve(process.cwd(), 'supabase/functions/meeting-meet-provisioner/index.ts'),
    'utf8',
  )
  const diagnostic = readFileSync(
    resolve(process.cwd(), 'supabase/functions/meeting-meet-calendar-diagnostic/index.ts'),
    'utf8',
  )

  it('removes blanket Calendar 401/403 → REAUTHORIZATION_REQUIRED mapping', () => {
    expect(edgeMeet).not.toMatch(
      /if \(res\.status === 401 \|\| res\.status === 403\)[\s\S]*REAUTHORIZATION_REQUIRED/,
    )
    expect(edgeMeet).toContain('classifyGoogleCalendarHttpFailure')
    expect(edgeMeet).toContain('invalidateOAuth')
  })

  it('only invalidates OAuth when calendar failure proves grant is unusable', () => {
    expect(worker).toContain('invalidateOAuth')
    expect(worker).toContain('mark_google_reauthorization_required')
    expect(worker).toMatch(/if \(invalidateOAuth\)/)
    expect(worker).toContain('Generic 403')
  })

  it('persists specific Calendar failure codes', () => {
    expect(worker).toContain('safeErrorCode(eventResult.code)')
    expect(edgeErrors).toContain('CALENDAR_API_DISABLED')
    expect(edgeErrors).toContain('CALENDAR_AUTH_REQUIRED')
  })

  it('diagnostic probe never mutates connection or meeting state', () => {
    expect(diagnostic).toContain('connection_mutated: false')
    expect(diagnostic).toContain('meeting_mutated: false')
    expect(diagnostic).toContain('calendar_mutated: false')
    expect(diagnostic).toContain('probeGoogleCalendarAccess')
    expect(diagnostic).not.toContain('mark_google_reauthorization_required')
    expect(diagnostic).not.toContain('fail_meet_provision')
    expect(diagnostic).not.toContain('complete_meet_provision')
    expect(diagnostic).not.toContain('events?conferenceDataVersion')
  })

  it('keeps successful Meet creation path (conferenceDataVersion=1)', () => {
    expect(edgeMeet).toContain('conferenceDataVersion=1')
    expect(edgeMeet).toContain('hangoutsMeet')
    expect(edgeMeet).toContain('createOrReuseMeetCalendarEvent')
  })
})
