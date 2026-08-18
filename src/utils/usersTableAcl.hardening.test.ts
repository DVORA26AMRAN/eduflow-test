import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canCallerInviteRole } from '../security/tenantInviteRoles'
import {
  canEditOperationalUser,
  canManageCalendar,
  canManageRequests,
} from '../security/institutionCapabilities'
import { isTeacherInactivityRole } from '../security/teacherInactivityPolicy'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const ACL = 'supabase/migrations/20250818102500_users_table_acl_hardening.sql'
const D3C = 'supabase/migrations/20250818103000_deputy_role_d3c_edit_operational_staff.sql'
const D2 = 'supabase/migrations/20250818102000_deputy_role_d2_operational_authorization.sql'
const PHASE1_RLS = 'supabase/migrations/20250614010000_phase_1a_rls.sql'
const EDGE = 'supabase/functions/clever-processor/index.ts'

const APPROVED_COLUMNS = [
  'id',
  'institution_id',
  'primary_role',
  'full_name',
  'email',
  'status',
] as const

const FORBIDDEN_COLUMNS = [
  'national_id',
  'phone',
  'job_title',
  'weekly_hours',
  'onboarding_completed_at',
  'created_at',
] as const

const FRONTEND_USERS_PATHS = [
  'src/services/institutionUsers.ts',
  'src/services/meetingRecipients.ts',
  'src/services/printingRequests.ts',
  'src/services/analytics.ts',
  'src/services/dashboardAnalytics.ts',
  'src/services/requests.ts',
  'src/services/notes.ts',
  'src/services/attachments.ts',
  'src/services/substituteBoard.ts',
  'src/services/requestMessages.ts',
  'src/services/managerPersonalArchive.ts',
]

function parseUsersColumnList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.includes('(') && !part.includes(')'))
}

function grantSelectBlock(sql: string): string {
  const normalized = sql.replace(/\r\n/g, '\n')
  const start = normalized.indexOf('GRANT SELECT (')
  expect(start).toBeGreaterThanOrEqual(0)
  const fromGrant = normalized.slice(start)
  const end = fromGrant.indexOf('TO authenticated;')
  expect(end).toBeGreaterThan(0)
  return fromGrant.slice(0, end)
}

describe('users table ACL hardening', () => {
  const sql = read(ACL)
  const grant = grantSelectBlock(sql)
  const phase1Rls = read(PHASE1_RLS)
  const d2 = read(D2)
  const d3c = read(D3C)
  const edge = read(EDGE)

  it('revokes broad table privileges from PUBLIC, anon, and authenticated', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.users FROM PUBLIC;')
    expect(sql).toContain('REVOKE ALL ON TABLE public.users FROM anon;')
    expect(sql).toContain('REVOKE ALL ON TABLE public.users FROM authenticated;')
    expect(sql).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    expect(sql).toContain('ON TABLE public.users FROM PUBLIC;')
    expect(sql).toContain('ON TABLE public.users FROM anon;')
    expect(sql).toContain('ON TABLE public.users FROM authenticated;')
  })

  it('clears leftover column-level grants before the narrow SELECT grant', () => {
    const revokeColumnsAt = sql.indexOf('REVOKE ALL (%s) ON TABLE public.users FROM authenticated')
    const grantAt = sql.indexOf('GRANT SELECT (')
    expect(revokeColumnsAt).toBeGreaterThan(0)
    expect(grantAt).toBeGreaterThan(revokeColumnsAt)
    expect(sql).toContain("FROM anon'")
    expect(sql).toContain("FROM PUBLIC'")
  })

  it('grants authenticated SELECT only on the approved columns', () => {
    for (const column of APPROVED_COLUMNS) {
      expect(grant).toContain(column)
    }
    expect(sql).toMatch(
      /GRANT SELECT\s*\(\s*id,\s*institution_id,\s*primary_role,\s*full_name,\s*email,\s*status\s*\)\s*ON public\.users TO authenticated;/s,
    )
    expect(sql).not.toMatch(/GRANT SELECT\s+ON\s+(TABLE\s+)?public\.users\s+TO\s+authenticated/i)
    expect(sql).not.toMatch(/GRANT ALL\s+ON\s+(TABLE\s+)?public\.users/i)
  })

  it('does not grant national_id, extended profile, onboarding, or created_at', () => {
    for (const column of FORBIDDEN_COLUMNS) {
      expect(grant).not.toContain(column)
    }
  })

  it('does not grant authenticated INSERT, UPDATE, or DELETE', () => {
    expect(sql).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b[\s\S]{0,80}authenticated/i,
    )
    expect(sql).toContain('FROM authenticated;')
  })

  it('does not revoke or alter service_role privileges', () => {
    expect(sql).not.toMatch(/\bFROM\s+service_role\b/i)
    expect(sql).not.toMatch(/\bTO\s+service_role\b/i)
    expect(sql).not.toMatch(/\bREVOKE\b[^\n]*\bservice_role\b/i)
    expect(sql).not.toMatch(/\bGRANT\b[^\n]*\bservice_role\b/i)
  })

  it('does not weaken existing users RLS', () => {
    expect(phase1Rls).toContain('ALTER TABLE users ENABLE ROW LEVEL SECURITY')
    expect(phase1Rls).toContain('CREATE POLICY "users_read_own_profile"')
    expect(phase1Rls).toContain('CREATE POLICY "users_read_same_institution"')
    expect(phase1Rls).toContain('FOR SELECT')
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('DROP POLICY')
    expect(sql).not.toContain('ALTER POLICY')
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(sql).not.toContain('FORCE ROW LEVEL SECURITY')
  })

  it('keeps D2 calendar/requests and D3B invite green', () => {
    expect(canManageCalendar('deputy')).toBe(true)
    expect(canManageRequests('deputy')).toBe(true)
    expect(canCallerInviteRole('deputy', 'teacher')).toBe(true)
    expect(canCallerInviteRole('deputy', 'secretary')).toBe(true)
    expect(canEditOperationalUser('deputy', 'teacher')).toBe(true)
    expect(d2).toContain('meeting_calendar_validate_role_pair')
    expect(edge).toContain("if (callerRole === 'deputy')")
    expect(edge).toContain('service.from')
    expect(existsSync(resolve(root, D3C))).toBe(true)
    expect(d3c).toContain('CREATE OR REPLACE FUNCTION public.update_staff_member')
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(isTeacherInactivityRole('deputy')).toBe(false)
  })
})

describe('authenticated users column dependencies stay inside the ACL grant', () => {
  it('browser users reads only use id, institution_id, primary_role, full_name, email, status', () => {
    const requested = new Set<string>()

    for (const relativePath of FRONTEND_USERS_PATHS) {
      const source = read(relativePath)
      for (const match of source.matchAll(/from\('users'\)\s*\.select\('([^']+)'\)/g)) {
        for (const column of parseUsersColumnList(match[1])) {
          requested.add(column)
        }
      }
      for (const match of source.matchAll(/users![\w]+\s*\(\s*([^)]+)\)/g)) {
        for (const column of parseUsersColumnList(match[1])) {
          requested.add(column)
        }
      }
    }

    const profile = read('src/services/profile.ts')
    expect(profile).toContain(
      'select=id,full_name,primary_role,institution_id,institutions(id,name,timezone,logo_url,logo_updated_at)',
    )
    requested.add('id')
    requested.add('full_name')
    requested.add('primary_role')
    requested.add('institution_id')

    expect([...requested].sort()).toEqual([...APPROVED_COLUMNS].sort())
    for (const column of FORBIDDEN_COLUMNS) {
      expect(requested.has(column)).toBe(false)
    }
  })
})
