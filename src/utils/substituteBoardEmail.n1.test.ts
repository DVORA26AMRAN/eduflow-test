/**
 * Substitute Board email N1 / N1A — outbox + lease recovery contract tests.
 * Source/SQL analysis only — does not apply migrations or call Resend.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SUBSTITUTE_BOARD_EMAIL_CTA_LABEL,
  SUBSTITUTE_BOARD_EMAIL_DELIVERY_BATCH_SIZE,
  SUBSTITUTE_BOARD_EMAIL_JOB_CLAIM_LIMIT,
  SUBSTITUTE_BOARD_EMAIL_LEASE_SECONDS,
  SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS,
  buildSubstituteBoardEmailCtaUrl,
  buildSubstituteBoardEmailIdempotencyKey,
  buildSubstituteBoardEmailSubject,
  buildSubstituteBoardEmailTextBody,
  translateSubstituteBoardEmailPostType,
} from '../../supabase/functions/substitute-board-email-dispatcher/emailContent'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const MIGRATION =
  'supabase/migrations/20250820109000_substitute_board_email_outbox_n1.sql'
const DISPATCHER =
  'supabase/functions/substitute-board-email-dispatcher/index.ts'
const EMAIL_CONTENT =
  'supabase/functions/substitute-board-email-dispatcher/emailContent.ts'
const README =
  'supabase/functions/substitute-board-email-dispatcher/README.md'
const CONFIG = 'supabase/config.toml'
const ENV_EXAMPLE = '.env.example'
const BOARD_SERVICE = 'src/services/substituteBoard.ts'

const PHASE3_MARKERS = [
  'school-registration-quotation-send',
  'quotationPdf',
  'QUOTATION_SENDER_EMAIL',
  'mpex-quotation-send',
  '../_shared/quotationPdf',
]

function extractFunctionBody(sql: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const after = sql.slice(start)
  const end = after.indexOf('\n$$;')
  expect(end).toBeGreaterThan(0)
  return after.slice(0, end)
}

describe('Substitute Board email N1 — migration outbox', () => {
  const sql = read(MIGRATION)

  it('creates jobs + deliveries with one publication job per post', () => {
    expect(sql).toContain('CREATE TABLE public.substitute_board_email_jobs')
    expect(sql).toContain('CREATE TABLE public.substitute_board_email_deliveries')
    expect(sql).toContain("event_type = 'substitute_board_post_published'")
    expect(sql).toContain(
      'CONSTRAINT substitute_board_email_jobs_post_event_unique UNIQUE (post_id, event_type)',
    )
    expect(sql).toContain(
      'CREATE UNIQUE INDEX substitute_board_email_deliveries_job_recipient_uidx',
    )
    expect(sql).toContain(
      'CREATE UNIQUE INDEX substitute_board_email_deliveries_post_recipient_uidx',
    )
  })

  it('enqueues only on AFTER INSERT of substitute_board_posts', () => {
    expect(sql).toContain('enqueue_substitute_board_post_published_email')
    expect(sql).toContain('substitute_board_posts_enqueue_email_on_insert')
    expect(sql).toContain('AFTER INSERT ON public.substitute_board_posts')
    expect(sql).not.toMatch(/AFTER UPDATE ON public\.substitute_board_posts/)
    expect(sql).not.toMatch(/AFTER DELETE ON public\.substitute_board_posts/)
    expect(sql).toContain('Never sends email')
  })

  it('snapshots active same-institution teachers with non-empty email', () => {
    expect(sql).toContain("u.primary_role = 'teacher'::public.user_role")
    expect(sql).toContain("u.status = 'active'")
    expect(sql).toContain('u.institution_id = NEW.institution_id')
    expect(sql).toContain("NULLIF(btrim(COALESCE(u.email, '')), '') IS NOT NULL")
    expect(sql).toContain('recipient_email')
    expect(sql).toContain('snapshotted at enqueue')
  })

  it('fail-closes RLS and revokes browser table access', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.substitute_board_email_jobs FROM authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.substitute_board_email_deliveries FROM authenticated',
    )
    expect(sql).toContain('REVOKE ALL ON TABLE public.substitute_board_email_jobs FROM anon')
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]*substitute_board_email_(jobs|deliveries)/,
    )
  })

  it('exposes claim/finalize RPCs to service_role only', () => {
    expect(sql).toContain('claim_substitute_board_email_jobs')
    expect(sql).toContain('claim_substitute_board_email_deliveries')
    expect(sql).toContain('finalize_substitute_board_email_job')
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) TO service_role',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) TO service_role',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.finalize_substitute_board_email_job(UUID) TO service_role',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.claim_substitute_board_email_jobs(INTEGER) FROM authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) FROM authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.finalize_substitute_board_email_job(UUID) FROM authenticated',
    )
  })

  it('documents that edit/approval/cancel are out of scope for enqueue', () => {
    expect(sql).toMatch(/NEW INSERT only|AFTER INSERT/i)
    expect(sql).not.toContain('substitute_board_responses')
    expect(sql).not.toContain('secretary_approval')
  })
})

describe('Substitute Board email N1A — lease + claim contracts', () => {
  const sql = read(MIGRATION)
  const jobClaim = extractFunctionBody(sql, 'claim_substitute_board_email_jobs')
  const deliveryClaim = extractFunctionBody(
    sql,
    'claim_substitute_board_email_deliveries',
  )
  const finalize = extractFunctionBody(sql, 'finalize_substitute_board_email_job')

  it('adds lease columns on jobs and deliveries', () => {
    expect(sql).toMatch(/substitute_board_email_jobs[\s\S]*processing_started_at\s+TIMESTAMPTZ/)
    expect(sql).toMatch(/substitute_board_email_jobs[\s\S]*lease_expires_at\s+TIMESTAMPTZ/)
    expect(sql).toMatch(
      /substitute_board_email_deliveries[\s\S]*processing_started_at\s+TIMESTAMPTZ/,
    )
    expect(sql).toMatch(/substitute_board_email_deliveries[\s\S]*lease_expires_at\s+TIMESTAMPTZ/)
    expect(sql).toContain("INTERVAL '5 minutes'")
    expect(SUBSTITUTE_BOARD_EMAIL_LEASE_SECONDS).toBe(300)
  })

  it('job claim uses SKIP LOCKED and includes stale processing only', () => {
    expect(jobClaim).toContain('FOR UPDATE OF j SKIP LOCKED')
    expect(jobClaim).toContain("j.status IN ('queued', 'failed')")
    expect(jobClaim).toContain("j.status = 'processing'")
    expect(jobClaim).toContain('j.lease_expires_at < NOW()')
    expect(jobClaim).toContain('lease_expires_at = NOW() + v_lease')
    expect(jobClaim).toContain('processing_started_at = NOW()')
    expect(jobClaim).toContain('attempt_count = j.attempt_count + 1')
    // Valid live lease must not match the reclaim predicate alone.
    expect(jobClaim).not.toMatch(
      /status = 'processing'\s*AND\s*j\.lease_expires_at > NOW\(\)/,
    )
  })

  it('delivery claim is atomic with SKIP LOCKED and never claims sent/skipped', () => {
    expect(deliveryClaim).toContain('FOR UPDATE OF d SKIP LOCKED')
    expect(deliveryClaim).toContain('attempt_count = d.attempt_count + 1')
    expect(deliveryClaim).toContain('lease_expires_at = NOW() + v_lease')
    expect(deliveryClaim).toContain("d.status = 'queued'")
    expect(deliveryClaim).toContain("d.status = 'failed'")
    expect(deliveryClaim).toContain('d.attempt_count < v_max_attempts')
    expect(deliveryClaim).toContain('d.lease_expires_at < NOW()')
    expect(deliveryClaim).not.toContain("d.status = 'sent'")
    expect(deliveryClaim).not.toMatch(/WHERE[\s\S]*status = 'skipped'/)
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_substitute_board_email_deliveries(UUID, INTEGER) TO service_role',
    )
  })

  it('promotes exhausted attempts to skipped without a new send claim', () => {
    expect(deliveryClaim).toContain("status = 'skipped'")
    expect(deliveryClaim).toContain('max_attempts_exceeded')
    expect(deliveryClaim).toContain('d.attempt_count >= v_max_attempts')
    expect(finalize).toContain('d.attempt_count >= v_max_attempts')
    expect(SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS).toBe(5)
  })

  it('finalize clears leases and never leaves permanent processing', () => {
    expect(finalize).toContain("status = 'completed'")
    expect(finalize).toContain("status = 'queued'")
    expect(finalize).toContain("status = 'failed'")
    expect(finalize).toContain('processing_started_at = NULL')
    expect(finalize).toContain('lease_expires_at = NULL')
    expect(finalize).toContain("status = 'queued'")
    expect(finalize).toContain("status = 'processing'")
    // Leaving processing always clears lease — no terminal processing status.
    const completedBlock = finalize.slice(finalize.indexOf("status = 'completed'"))
    expect(completedBlock).toContain('lease_expires_at = NULL')
  })

  it('documents at-least-once + provider idempotency boundary', () => {
    expect(sql).toContain('At-least-once delivery')
    expect(sql).toContain('mpex/substitute-board/v1/{post_id}/{recipient_user_id}')
    expect(buildSubstituteBoardEmailIdempotencyKey('post-1', 'user-2')).toBe(
      'mpex/substitute-board/v1/post-1/user-2',
    )
  })

  it('keeps enqueue SECURITY DEFINER non-callable by authenticated', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public')
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.enqueue_substitute_board_post_published_email() FROM authenticated',
    )
    expect(sql).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.enqueue_substitute_board_post_published_email()',
    )
  })
})

describe('Substitute Board email N1 — content + CTA', () => {
  it('uses approved Hebrew labels for body and per-post subjects', () => {
    expect(
      buildSubstituteBoardEmailSubject({
        postType: 'looking_for_substitute',
        date: '2026-08-20',
        startTime: null,
        endTime: null,
        className: null,
        subject: null,
        createdAt: '2026-08-20T10:00:00.000Z',
      }),
    ).toBe('מילוי מקום חדש | 20.08 | לוח מילויי מקום | פורסם 13:00:00')
    expect(translateSubstituteBoardEmailPostType('looking_for_substitute')).toBe(
      'מחפשת מילוי מקום',
    )
    expect(translateSubstituteBoardEmailPostType('available_for_substitute')).toBe(
      'פנויה למילוי מקום',
    )
    expect(SUBSTITUTE_BOARD_EMAIL_CTA_LABEL).toBe('צפייה בבקשה ומענה')
  })

  it('builds board-section CTA only (no postId deep-link in N1)', () => {
    expect(buildSubstituteBoardEmailCtaUrl('https://mpex.school')).toBe(
      'https://mpex.school/?section=substituteBoard',
    )
    expect(buildSubstituteBoardEmailCtaUrl('https://mpex.school/')).toBe(
      'https://mpex.school/?section=substituteBoard',
    )
    expect(buildSubstituteBoardEmailCtaUrl('https://mpex.school')).not.toContain('postId')
    expect(buildSubstituteBoardEmailCtaUrl('https://mpex.school')).not.toContain('post_id')
  })

  it('omits description and UUIDs from the text body', () => {
    const body = buildSubstituteBoardEmailTextBody({
      postType: 'looking_for_substitute',
      date: '2026-08-20',
      startTime: '08:00:00',
      endTime: '09:00:00',
      className: 'ג1',
      subject: 'מתמטיקה',
      publisherFullName: 'ישראל ישראלי',
      ctaUrl: 'https://mpex.school/?section=substituteBoard',
    })
    expect(body).toContain('מחפשת מילוי מקום')
    expect(body).toContain('2026-08-20')
    expect(body).toContain('08:00–09:00')
    expect(body).toContain('ג1')
    expect(body).toContain('מתמטיקה')
    expect(body).toContain('ישראל ישראלי')
    expect(body).toContain('צפייה בבקשה ומענה')
    expect(body).toContain('https://mpex.school/?section=substituteBoard')
    expect(body.toLowerCase()).not.toContain('description')
    expect(body).not.toMatch(/תיאור\s*:/)
    expect(body).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
  })

  it('uses deterministic provider idempotency keys', () => {
    expect(
      buildSubstituteBoardEmailIdempotencyKey('post-1', 'user-2'),
    ).toBe('mpex/substitute-board/v1/post-1/user-2')
  })

  it('documents bounded batch sizes', () => {
    expect(SUBSTITUTE_BOARD_EMAIL_DELIVERY_BATCH_SIZE).toBe(25)
    expect(SUBSTITUTE_BOARD_EMAIL_JOB_CLAIM_LIMIT).toBe(5)
  })
})

describe('Substitute Board email N1A — dispatcher isolation', () => {
  const dispatcher = read(DISPATCHER)
  const emailContent = read(EMAIL_CONTENT)
  const readme = read(README)
  const config = read(CONFIG)
  const envExample = read(ENV_EXAMPLE)
  const boardService = read(BOARD_SERVICE)

  it('requires service_role and rejects client recipient/body payloads', () => {
    expect(dispatcher).toContain("from '../_shared/requireServiceRole.ts'")
    expect(dispatcher).toContain('requireServiceRoleJwt')
    expect(dispatcher).toContain('client_payload_rejected')
    expect(dispatcher).toContain('body.recipients !== undefined')
    expect(dispatcher).toContain('body.email_body !== undefined')
    expect(dispatcher).toContain('claim_substitute_board_email_jobs')
    expect(dispatcher).toContain('claim_substitute_board_email_deliveries')
    expect(dispatcher).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(dispatcher).toContain('RESEND_API_KEY')
    expect(dispatcher).toContain('SUBSTITUTE_BOARD_SENDER_EMAIL')
    expect(dispatcher).toContain('APP_URL')
    expect(dispatcher).toContain('Idempotency-Key')
    expect(dispatcher).toContain('buildSubstituteBoardEmailIdempotencyKey')
    expect(dispatcher).toContain('buildSubstituteBoardEmailSubject')
    expect(dispatcher).toContain('section=substituteBoard')
  })

  it('uses atomic delivery claim and does not SELECT-then-claim deliveries', () => {
    expect(dispatcher).toContain('claim_substitute_board_email_deliveries')
    expect(dispatcher).toContain('p_job_id: job.id')
    expect(dispatcher).not.toContain(".in('status', ['queued', 'failed'])")
    expect(dispatcher).not.toContain(".select(\n          'id, job_id, post_id, recipient_user_id")
    expect(dispatcher).toContain('At-least-once')
    expect(dispatcher).toContain('processing_started_at: null')
    expect(dispatcher).toContain('lease_expires_at: null')
    expect(dispatcher).toContain('max_attempts_exceeded')
    // Outcome updates after claim+send are allowed; claim itself must be RPC-only.
    expect(dispatcher).toMatch(
      /\.from\('substitute_board_email_deliveries'\)\s*\n\s*\.update\(/,
    )
  })

  it('does not import Phase 3 quotation sender', () => {
    for (const marker of PHASE3_MARKERS) {
      expect(dispatcher).not.toContain(marker)
      expect(emailContent).not.toContain(marker)
    }
    expect(dispatcher).not.toContain('school-registration-quotation')
  })

  it('keeps create path free of email send and recipient lists', () => {
    expect(boardService).toContain('createSubstituteBoardPost')
    expect(boardService).toContain(".from('substitute_board_posts').insert({")
    expect(boardService).not.toContain('substitute-board-email-dispatcher')
    expect(boardService).not.toContain('RESEND_API_KEY')
    expect(boardService).not.toContain('recipient_emails')
    expect(boardService).not.toContain('substitute_board_email_jobs')
  })

  it('registers dispatcher in config.toml with verify_jwt', () => {
    expect(config).toContain('[functions.substitute-board-email-dispatcher]')
    expect(config).toMatch(
      /\[functions\.substitute-board-email-dispatcher\]\s*\nverify_jwt = true/,
    )
  })

  it('documents required secrets, leases, and N1 CTA limitation', () => {
    expect(envExample).toContain('SUBSTITUTE_BOARD_SENDER_EMAIL')
    expect(envExample).toContain('RESEND_API_KEY')
    expect(envExample).toContain('section=substituteBoard')
    expect(readme).toContain('service_role')
    expect(readme).toContain('postId')
    expect(readme).toContain('N2')
    expect(readme).toContain('25')
    expect(readme).toContain('5 minutes')
    expect(readme).toContain('At-least-once')
    expect(readme).toContain('claim_substitute_board_email_deliveries')
  })

  it('ships dedicated dispatcher files without applying migration in repo scripts', () => {
    expect(existsSync(resolve(root, MIGRATION))).toBe(true)
    expect(existsSync(resolve(root, DISPATCHER))).toBe(true)
    expect(existsSync(resolve(root, EMAIL_CONTENT))).toBe(true)
    expect(read(MIGRATION)).toContain('DO NOT apply until architecture review')
  })
})
