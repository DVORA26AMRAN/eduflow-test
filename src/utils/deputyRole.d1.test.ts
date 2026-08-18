import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPrimaryRole } from '../services/profile'
import { isTeacherInactivityRole } from '../security/teacherInactivityPolicy'
import { translateRole } from './roles'
import type { PrimaryRole } from '../types/user'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const D1_ENUM_MIGRATION = 'supabase/migrations/20250818100000_deputy_role_d1_foundation.sql'
const D1_OPERATOR_MIGRATION =
  'supabase/migrations/20250818101000_deputy_role_d1_operator_helper.sql'
const MANAGER_HELPER_MIGRATION =
  'supabase/migrations/20250702223000_requests_manager_select_policy.sql'
const ALIGNMENT_MIGRATION =
  'supabase/migrations/20250812220000_platform_admin_global_baseline_alignment.sql'
const MANAGER_UNIQUE_MIGRATION =
  'supabase/migrations/20250813010000_platform_admin_manager_invitation_phase2.sql'

describe('Deputy D1 role foundation', () => {
  const d1Enum = read(D1_ENUM_MIGRATION)
  const d1Operator = read(D1_OPERATOR_MIGRATION)
  const managerHelperSql = read(MANAGER_HELPER_MIGRATION)
  const alignment = read(ALIGNMENT_MIGRATION)
  const managerUnique = read(MANAGER_UNIQUE_MIGRATION)
  const app = read('src/App.tsx')
  const userTypes = read('src/types/user.ts')

  it('10000 adds the deputy enum value only and does not use it in dependent SQL', () => {
    expect(d1Enum).toContain("ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'deputy'")
    expect(d1Enum).not.toContain('CREATE OR REPLACE FUNCTION')
    expect(d1Enum).not.toContain('CREATE POLICY')
    expect(d1Enum).not.toContain('CREATE INDEX')
    expect(d1Enum).not.toContain("'deputy'::public.user_role")
    expect(d1Enum).not.toContain('auth_user_is_active_institution_operator_for_institution')
    expect(d1Enum).not.toContain('users_one_active_deputy')
    expect(d1Enum).not.toMatch(/UNIQUE INDEX[\s\S]*deputy/)
  })

  it('10100 creates the operator helper after the enum migration boundary', () => {
    expect(d1Operator).toContain('20250818100000')
    expect(d1Operator).toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_operator_for_institution',
    )
    expect(d1Operator).toContain("'institution_manager'::public.user_role")
    expect(d1Operator).toContain("'deputy'::public.user_role")
    expect(d1Operator).not.toContain('ALTER TYPE public.user_role')
  })

  it('preserves one-active institution_manager uniqueness and tenant/platform isolation', () => {
    expect(managerUnique).toContain('users_one_active_institution_manager_per_institution')
    expect(managerUnique).toContain("primary_role = 'institution_manager'")
    expect(d1Enum).not.toContain('DROP INDEX')
    expect(d1Operator).not.toContain('DROP INDEX')
    expect(alignment).toContain('users_institution_id_role_consistency')
    expect(alignment).toContain("primary_role = 'platform_admin'::public.user_role")
    expect(alignment).toContain('AND institution_id IS NULL')
    expect(alignment).toContain("primary_role <> 'platform_admin'::public.user_role")
    expect(alignment).toContain('AND institution_id IS NOT NULL')
  })

  it('keeps the Manager-only SQL helper Manager-only', () => {
    expect(managerHelperSql).toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution',
    )
    expect(managerHelperSql).toContain("u.primary_role = 'institution_manager'")
    expect(managerHelperSql).not.toContain("'deputy'")
    expect(d1Enum).not.toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution',
    )
    expect(d1Operator).not.toContain(
      'CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution',
    )
  })

  it('introduces an operator helper for Manager + Deputy only', () => {
    expect(d1Operator).toContain('p_institution_id IS NOT NULL')
    expect(d1Operator).toContain('u.institution_id = p_institution_id')
    expect(d1Operator).toContain("u.status = 'active'")
    expect(d1Operator).not.toContain("'secretary'::public.user_role")
    expect(d1Operator).not.toContain("'teacher'::public.user_role")
    expect(d1Operator).not.toContain("'platform_admin'::public.user_role")
    expect(d1Operator).not.toContain('ON public.requests')
    expect(d1Operator).not.toContain('CREATE POLICY')
    expect(d1Operator).not.toContain('users_one_active_deputy')
  })

  it('extends PrimaryRole and profile parsing to accept deputy', () => {
    expect(userTypes).toContain("| 'deputy'")
    expect(isPrimaryRole('deputy')).toBe(true)
    expect(isPrimaryRole('institution_manager')).toBe(true)
    expect(isPrimaryRole('secretary')).toBe(true)
    expect(isPrimaryRole('teacher')).toBe(true)
    expect(isPrimaryRole('platform_admin')).toBe(true)
    expect(isPrimaryRole('admin')).toBe(false)
    expect(isPrimaryRole('manager')).toBe(false)
    expect(isPrimaryRole(null)).toBe(false)

    const allRoles: PrimaryRole[] = [
      'institution_manager',
      'deputy',
      'secretary',
      'teacher',
      'platform_admin',
    ]
    expect(allRoles).toHaveLength(5)
  })

  it('uses the Hebrew identity label סגנית', () => {
    expect(translateRole('deputy')).toBe('סגנית')
    expect(translateRole('institution_manager')).toBe('מנהלת')
  })

  it('does not enable D2 operational Deputy capabilities in D1 SQL', () => {
    expect(app).not.toContain("enabled: isTeacherInactivityRole('deputy')")
    expect(d1Enum).not.toContain('clever-processor')
    expect(d1Operator).not.toContain('clever-processor')
    expect(d1Operator).not.toContain('ON public.requests')
    expect(d1Operator).not.toContain('CREATE POLICY')
  })

  it('does not apply Teacher inactivity logout to Deputy', () => {
    expect(isTeacherInactivityRole('deputy')).toBe(false)
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(app).toContain('isTeacherInactivityRole(currentProfile?.role)')
  })
})
