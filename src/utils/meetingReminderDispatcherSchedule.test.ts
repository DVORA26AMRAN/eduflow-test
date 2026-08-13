import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scheduleMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250813210000_schedule_meeting_reminder_dispatcher.sql',
)
const printingSchedulePath = resolve(
  process.cwd(),
  'supabase/migrations/20250804210000_printing_requests_phase4_schedules.sql',
)
const phase5RemindersPath = resolve(
  process.cwd(),
  'supabase/migrations/20250720120000_meeting_calendar_phase5_reminders.sql',
)
const dispatcherPath = resolve(
  process.cwd(),
  'supabase/functions/meeting-reminder-dispatcher/index.ts',
)
const configPath = resolve(process.cwd(), 'supabase/config.toml')

describe('Gate 3.1 — meeting-reminder-dispatcher production schedule', () => {
  const scheduleSql = readFileSync(scheduleMigrationPath, 'utf8')
  const printingSql = readFileSync(printingSchedulePath, 'utf8')
  const phase5Sql = readFileSync(phase5RemindersPath, 'utf8')
  const dispatcher = readFileSync(dispatcherPath, 'utf8')
  const config = readFileSync(configPath, 'utf8')

  it('ships the forward-only schedule migration', () => {
    expect(existsSync(scheduleMigrationPath)).toBe(true)
  })

  it('schedules a stable cron job name for meeting-reminder-dispatcher', () => {
    expect(scheduleSql).toContain("cron.schedule(")
    expect(scheduleSql).toContain("'meeting-reminder-dispatcher'")
    expect(scheduleSql).toContain("'*/5 * * * *'")
  })

  it('invokes the Edge Function URL, not the dispatch RPC from pg_cron', () => {
    const cronBody = scheduleSql.slice(
      scheduleSql.indexOf('$cron$'),
      scheduleSql.lastIndexOf('$cron$') + '$cron$'.length,
    )
    expect(scheduleSql).toContain('net.http_post')
    expect(scheduleSql).toContain(
      '/functions/v1/meeting-reminder-dispatcher',
    )
    // Cron body must HTTP-call the Edge Function; never invoke the RPC directly.
    expect(cronBody).toContain('net.http_post')
    expect(cronBody).not.toContain('meeting_calendar_dispatch_due_reminders')
    expect(cronBody).not.toMatch(/PERFORM\s+public\.meeting_calendar_dispatch/i)
  })

  it('uses the same Vault credential pattern as printing workers', () => {
    expect(scheduleSql).toContain('vault.decrypted_secrets')
    expect(scheduleSql).toContain("'PROJECT_PUBLISHABLE_KEY'")
    expect(scheduleSql).toContain("'CRON_SERVICE_ROLE_KEY'")
    expect(printingSql).toContain("'PROJECT_PUBLISHABLE_KEY'")
    expect(printingSql).toContain("'CRON_SERVICE_ROLE_KEY'")
    expect(scheduleSql).not.toContain('eyJ')
    expect(scheduleSql).not.toContain('service_role_key')
  })

  it('is idempotent on re-apply via unschedule-by-name before schedule', () => {
    expect(scheduleSql).toContain('cron.unschedule(jobid)')
    expect(scheduleSql).toMatch(
      /WHERE jobname IN \(\s*'meeting-reminder-dispatcher'\s*\)/,
    )
  })

  it('does not allow anon/public invocation from the schedule body', () => {
    expect(scheduleSql).toContain("'Authorization', 'Bearer ' ||")
    expect(scheduleSql).toContain("'CRON_SERVICE_ROLE_KEY'")
    expect(scheduleSql.toLowerCase()).not.toContain('anon_key')
    expect(scheduleSql).not.toContain('Bearer anon')
  })

  it('keeps the dispatcher service-role protected with verify_jwt', () => {
    expect(dispatcher).toContain('requireServiceRoleJwt')
    expect(dispatcher).toContain('meeting_calendar_dispatch_due_reminders')
    expect(config).toContain('[functions.meeting-reminder-dispatcher]')
    expect(config).toMatch(
      /\[functions\.meeting-reminder-dispatcher\]\s*\nverify_jwt = true/,
    )
  })

  it('relies on Phase 5 dispatch idempotency (pending → sent + notification unique)', () => {
    expect(phase5Sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(phase5Sql).toContain("status = 'pending'")
    expect(phase5Sql).toContain("status = 'sent'")
    expect(phase5Sql).toContain('notifications_user_source_reminder_uidx')
    expect(phase5Sql).toContain("metadata ->> 'source_reminder_id'")
  })

  it('does not schedule reminders from the browser or a second platform', () => {
    expect(scheduleSql).not.toContain('vercel')
    expect(scheduleSql).not.toContain('setInterval')
    expect(dispatcher).not.toContain('setInterval')
  })
})
