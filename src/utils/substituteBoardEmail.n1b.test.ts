/**
 * Substitute Board email N1B — production scheduler / readiness contracts.
 * Source analysis only — does not apply migrations, set secrets, or deploy.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const OUTBOX_MIGRATION =
  'supabase/migrations/20250820109000_substitute_board_email_outbox_n1.sql'
const CRON_MIGRATION =
  'supabase/migrations/20250820109100_substitute_board_email_dispatcher_cron_n1b.sql'
const DISPATCHER =
  'supabase/functions/substitute-board-email-dispatcher/index.ts'
const README =
  'supabase/functions/substitute-board-email-dispatcher/README.md'
const REQUIRE_SERVICE_ROLE =
  'supabase/functions/_shared/requireServiceRole.ts'
const CONFIG = 'supabase/config.toml'
const ENV_EXAMPLE = '.env.example'
const MEETING_CRON =
  'supabase/migrations/20250813210000_schedule_meeting_reminder_dispatcher.sql'

const PHASE3_MARKERS = [
  'QUOTATION_SENDER_EMAIL',
  'school-registration-quotation-send',
  'mpex-quotation-send',
  '../_shared/quotationPdf',
]

describe('Substitute Board email N1B — scheduler migration', () => {
  const cron = read(CRON_MIGRATION)
  const outbox = read(OUTBOX_MIGRATION)
  const meetingCron = read(MEETING_CRON)

  it('is a separate forward-only migration after 109000', () => {
    expect(existsSync(resolve(root, CRON_MIGRATION))).toBe(true)
    expect(existsSync(resolve(root, OUTBOX_MIGRATION))).toBe(true)
    expect(CRON_MIGRATION > OUTBOX_MIGRATION).toBe(true)
    expect(outbox).not.toContain('cron.schedule')
    expect(outbox).not.toContain('substitute-board-email-dispatcher')
    expect(cron).toContain('substitute-board-email-dispatcher')
    expect(cron).toContain('20250820109000')
  })

  it('schedules once per minute via pg_cron + net.http_post', () => {
    expect(cron).toContain("cron.schedule(")
    expect(cron).toContain("'substitute-board-email-dispatcher'")
    expect(cron).toContain("'* * * * *'")
    expect(cron).toContain('net.http_post')
    expect(cron).toContain(
      'https://kkafmsvntwqweudallty.supabase.co/functions/v1/substitute-board-email-dispatcher',
    )
    expect(cron).toContain("body := '{}'::jsonb")
  })

  it('uses Vault lookups and never embeds service_role / API key literals', () => {
    expect(cron).toContain("name = 'PROJECT_PUBLISHABLE_KEY'")
    expect(cron).toContain("name = 'CRON_SERVICE_ROLE_KEY'")
    expect(cron).toContain('vault.decrypted_secrets')
    expect(cron).toContain("'Authorization', 'Bearer ' ||")
    expect(cron).toContain("'apikey'")
    expect(cron).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    expect(cron).not.toMatch(/service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/)
    expect(cron).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(cron).not.toContain('RESEND_API_KEY')
    // Same Vault contract as meeting-reminder scheduler.
    expect(meetingCron).toContain("name = 'CRON_SERVICE_ROLE_KEY'")
    expect(meetingCron).toContain("name = 'PROJECT_PUBLISHABLE_KEY'")
  })

  it('fails clearly when pg_cron, vault, or pg_net are unavailable', () => {
    expect(cron).toContain('pg_cron is required')
    expect(cron).toContain('Vault secret PROJECT_PUBLISHABLE_KEY is required')
    expect(cron).toContain('Vault secret CRON_SERVICE_ROLE_KEY is required')
    expect(cron).toContain('pg_net net.http_post is required')
  })

  it('documents overlapping-run safety under N1A leases', () => {
    expect(cron).toContain('SKIP LOCKED')
    expect(cron).toContain('leases')
    expect(cron).toContain('substitute_board_posts')
    expect(outbox).toContain('FOR UPDATE OF j SKIP LOCKED')
    expect(outbox).toContain('FOR UPDATE OF d SKIP LOCKED')
    expect(outbox).toContain("INTERVAL '5 minutes'")
  })
})

describe('Substitute Board email N1B — auth + Resend readiness', () => {
  const dispatcher = read(DISPATCHER)
  const readme = read(README)
  const requireServiceRole = read(REQUIRE_SERVICE_ROLE)
  const config = read(CONFIG)
  const envExample = read(ENV_EXAMPLE)

  it('keeps verify_jwt and service_role application gate', () => {
    expect(config).toMatch(
      /\[functions\.substitute-board-email-dispatcher\]\s*\nverify_jwt = true/,
    )
    expect(dispatcher).toContain('requireServiceRoleJwt')
    expect(requireServiceRole).toContain("role === 'service_role'")
    expect(requireServiceRole).toContain("error: 'forbidden'")
    expect(dispatcher).toContain('client_payload_rejected')
  })

  it('documents production APP_URL and Resend sender contract', () => {
    expect(envExample).toContain('APP_URL=https://mpex.school')
    expect(envExample).toContain('SUBSTITUTE_BOARD_SENDER_EMAIL')
    expect(envExample).toContain('RESEND_API_KEY')
    expect(envExample).toContain('Do not reuse QUOTATION_SENDER_EMAIL')
    expect(readme).toContain('https://mpex.school')
    expect(readme).toContain('MPEX <notifications@your-verified-domain.com>')
    expect(readme).toContain('CEO Resend checklist')
    expect(dispatcher).toContain('SUBSTITUTE_BOARD_SENDER_EMAIL')
    expect(dispatcher).toContain('from: senderEmail')
    // No Phase 3 sender reuse / leakage in dispatcher.
    for (const marker of PHASE3_MARKERS) {
      expect(dispatcher).not.toContain(marker)
      expect(readme).not.toContain('QUOTATION_SENDER_EMAIL=')
    }
  })

  it('documents deploy-before-cron and controlled test institution strategy', () => {
    expect(readme).toContain('deploy the Edge Function **before** applying the scheduler')
    expect(readme).toContain('dedicated test institution')
    expect(readme).toContain('Do **not** add hidden recipient filters')
    expect(readme).toContain('* * * * *')
    expect(readme).toContain('CRON_SERVICE_ROLE_KEY')
    expect(readme).toContain('PROJECT_PUBLISHABLE_KEY')
  })

  it('keeps N1 config.toml hunk isolated from Phase 3 quotation blocks', () => {
    const n1Block = config.match(
      /# Substitute Board email outbox worker[\s\S]*?\[functions\.substitute-board-email-dispatcher\]\s*\nverify_jwt = true/,
    )
    expect(n1Block?.[0]).toBeTruthy()
    expect(n1Block?.[0]).not.toContain('school-registration-quotation')
    // Phase 3 blocks may exist in the dirty working tree; they must remain separate.
    expect(config).toContain('[functions.substitute-board-email-dispatcher]')
  })
})
