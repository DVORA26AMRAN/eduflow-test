/**
 * Substitute Board email — standalone message / Gmail threading fix.
 * Subject is derived per publication; no thread headers; idempotency unchanged.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SUBSTITUTE_BOARD_EMAIL_SUBJECT_TIMEZONE,
  buildSubstituteBoardEmailIdempotencyKey,
  buildSubstituteBoardEmailSubject,
  buildSubstituteBoardEmailTextBody,
  formatSubstituteBoardEmailPublishedAt,
} from '../../supabase/functions/substitute-board-email-dispatcher/emailContent'

const DISPATCHER =
  'supabase/functions/substitute-board-email-dispatcher/index.ts'
const OUTBOX_MIGRATION =
  'supabase/migrations/20250820109000_substitute_board_email_outbox_n1.sql'
const CRON_MIGRATION =
  'supabase/migrations/20250820109100_substitute_board_email_dispatcher_cron_n1b.sql'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

/** UTC instants that map to Asia/Jerusalem summer (IDT, UTC+3). */
const PUBLISHED_A = '2026-08-23T13:18:42.000Z' // 16:18:42 Asia/Jerusalem
const PUBLISHED_B = '2026-08-23T13:22:07.000Z' // 16:22:07 Asia/Jerusalem

const baseInput = {
  date: '2026-08-23',
  startTime: null as string | null,
  endTime: null as string | null,
  className: null as string | null,
  subject: null as string | null,
  createdAt: PUBLISHED_A,
}

describe('Substitute Board email — standalone subject contract', () => {
  it('builds looking_for_substitute subject with date, class, time, and published_at', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'looking_for_substitute',
        className: 'ח1',
        startTime: '10:30:00',
        endTime: '11:15:00',
      }),
    ).toBe('מילוי מקום חדש | 23.08 | כיתה ח1 | 10:30–11:15 | פורסם 16:18:42')
  })

  it('builds looking_for_substitute subject with date and class only', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'looking_for_substitute',
        className: 'ד2',
      }),
    ).toBe('מילוי מקום חדש | 23.08 | כיתה ד2 | פורסם 16:18:42')
  })

  it('builds available_for_substitute subject with date and time only', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'available_for_substitute',
        startTime: '12:15:00',
        endTime: '13:00:00',
        createdAt: PUBLISHED_B,
      }),
    ).toBe('פנויה למילוי מקום | 23.08 | 12:15–13:00 | פורסם 16:22:07')
  })

  it('uses subject field when class and time are absent', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'looking_for_substitute',
        subject: 'מתמטיקה',
      }),
    ).toBe('מילוי מקום חדש | 23.08 | מתמטיקה | פורסם 16:18:42')
  })

  it('falls back to לוח מילויי מקום when optional fields are absent', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'looking_for_substitute',
      }),
    ).toBe('מילוי מקום חדש | 23.08 | לוח מילויי מקום | פורסם 16:18:42')
  })

  it('prefers class over subject when class is present without time', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        ...baseInput,
        postType: 'looking_for_substitute',
        className: 'ה3',
        subject: 'מתמטיקה',
      }),
    ).toBe('מילוי מקום חדש | 23.08 | כיתה ה3 | פורסם 16:18:42')
  })

  it('never includes description in subject', () => {
    const subject = buildSubstituteBoardEmailSubject({
      ...baseInput,
      postType: 'looking_for_substitute',
      className: 'ח1',
      subject: 'מתמטיקה',
    })
    expect(subject.toLowerCase()).not.toContain('description')
    expect(subject).not.toMatch(/תיאור\s*:/)
  })

  it('includes created_at rendered in Asia/Jerusalem', () => {
    expect(SUBSTITUTE_BOARD_EMAIL_SUBJECT_TIMEZONE).toBe('Asia/Jerusalem')
    expect(formatSubstituteBoardEmailPublishedAt(PUBLISHED_A)).toBe('16:18:42')
    expect(formatSubstituteBoardEmailPublishedAt(PUBLISHED_B)).toBe('16:22:07')
    const subject = buildSubstituteBoardEmailSubject({
      ...baseInput,
      postType: 'looking_for_substitute',
      className: 'ח1',
      startTime: '10:30:00',
      endTime: '11:15:00',
      createdAt: PUBLISHED_A,
    })
    expect(subject).toContain('פורסם 16:18:42')
  })

  it('produces distinct subjects for otherwise-identical posts with different created_at', () => {
    const shared = {
      ...baseInput,
      postType: 'looking_for_substitute' as const,
      className: 'ח1',
      startTime: '10:30:00',
      endTime: '11:15:00',
    }
    const postA = buildSubstituteBoardEmailSubject({
      ...shared,
      createdAt: PUBLISHED_A,
    })
    const postB = buildSubstituteBoardEmailSubject({
      ...shared,
      createdAt: PUBLISHED_B,
    })
    expect(postA).toBe('מילוי מקום חדש | 23.08 | כיתה ח1 | 10:30–11:15 | פורסם 16:18:42')
    expect(postB).toBe('מילוי מקום חדש | 23.08 | כיתה ח1 | 10:30–11:15 | פורסם 16:22:07')
    expect(postA).not.toBe(postB)
  })

  it('produces distinct useful subjects for two representative posts', () => {
    const postA = buildSubstituteBoardEmailSubject({
      ...baseInput,
      postType: 'looking_for_substitute',
      className: 'ח1',
      startTime: '10:30:00',
      endTime: '11:15:00',
      createdAt: PUBLISHED_A,
    })
    const postB = buildSubstituteBoardEmailSubject({
      ...baseInput,
      postType: 'available_for_substitute',
      date: '2026-08-24',
      startTime: '12:15:00',
      endTime: '13:00:00',
      createdAt: PUBLISHED_B,
    })
    expect(postA).not.toBe(postB)
    expect(postA).toContain('מילוי מקום חדש')
    expect(postB).toContain('פנויה למילוי מקום')
    expect(postB).toContain('24.08')
  })
})

