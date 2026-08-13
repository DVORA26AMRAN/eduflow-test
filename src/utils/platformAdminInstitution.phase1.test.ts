import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250812180000_platform_admin_institution_management_phase1.sql',
)

const logoServicePath = resolve(process.cwd(), 'src/services/institutionLogo.ts')
const logoAuditMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250711103000_institution_logo_audit.sql',
)
const schoolsUiPath = resolve(
  process.cwd(),
  'src/components/platform/PlatformAdminSchoolsSection.tsx',
)
const institutionAdminServicePath = resolve(process.cwd(), 'src/services/institutionAdmin.ts')

function functionBody(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`
  const start = sql.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const nextCreate = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + marker.length)
  const nextRevoke = sql.indexOf('REVOKE ALL ON FUNCTION public.', start + marker.length)
  let end = sql.length
  if (nextCreate >= 0) {
    end = Math.min(end, nextCreate)
  }
  if (nextRevoke >= 0) {
    end = Math.min(end, nextRevoke)
  }
  return sql.slice(start, end)
}

describe('platform admin institution management phase 1', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const logoService = readFileSync(logoServicePath, 'utf8')
  const logoAuditOriginal = readFileSync(logoAuditMigrationPath, 'utf8')
  const schoolsUi = readFileSync(schoolsUiPath, 'utf8')
  const institutionAdminService = readFileSync(institutionAdminServicePath, 'utf8')

  it('adds metadata columns without inventing a second name field', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS institution_code TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS address TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS city TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS phone TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS email TEXT')
    expect(sql).not.toContain('school_name')
  })

  it('enforces unique institution_code server-side for non-empty values', () => {
    expect(sql).toContain('institutions_institution_code_unique_ci')
    expect(sql).toContain('lower(btrim(institution_code))')
  })

  it('revokes helper EXECUTE from PUBLIC, anon, and authenticated', () => {
    for (const helper of [
      'platform_admin_require_active()',
      'platform_admin_normalize_institution_code(TEXT)',
      'platform_admin_write_institution_audit(UUID, UUID, TEXT, JSONB)',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${helper} FROM PUBLIC`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${helper} FROM anon`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${helper} FROM authenticated`)
    }

    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.platform_admin_require_active\(\) TO authenticated/,
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.platform_admin_write_institution_audit/,
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.platform_admin_normalize_institution_code/,
    )
  })

  it('grants only the public admin RPCs to authenticated and not anon', () => {
    for (const rpc of [
      'platform_admin_list_institutions()',
      'platform_admin_get_institution(UUID)',
      'platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)',
      'platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${rpc} FROM PUBLIC`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${rpc} FROM anon`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${rpc} FROM authenticated`)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${rpc} TO authenticated`)
    }

    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.platform_admin_(list|get|create|update)_institution[^\n]* TO anon/,
    )
  })

  it('gates public RPCs on active platform_admin inside the function', () => {
    expect(sql).toContain("v_actor.primary_role <> 'platform_admin'")
    expect(sql).toContain("v_actor.status <> 'active'")
    expect(functionBody(sql, 'platform_admin_create_institution')).toContain(
      'platform_admin_require_active()',
    )
    expect(functionBody(sql, 'platform_admin_update_institution')).toContain(
      'platform_admin_require_active()',
    )
    expect(institutionAdminService).toContain("return 'אין הרשאה לבצע פעולה זו.'")
    expect(institutionAdminService).toContain("message.includes('permission denied')")
  })

  it('makes institution create/update audit mandatory and transactional', () => {
    const auditBody = functionBody(sql, 'platform_admin_write_institution_audit')
    expect(auditBody).toContain('Mandatory/transactional')
    expect(auditBody).not.toContain('EXCEPTION')
    expect(auditBody).not.toContain('institution audit skipped')

    const createBody = functionBody(sql, 'platform_admin_create_institution')
    const updateBody = functionBody(sql, 'platform_admin_update_institution')
    expect(createBody).toContain("platform_admin_write_institution_audit(")
    expect(createBody).toContain("'institution_created'")
    expect(updateBody).toContain("platform_admin_write_institution_audit(")
    expect(updateBody).toContain("'institution_updated'")
    expect(createBody.indexOf('INSERT INTO public.institutions')).toBeLessThan(
      createBody.indexOf('platform_admin_write_institution_audit'),
    )
    expect(updateBody.indexOf('UPDATE public.institutions')).toBeLessThan(
      updateBody.indexOf('platform_admin_write_institution_audit'),
    )
  })

  it('does not change logo audit swallow behavior from the existing logo workflow', () => {
    const logoAuditInPhase1 = functionBody(sql, 'write_institution_logo_audit_log')
    expect(logoAuditInPhase1).toContain('EXCEPTION')
    expect(logoAuditInPhase1).toContain('institution logo audit skipped')
    expect(logoAuditOriginal).toContain('EXCEPTION')
    expect(schoolsUi).toContain('uploadInstitutionLogo')
    expect(schoolsUi).toContain('removeInstitutionLogo')
    expect(logoService).toContain('INSTITUTION_LOGOS_BUCKET')
  })

  it('keeps SECURITY DEFINER search_path and does not move users', () => {
    expect(sql).toContain('SET search_path = public')
    expect(sql).toContain('Never touch users.institution_id or logo_url here')
    expect(sql).not.toContain('UPDATE public.users')
  })

  it('leaves legacy rows readable by allowing nullable new contact fields', () => {
    expect(sql).toContain('Legacy rows may be NULL until edited')
    expect(sql).toContain("WHERE institution_code IS NOT NULL AND btrim(institution_code) <> ''")
  })
})
