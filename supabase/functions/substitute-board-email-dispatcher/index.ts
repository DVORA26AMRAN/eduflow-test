/**
 * substitute-board-email-dispatcher (N1 / N1A)
 *
 * Async outbox worker for Substitute Board publish emails.
 * - Invocation: cron / backend only with service_role JWT
 * - Never accepts recipient lists or email body from the client
 * - Atomic delivery claim via claim_substitute_board_email_deliveries
 * - At-least-once send + deterministic Resend Idempotency-Key
 * - Does not import Phase 3 quotation sender
 *
 * N1 CTA limitation: APP_URL/?section=substituteBoard (board section only;
 * exact postId deep-link + auth-return is N2).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { resolveMpexAppOrigin } from '../_shared/mpexAppUrl.ts'
import { requireServiceRoleJwt } from '../_shared/requireServiceRole.ts'
import {
  SUBSTITUTE_BOARD_EMAIL_CTA_LABEL,
  SUBSTITUTE_BOARD_EMAIL_DELIVERY_BATCH_SIZE,
  SUBSTITUTE_BOARD_EMAIL_JOB_CLAIM_LIMIT,
  SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS,
  buildSubstituteBoardEmailCtaUrl,
  buildSubstituteBoardEmailHtmlBody,
  buildSubstituteBoardEmailIdempotencyKey,
  buildSubstituteBoardEmailSubject,
  buildSubstituteBoardEmailTextBody,
  type SubstituteBoardEmailPostType,
} from './emailContent.ts'

type Json = Record<string, unknown>

type JobRow = {
  id: string
  post_id: string
  institution_id: string
  status: string
  attempt_count: number
}

type DeliveryRow = {
  id: string
  job_id: string
  post_id: string
  recipient_user_id: string
  recipient_email: string
  recipient_full_name: string | null
  status: string
  attempt_count: number
}

type PostRow = {
  id: string
  post_type: string
  date: string
  start_time: string | null
  end_time: string | null
  class_name: string | null
  subject: string | null
  created_at: string
  created_by_user_id: string
}

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) {
    throw new Error(`missing_env:${name}`)
  }
  return value
}

function asPostType(value: string): SubstituteBoardEmailPostType | null {
  if (value === 'looking_for_substitute' || value === 'available_for_substitute') {
    return value
  }
  return null
}

async function sendResendEmail(input: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  })

  const raw = await response.text()
  let parsed: Record<string, unknown>
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }

  if (!response.ok) {
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : raw.slice(0, 500) || `http_${response.status}`
    return { ok: false, error: message }
  }

  const messageId = typeof parsed.id === 'string' ? parsed.id : null
  return { ok: true, messageId }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const auth = requireServiceRoleJwt(request.headers.get('Authorization'))
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status)
  }

  // Reject client-shaped fan-out payloads — worker derives everything server-side.
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text.trim()) {
      body = JSON.parse(text) as Record<string, unknown>
    }
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  if (
    body.recipients !== undefined ||
    body.recipient_emails !== undefined ||
    body.email_body !== undefined ||
    body.email_subject !== undefined ||
    body.to !== undefined
  ) {
    return jsonResponse({ ok: false, error: 'client_payload_rejected' }, 400)
  }

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = requireEnv('RESEND_API_KEY')
    const senderEmail = requireEnv('SUBSTITUTE_BOARD_SENDER_EMAIL')
    const appOrigin = resolveMpexAppOrigin({
      configuredAppUrl: requireEnv('APP_URL'),
      supabaseUrl,
    })
    const ctaUrl = buildSubstituteBoardEmailCtaUrl(appOrigin)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: claimed, error: claimError } = await supabase.rpc(
      'claim_substitute_board_email_jobs',
      { p_limit: SUBSTITUTE_BOARD_EMAIL_JOB_CLAIM_LIMIT },
    )

    if (claimError) {
      console.error('[substitute-board-email-dispatcher] claim failed', claimError)
      return jsonResponse({ ok: false, error: 'claim_failed' }, 500)
    }

    const jobs = (claimed ?? []) as JobRow[]
    let sentCount = 0
    let failedCount = 0
    let skippedCount = 0

    for (const job of jobs) {
      const failJob = async (lastError: string) => {
        await supabase
          .from('substitute_board_email_jobs')
          .update({
            status: 'failed',
            last_error: lastError,
            processed_at: new Date().toISOString(),
            processing_started_at: null,
            lease_expires_at: null,
          })
          .eq('id', job.id)
        failedCount += 1
      }

      const { data: post, error: postError } = await supabase
        .from('substitute_board_posts')
        .select(
          'id, post_type, date, start_time, end_time, class_name, subject, created_at, created_by_user_id',
        )
        .eq('id', job.post_id)
        .maybeSingle()

      if (postError || !post) {
        await failJob('post_unavailable')
        continue
      }

      const postRow = post as PostRow
      const postType = asPostType(postRow.post_type)
      if (!postType) {
        await failJob('invalid_post_type')
        continue
      }

      const { data: publisher } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', postRow.created_by_user_id)
        .maybeSingle()

      const emailSubject = buildSubstituteBoardEmailSubject({
        postType,
        date: postRow.date,
        startTime: postRow.start_time,
        endTime: postRow.end_time,
        className: postRow.class_name,
        subject: postRow.subject,
        createdAt: postRow.created_at,
      })

      const publisherFullName =
        typeof publisher?.full_name === 'string' ? publisher.full_name : null

      const summaryBase = {
        postType,
        date: postRow.date,
        startTime: postRow.start_time,
        endTime: postRow.end_time,
        className: postRow.class_name,
        subject: postRow.subject,
        publisherFullName,
        ctaUrl,
      }

      // Atomic claim — never SELECT-then-UPDATE deliveries from the client.
      const { data: deliveries, error: deliveriesError } = await supabase.rpc(
        'claim_substitute_board_email_deliveries',
        {
          p_job_id: job.id,
          p_limit: SUBSTITUTE_BOARD_EMAIL_DELIVERY_BATCH_SIZE,
        },
      )

      if (deliveriesError) {
        await failJob('deliveries_claim_failed')
        continue
      }

      for (const delivery of (deliveries ?? []) as DeliveryRow[]) {
        // Claim RPC never returns sent/skipped; defensive skip only.
        if (delivery.status === 'sent' || delivery.status === 'skipped') {
          skippedCount += 1
          continue
        }

        const idempotencyKey = buildSubstituteBoardEmailIdempotencyKey(
          delivery.post_id,
          delivery.recipient_user_id,
        )

        const recipientFullName =
          typeof delivery.recipient_full_name === 'string'
            ? delivery.recipient_full_name
            : null

        const textBody = buildSubstituteBoardEmailTextBody({
          ...summaryBase,
          recipientFullName,
        })
        const htmlBody = buildSubstituteBoardEmailHtmlBody({
          ...summaryBase,
          recipientFullName,
        })

        // Guard: description must never appear in the email body.
        if (
          textBody.includes('description') ||
          htmlBody.includes('description') ||
          /תיאור\s*:/.test(textBody) ||
          /תיאור\s*:/.test(htmlBody)
        ) {
          await failJob('content_contract_violation')
          continue
        }

        // At-least-once: provider success + crash before DB mark may retry after
        // lease expiry; deterministic Idempotency-Key suppresses duplicate Resend sends.
        const sendResult = await sendResendEmail({
          apiKey: resendApiKey,
          from: senderEmail,
          to: delivery.recipient_email,
          subject: emailSubject,
          text: textBody,
          html: htmlBody,
          idempotencyKey,
        })

        if (!sendResult.ok) {
          const terminalSkip =
            delivery.attempt_count >= SUBSTITUTE_BOARD_EMAIL_MAX_DELIVERY_ATTEMPTS
          await supabase
            .from('substitute_board_email_deliveries')
            .update({
              status: terminalSkip ? 'skipped' : 'failed',
              last_error: terminalSkip
                ? 'max_attempts_exceeded'
                : sendResult.error.slice(0, 1000),
              processing_started_at: null,
              lease_expires_at: null,
            })
            .eq('id', delivery.id)
            .neq('status', 'sent')
          if (terminalSkip) {
            skippedCount += 1
          } else {
            failedCount += 1
          }
          continue
        }

        await supabase
          .from('substitute_board_email_deliveries')
          .update({
            status: 'sent',
            provider_message_id: sendResult.messageId,
            sent_at: new Date().toISOString(),
            last_error: null,
            processing_started_at: null,
            lease_expires_at: null,
          })
          .eq('id', delivery.id)
        sentCount += 1
      }

      const { error: finalizeError } = await supabase.rpc(
        'finalize_substitute_board_email_job',
        { p_job_id: job.id },
      )
      if (finalizeError) {
        console.error('[substitute-board-email-dispatcher] finalize failed', {
          jobId: job.id,
          finalizeError,
        })
      }
    }

    return jsonResponse({
      ok: true,
      claimed_jobs: jobs.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      cta_label: SUBSTITUTE_BOARD_EMAIL_CTA_LABEL,
      cta_url: ctaUrl,
      note: 'N1 CTA opens substitute board section only; exact post deep-link is N2. At-least-once delivery; Resend Idempotency-Key protects provider-success/DB-crash window.',
    })
  } catch (error) {
    console.error('[substitute-board-email-dispatcher] failed', error)
    const message = error instanceof Error ? error.message : 'internal_error'
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