describe('Substitute Board email — threading + idempotency preservation', () => {
  const dispatcher = read(DISPATCHER)

  it('loads authoritative created_at and does not send thread headers', () => {
    expect(dispatcher).toContain('created_at')
    expect(dispatcher).toContain('createdAt: postRow.created_at')
    const sendResendBlock = dispatcher.slice(
      dispatcher.indexOf('async function sendResendEmail'),
      dispatcher.indexOf('Deno.serve'),
    )
    expect(sendResendBlock).not.toContain('In-Reply-To')
    expect(sendResendBlock).not.toContain('References')
    expect(sendResendBlock).not.toContain('in_reply_to')
    expect(sendResendBlock).toMatch(/JSON\.stringify\(\{\s*\n\s*from:/)
    expect(sendResendBlock).toContain('subject: input.subject')
    expect(dispatcher).toContain('buildSubstituteBoardEmailSubject')
  })

  it('keeps delivery idempotency key unchanged', () => {
    expect(
      buildSubstituteBoardEmailIdempotencyKey('post-1', 'user-2'),
    ).toBe('mpex/substitute-board/v1/post-1/user-2')
    expect(dispatcher).toContain('buildSubstituteBoardEmailIdempotencyKey')
    expect(dispatcher).toContain('Idempotency-Key')
  })

  it('leaves email body, outbox, cron, and recipient architecture unchanged', () => {
    const body = buildSubstituteBoardEmailTextBody({
      postType: 'looking_for_substitute',
      date: '2026-08-23',
      startTime: '10:30:00',
      endTime: '11:15:00',
      className: 'ח1',
      subject: 'מתמטיקה',
      publisherFullName: 'ישראל ישראלי',
      ctaUrl: 'https://mpex.school/?section=substituteBoard',
    })
    expect(body).toContain('פורסמה בקשה חדשה בלוח מילויי מקום')
    expect(body).toContain('צפייה בבקשה ומענה')

    const outbox = read(OUTBOX_MIGRATION)
    const cron = read(CRON_MIGRATION)
    expect(outbox).toContain('claim_substitute_board_email_deliveries')
    expect(outbox).toContain("INTERVAL '5 minutes'")
    expect(outbox).toContain("u.primary_role = 'teacher'::public.user_role")
    expect(cron).toContain("'* * * * *'")
    expect(dispatcher).toContain('claim_substitute_board_email_jobs')
    expect(dispatcher).toContain('claim_substitute_board_email_deliveries')
    expect(dispatcher).not.toContain('CREATE TABLE')
    expect(dispatcher).not.toContain('ALTER TABLE')
  })
})
