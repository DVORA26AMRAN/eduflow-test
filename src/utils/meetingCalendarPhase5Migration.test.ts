import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250720120000_meeting_calendar_phase5_reminders.sql',
)

describe('Phase 5 migration architecture guards', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('creates meeting_reminders ledger with duplicate protection', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.meeting_reminders')
    expect(sql).toContain("reminder_kind IN ('24h', '1h')")
    expect(sql).toContain("status IN ('pending', 'sent', 'cancelled')")
    expect(sql).toContain('meeting_reminders_meeting_slot_kind_unique')
  })

  it('schedules 24h/1h with less-than-24h and less-than-1h skip rules', () => {
    expect(sql).toContain('meeting_calendar_schedule_reminders_for_slot')
    expect(sql).toContain("INTERVAL '24 hours'")
    expect(sql).toContain("INTERVAL '1 hour'")
    expect(sql).toContain("'less_than_1h'")
    expect(sql).toContain("'less_than_24h'")
  })

  it('cancels reminders on cancel and regenerates on reschedule confirm', () => {
    expect(sql).toContain('meeting_calendar_cancel_pending_reminders_for_meeting')
    expect(sql).toContain('meeting_calendar_cancel_pending_reminders_for_slot')
    expect(sql).toContain('PERFORM public.meeting_calendar_cancel_pending_reminders_for_slot')
    expect(sql).toContain('PERFORM public.meeting_calendar_schedule_reminders_for_slot')
    expect(sql).toContain('PERFORM public.meeting_calendar_cancel_pending_reminders_for_meeting')
  })

  it('dispatches via existing notifications with MEETING_REMINDER and source_reminder_id idempotency', () => {
    expect(sql).toContain('meeting_calendar_dispatch_due_reminders')
    expect(sql).toContain("'MEETING_REMINDER'")
    expect(sql).toContain('notifications_user_source_reminder_uidx')
    expect(sql).toContain("metadata ->> 'source_reminder_id'")
    expect(sql).toContain('meeting_calendar_notify_meeting_participants')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.meeting_calendar_dispatch_due_reminders(TIMESTAMPTZ) TO service_role')
  })

  it('documents Edge Function as the sole production scheduler and does not enable database cron', () => {
    expect(sql).toContain('Edge Function: meeting-reminder-dispatcher')
    expect(sql).toContain('No database cron job is configured by this migration')
    expect(sql).not.toContain('cron.schedule')
    expect(sql).not.toContain('cron.unschedule')
    expect(sql).not.toContain("extname = 'pg_cron'")
  })

  it('does not introduce email, SMS, push, or external calendar integrations', () => {
    const body = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .toLowerCase()

    expect(body).not.toContain('smtp')
    expect(body).not.toContain('sendgrid')
    expect(body).not.toContain('twilio')
    expect(body).not.toContain('google')
    expect(body).not.toContain('outlook')
    expect(body).not.toContain('fcm')
    expect(body).not.toContain('apns')
  })

  it('does not demote CONFIRMED during reschedule or widen calendar reads', () => {
    expect(sql).toContain("v_is_reschedule := (v_meeting.current_state = 'CONFIRMED' AND v_meeting.rescheduling_active)")
    expect(sql).not.toContain('OR m.rescheduling_active = TRUE')
    expect(sql).not.toContain("m.current_state NOT IN ('CANCELLED', 'COMPLETED')")
  })
})
