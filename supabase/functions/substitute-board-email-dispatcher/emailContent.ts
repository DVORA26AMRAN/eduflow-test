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
  /** Snapshotted delivery recipient name; omit greeting name when absent. */
  recipientFullName?: string | null
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

const INTRO_COPY: Record<SubstituteBoardEmailPostType, string> = {
  looking_for_substitute: 'פורסמה בקשה חדשה בלוח מילויי מקום.',
  available_for_substitute: 'פורסמה הודעת זמינות חדשה בלוח מילויי מקום.',
}

/** EduFlow primary-600. No public email-safe logo URL is committed. */
export const SUBSTITUTE_BOARD_EMAIL_BRAND_COLOR = '#7658d4'
export const SUBSTITUTE_BOARD_EMAIL_WORDMARK = 'mpex'

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

export function escapeSubstituteBoardEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function usableName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || ''
  return trimmed || null
}

export function buildSubstituteBoardEmailGreeting(recipientFullName?: string | null): string {
  const name = usableName(recipientFullName ?? null)
  return name ? `שלום ${name},` : 'שלום,'
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

type EmailDetailRow = { label: string; value: string }

function buildSubstituteBoardEmailDetailRows(
  input: SubstituteBoardEmailSummaryInput,
): EmailDetailRow[] {
  const rows: EmailDetailRow[] = [
    { label: 'סוג', value: translateSubstituteBoardEmailPostType(input.postType) },
    { label: 'תאריך', value: input.date },
  ]

  const timeRange = formatTimeRange(input.startTime, input.endTime)
  if (timeRange) {
    rows.push({ label: 'שעה', value: timeRange })
  }

  const className = input.className?.trim()
  if (className) {
    rows.push({ label: 'כיתה', value: className })
  }

  const subject = input.subject?.trim()
  if (subject) {
    rows.push({ label: 'מקצוע', value: subject })
  }

  const publisher = usableName(input.publisherFullName)
  if (publisher) {
    rows.push({ label: 'פורסם על ידי', value: publisher })
  }

  return rows
}

/**
 * Plain-text body. Must NOT include description, UUIDs, or recipient lists.
 */
export function buildSubstituteBoardEmailTextBody(input: SubstituteBoardEmailSummaryInput): string {
  const lines: string[] = [
    buildSubstituteBoardEmailGreeting(input.recipientFullName),
    '',
    INTRO_COPY[input.postType],
    '',
  ]

  for (const row of buildSubstituteBoardEmailDetailRows(input)) {
    lines.push(`${row.label}: ${row.value}`)
  }

  lines.push(
    '',
    `${SUBSTITUTE_BOARD_EMAIL_CTA_LABEL}:`,
    input.ctaUrl,
    '',
    `המענה מתבצע רק בתוך מערכת ${SUBSTITUTE_BOARD_EMAIL_WORDMARK}.`,
    '',
    `— ${SUBSTITUTE_BOARD_EMAIL_WORDMARK}`,
  )

  return lines.join('\n')
}

/**
 * Transactional HTML body. User-derived values are escaped.
 * CTA href comes only from trusted APP_URL via buildSubstituteBoardEmailCtaUrl.
 */
export function buildSubstituteBoardEmailHtmlBody(input: SubstituteBoardEmailSummaryInput): string {
  const heading = SUBJECT_PREFIX[input.postType]
  const greeting = buildSubstituteBoardEmailGreeting(input.recipientFullName)
  const intro = INTRO_COPY[input.postType]
  const rows = buildSubstituteBoardEmailDetailRows(input)
  const ctaHref = escapeSubstituteBoardEmailHtml(input.ctaUrl)
  const ctaLabel = escapeSubstituteBoardEmailHtml(SUBSTITUTE_BOARD_EMAIL_CTA_LABEL)
  const brand = SUBSTITUTE_BOARD_EMAIL_BRAND_COLOR
  const wordmark = escapeSubstituteBoardEmailHtml(SUBSTITUTE_BOARD_EMAIL_WORDMARK)

  const detailRowsHtml = rows
    .map(
      (row) => `
                          <tr>
                            <td style="padding:8px 0;font-size:13px;line-height:20px;color:#6b6375;width:38%;vertical-align:top;">
                              ${escapeSubstituteBoardEmailHtml(row.label)}
                            </td>
                            <td style="padding:8px 0;font-size:15px;line-height:22px;color:#1a1523;font-weight:600;vertical-align:top;">
                              ${escapeSubstituteBoardEmailHtml(row.value)}
                            </td>
                          </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeSubstituteBoardEmailHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#faf9fc;direction:rtl;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background-color:#faf9fc;margin:0;padding:0;width:100%;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #ebe3ff;border-radius:12px;">
            <tr>
              <td align="center" style="padding:32px 28px 12px 28px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:22px;line-height:28px;font-weight:700;color:${brand};letter-spacing:0.02em;">
                  ${wordmark}
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 28px 20px 28px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#1a1523;">
                  ${escapeSubstituteBoardEmailHtml(heading)}
                </p>
              </td>
            </tr>
            <tr>
              <td align="right" style="padding:0 28px 16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1a1523;">
                <p style="margin:0 0 10px 0;">${escapeSubstituteBoardEmailHtml(greeting)}</p>
                <p style="margin:0;color:#6b6375;">${escapeSubstituteBoardEmailHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;background-color:#faf9fc;border:1px solid #ebe3ff;border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;">
                        ${detailRowsHtml}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:4px 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${ctaHref}" style="display:inline-block;background-color:${brand};color:#ffffff;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;min-height:20px;">
                  ${ctaLabel}
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9a929e;">
                המענה מתבצע רק בתוך מערכת ${wordmark}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
