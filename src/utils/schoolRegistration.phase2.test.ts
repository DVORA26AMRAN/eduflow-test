import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_STATUS_LABELS,
  SCHOOL_REGISTRATION_NOTE_MAX_LENGTH,
  SCHOOL_REGISTRATION_STATUSES,
} from '../types/schoolRegistration'
import {
  getFollowUpUrgency,
  isSchoolRegistrationStatus,
  validateInternalNoteText,
} from './schoolRegistrationSales'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('school registration Phase 2 — sales handling', () => {
  const migration = read(
    'supabase/migrations/20250816030000_school_registrations_phase2_sales.sql',
  )
  const phase1Migration = read(
    'supabase/migrations/20250816010000_school_registrations_phase1.sql',
  )
  const service = read('src/services/schoolRegistration.ts')
  const section = read('src/components/platform/PlatformAdminRegistrationsSection.tsx')
  const edge = read('supabase/functions/school-registration-intake/index.ts')
  const managerPage = read('src/pages/ManagerDashboardPage.tsx')
  const teacherPage = read('src/pages/TeacherDashboardPage.tsx')
  const secretaryPage = read('src/pages/SecretaryDashboardPage.tsx')

  it('defines Phase 2 lifecycle statuses with Hebrew labels', () => {
    expect(SCHOOL_REGISTRATION_STATUSES).toEqual([
      'new',
      'contacted',
      'awaiting_response',
      'interested',
      'closed',
      'not_relevant',
    ])
    expect(REGISTRATION_STATUS_LABELS.new).toBe('חדש')
    expect(REGISTRATION_STATUS_LABELS.contacted).toBe('יצרתי קשר')
    expect(REGISTRATION_STATUS_LABELS.awaiting_response).toBe('ממתינה לתשובה')
    expect(REGISTRATION_STATUS_LABELS.interested).toBe('מעוניינת')
    expect(REGISTRATION_STATUS_LABELS.closed).toBe('נסגר')
    expect(REGISTRATION_STATUS_LABELS.not_relevant).toBe('לא רלוונטי')
    expect(migration).toContain("'awaiting_response'")
    expect(migration).toContain("'not_relevant'")
    expect(isSchoolRegistrationStatus('in_review')).toBe(false)
    expect(isSchoolRegistrationStatus('converted')).toBe(false)
  })

  it('Platform Admin can add append-only notes; empty and oversized rejected', () => {
    expect(migration).toContain('platform_admin_add_school_registration_note')
    expect(migration).toContain('CREATE TABLE public.school_registration_notes')
    expect(migration).toContain('school_registration_notes_note_text_not_blank')
    expect(migration).toContain('school_registration_notes_note_text_max_len')
    expect(migration).toContain('char_length(note_text) <= 2000')
    expect(migration).not.toMatch(
      /UPDATE\s+public\.school_registration_notes/i,
    )
    expect(service).toContain('platform_admin_add_school_registration_note')
    expect(service).toContain('addSchoolRegistrationNoteForPlatformAdmin')

    const empty = validateInternalNoteText('   ')
    expect(empty.ok).toBe(false)

    const oversized = validateInternalNoteText('x'.repeat(SCHOOL_REGISTRATION_NOTE_MAX_LENGTH + 1))
    expect(oversized.ok).toBe(false)

    const ok = validateInternalNoteText(' שיחת היכרות ')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.noteText).toBe('שיחת היכרות')
  })

  it('status mutation is atomic with history; invalid and no-op handled', () => {
    expect(migration).toContain('platform_admin_update_school_registration_status')
    expect(migration).toContain('CREATE TABLE public.school_registration_status_history')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('INSERT INTO public.school_registration_status_history')
    expect(migration).toContain("'status_changed'")
    expect(migration).toContain("'changed', false")
    expect(migration).toContain("RAISE EXCEPTION 'Invalid status.'")
    expect(migration).toContain('school_registration_status_history_changed')
    expect(migration).toMatch(/IF v_previous = v_status THEN[\s\S]*changed',\s*false/)
    expect(service).toContain('platform_admin_update_school_registration_status')
  })

  it('follow-up can be set, rescheduled, and cleared with audit events', () => {
    expect(migration).toContain('follow_up_at')
    expect(migration).toContain('platform_admin_set_school_registration_follow_up')
    expect(migration).toContain("'follow_up_set'")
    expect(migration).toContain("'follow_up_rescheduled'")
    expect(migration).toContain("'follow_up_cleared'")
    expect(service).toContain('setSchoolRegistrationFollowUpForPlatformAdmin')
    expect(section).toContain('שמירת מעקב')
    expect(section).toContain('ביטול מעקב')
  })

  it('calculates due/overdue follow-up state correctly', () => {
    const now = new Date(2026, 7, 16, 12, 0, 0) // Aug 16 2026 local
    expect(getFollowUpUrgency(null, now)).toBe('none')
    expect(
      getFollowUpUrgency(new Date(2026, 7, 15, 9, 0, 0).toISOString(), now),
    ).toBe('overdue')
    expect(
      getFollowUpUrgency(new Date(2026, 7, 16, 18, 0, 0).toISOString(), now),
    ).toBe('due_today')
    expect(
      getFollowUpUrgency(new Date(2026, 7, 17, 9, 0, 0).toISOString(), now),
    ).toBe('future')
  })

  it('activity timeline is chronological and Phase-3 extensible', () => {
    expect(migration).toContain('CREATE TABLE public.school_registration_activities')
    expect(migration).toContain('ORDER BY a.created_at ASC, a.id ASC')
    expect(migration).toContain('platform_admin_list_school_registration_activity')
    expect(migration).toContain("'registration_created'")
    expect(migration).toContain("'note_added'")
    expect(migration).toContain('Phase 3: email_sent, whatsapp_sent, quotation_sent')
    expect(service).toContain('loadSchoolRegistrationActivityForPlatformAdmin')
    expect(section).toContain('ציר פעילות')
  })

  it('intake persists registration + registration_created atomically via RPC', () => {
    const atomicMigration = read(
      'supabase/migrations/20250816040000_school_registration_intake_atomic.sql',
    )
    expect(atomicMigration).toContain('school_registration_intake_create')
    expect(atomicMigration).toContain('INSERT INTO public.school_registrations')
    expect(atomicMigration).toContain('INSERT INTO public.school_registration_activities')
    expect(atomicMigration).toContain("'registration_created'")
    expect(atomicMigration).toContain("status")
    expect(atomicMigration).toContain("'new'")
    expect(atomicMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.school_registration_intake_create',
    )
    expect(atomicMigration).toContain('TO service_role')
    expect(atomicMigration).toContain(
      'REVOKE ALL ON FUNCTION public.school_registration_intake_create',
    )
    expect(atomicMigration).toContain('FROM anon')
    expect(atomicMigration).toContain('FROM authenticated')
    expect(atomicMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.school_registration_intake_create[\s\S]*TO authenticated/i,
    )
    expect(atomicMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.school_registration_intake_create[\s\S]*TO anon/i,
    )

    // Single DB round-trip from Edge: RPC only (no separate table inserts).
    expect(edge).toMatch(/\.rpc\(\s*['"]school_registration_intake_create['"]/)
    expect(edge).not.toMatch(/\.from\(\s*['"]school_registrations['"]\s*\)\s*\.insert/)
    expect(edge).not.toMatch(/\.from\(\s*['"]school_registration_activities['"]\s*\)\s*\.insert/)
    expect(edge).not.toContain('activity insert failed')
  })

  it('does not weaken Phase 1 public intake lockdown', () => {
    expect(phase1Migration).toContain(
      'REVOKE ALL ON TABLE public.school_registrations FROM anon',
    )
    expect(phase1Migration).toContain(
      'REVOKE ALL ON TABLE public.school_registrations FROM authenticated',
    )
    expect(edge).toContain('school_registration_intake_create')
    expect(edge).toContain('invalid_fields')
    expect(edge).not.toMatch(/\.from\(\s*['"]institutions['"]\s*\)/)
    expect(edge).toMatch(/return jsonResponse\(\{\s*ok:\s*true\s*\}\)/)
    expect(service).not.toContain('possibleDuplicate')
  })

  it('Phase 2 tables and mutation RPCs stay Platform Admin only', () => {
    for (const table of [
      'school_registration_notes',
      'school_registration_status_history',
      'school_registration_activities',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`)
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM authenticated`,
      )
      expect(migration).not.toMatch(
        new RegExp(`GRANT\\s+(SELECT|INSERT|UPDATE|ALL).*${table}.*TO\\s+anon`, 'i'),
      )
      expect(migration).not.toMatch(
        new RegExp(
          `GRANT\\s+(SELECT|INSERT|UPDATE|ALL).*${table}.*TO\\s+authenticated`,
          'i',
        ),
      )
    }

    for (const rpc of [
      'platform_admin_update_school_registration_status',
      'platform_admin_add_school_registration_note',
      'platform_admin_set_school_registration_follow_up',
      'platform_admin_list_school_registration_notes',
      'platform_admin_list_school_registration_activity',
    ]) {
      expect(migration).toContain(`platform_admin_require_active`)
      expect(migration).toContain(rpc)
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${rpc}`)
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${rpc}`,
      )
    }

    expect(managerPage).not.toContain('platform_admin_add_school_registration_note')
    expect(teacherPage).not.toContain('platform_admin_add_school_registration_note')
    expect(secretaryPage).not.toContain('platform_admin_add_school_registration_note')
    expect(managerPage).not.toContain('platform_admin_update_school_registration_status')
    expect(teacherPage).not.toContain('platform_admin_set_school_registration_follow_up')
    expect(secretaryPage).not.toContain('platform_admin_list_school_registration_notes')
    expect(managerPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(teacherPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(secretaryPage).not.toContain('PlatformAdminRegistrationsSection')
  })

  it('Platform Admin list/details UI covers sales fields and telephone action', () => {
    expect(section).toContain('בית ספר')
    expect(section).toContain('סמל מוסד')
    expect(section).toContain('איש קשר')
    expect(section).toContain('טלפון')
    expect(section).toContain('סטטוס')
    expect(section).toContain('מעקב')
    expect(section).toContain('נשלח ב־')
    expect(section).toContain('tel:')
    expect(section).toContain('חייג')
    expect(section).toContain('הוספת הערה')
    expect(section).toContain('עדכון סטטוס')
    expect(section).not.toContain('WhatsApp')
    expect(section).not.toContain('whatsapp')
  })
})
