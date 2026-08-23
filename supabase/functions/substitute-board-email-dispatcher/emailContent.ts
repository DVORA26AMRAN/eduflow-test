/**
 * Pure email content helpers for Substitute Board N1 notifications.
 * Kept free of Deno/npm URL imports so Vitest can assert contracts.
 */

export const SUBSTITUTE_BOARD_EMAIL_CTA_LABEL = 'צפייה בבקשה ומענה'
export const SUBSTITUTE_BOARD_EMAIL_EVENT_TYPE = 'substitute_board_post_published'
export const SUBSTITUTE_BOARD_EMAIL_PROVIDER_IDEMPOTENCY_PREFIX = 'mpex/substitute-board/v1'
/** Bounded Resend batch per worker invocation. */
export const SUBSTITUTE_BOARD_EMAIL_DELIVERY_BATCH_SIZE = 25
export const SUBSTITUTE_BOARD_EMAIL_JOB_CLAIM_LIMIT = 5
export const SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS = 5
/** N1A worker lease duration (seconds). Must match SQL INTERVAL '5 minutes'. */
export const SUBSTITUTE_BOARD_EMAIL_LEASE_SECONDS = 300
/** Authoritative publication clock for email subject uniqueness (not browser local). */
export const SUBSTITUTE_BOARD_EMAIL_SUBJECT_TIMEZONE = 'Asia/Jerusalem'

export type SubstituteBoardEmailPostType =
  | 'looking_for_substitute'
  | 'available_for_substitute'

export type SubstituteBoardEmailSummaryInput = {
  postType: SubstituteBoardEmailPostType
  date: string
  startTime: string | null
  endTime: string | null
  className: string | null
  subject: string | null
  publisherFullName: string | null
  ctaUrl: string
}

export type SubstituteBoardEmailSubjectInput = Pick<
  SubstituteBoardEmailSummaryInput,
  'postType' | 'date' | 'startTime' | 'endTime' | 'className' | 'subject'
> & {
  /** Authoritative substitute_board_posts.created_at (ISO timestamptz). */
  createdAt: string
}

const POST_TYPE_LABELS: Record<SubstituteBoardEmailPostType, string> = {
  looking_for_substitute: 'מחפשת מילוי מקום',
  available_for_substitute: 'פנויה למילוי מקום',
}

const SUBJECT_PREFIX: Record<SubstituteBoardEmailPostType, string> = {
  looking_for_substitute: 'מילוי מקום חדש',
  available_for_substitute: 'פנויה למילוי מקום',
}

export function translateSubstituteBoardEmailPostType(
  postType: SubstituteBoardEmailPostType,
): string {
  return POST_TYPE_LABELS[postType]
}

export function buildSubstituteBoardEmailIdempotencyKey(
  postId: string,
  recipientUserId: string,
): string {
  return `${SUBSTITUTE_BOARD_EMAIL_PROVIDER_IDEMPOTENCY_PREFIX}/${postId}/${recipientUserId}`
}

/** N1 CTA: board section only — exact post deep-link is N2. */
export function buildSubstituteBoardEmailCtaUrl(appUrl: string): string {
  const trimmed = appUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('missing_app_url')
  }
  return `${trimmed}/?section=substituteBoard`
}

function formatTimeRange(startTime: string | null, endTime: string | null): string | null {
  const start = startTime?.trim() || ''
  const end = endTime?.trim() || ''
  if (!start && !end) return null
  if (start && end) return `${start.slice(0, 5)}–${end.slice(0, 5)}`
  return (start || end).slice(0, 5)
}

/** Authoritative post date → concise DD.MM segment for email subject. */
export function formatSubstituteBoardEmailSubjectDate(date: string): string {
  const trimmed = date.trim()
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}`
  }
  return trimmed
}

/**
 * Format substitute_board_posts.created_at as HH:MM:SS in Asia/Jerusalem.
 * Deterministic from authoritative DB timestamp — never browser/local clock.
 */
export function formatSubstituteBoardEmailPublishedAt(createdAt: string): string {
  const trimmed = createdAt.trim()
  if (!trimmed) {
    throw new Error('missing_created_at')
  }
  const instant = new Date(trimmed)
  if (Number.isNaN(instant.getTime())) {
    throw new Error('invalid_created_at')
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SUBSTITUTE_BOARD_EMAIL_SUBJECT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  const second = parts.find((part) => part.type === 'second')?.value
  if (!hour || !minute || !second) {
    throw new Error('published_at_format_failed')
  }

  // en-GB can emit "24" for midnight in some engines — normalize to 00.
  const normalizedHour = hour === '24' ? '00' : hour
  return `${normalizedHour}:${minute}:${second}`
}

/**
 * Human-readable subject per publication so clients do not thread unrelated posts.
 * Must NOT include description, UUIDs, or random noise.
 * Uniqueness: authoritative created_at (Asia/Jerusalem HH:MM:SS) as final segment.
 */
export function buildSubstituteBoardEmailSubject(
  input: SubstituteBoardEmailSubjectInput,
): string {
  const prefix = SUBJECT_PREFIX[input.postType]
  const datePart = formatSubstituteBoardEmailSubjectDate(input.date)
  const className = input.className?.trim() || ''
  const timeRange = formatTimeRange(input.startTime, input.endTime)
  const subjectField = input.subject?.trim() || ''
  const publishedAt = formatSubstituteBoardEmailPublishedAt(input.createdAt)

  const parts: string[] = [prefix, datePart]

  if (className && timeRange) {
    parts.push(`כיתה ${className}`, timeRange)
  } else if (className) {
    parts.push(`כיתה ${className}`)
  } else if (timeRange) {
    parts.push(timeRange)
  } else if (subjectField) {
    parts.push(subjectField)
  } else {
    parts.push('לוח מילויי מקום')
  }

  parts.push(`פורסם ${publishedAt}`)
  return parts.join(' | ')
}

/**
 * Plain-text body. Must NOT include description, UUIDs, or recipient lists.
 */
export function buildSubstituteBoardEmailTextBody(input: SubstituteBoardEmailSummaryInput): string {
  const lines: string[] = [
    'שלום,',
    '',
    'פורסמה בקשה חדשה בלוח מילויי מקום ב־EduFlow.',
    '',
    `סוג: ${translateSubstituteBoardEmailPostType(input.postType)}`,
    `תאריך: ${input.date}`,
  ]

  const timeRange = formatTimeRange(input.startTime, input.endTime)
  if (timeRange) {
    lines.push(`שעה: ${timeRange}`)
  }

  const className = input.className?.trim()
  if (className) {
    lines.push(`כיתה: ${className}`)
  }

  const subject = input.subject?.trim()
  if (subject) {
    lines.push(`מקצוע: ${subject}`)
  }

  const publisher = input.publisherFullName?.trim()
  if (publisher) {
    lines.push(`פורסם על ידי: ${publisher}`)
  }

  lines.push(
    '',
    `${SUBSTITUTE_BOARD_EMAIL_CTA_LABEL}:`,
    input.ctaUrl,
    '',
    'המענה מתבצע רק בתוך מערכת EduFlow.',
    '',
    '— EduFlow',
  )

  return lines.join('\n')
}
