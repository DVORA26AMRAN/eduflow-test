import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const alignmentPath = resolve(
  process.cwd(),
  'supabase/migrations/20250812220000_platform_admin_global_baseline_alignment.sql',
)

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

describe('platform admin global baseline alignment', () => {
  const alignment = readFileSync(alignmentPath, 'utf8')

  it('is the forward source of truth after historical July/Phase 1 migrations', () => {
    expect(alignment).toContain('20250711101000_platform_admin_institution_logo_policies.sql')
    expect(alignment).toContain('20250711102000_institution_logos_storage.sql')
    expect(alignment).toContain('20250812180000_platform_admin_institution_management_phase1.sql')
    expect(alignment).toContain('Safe to apply on:')
  })

  it('ensures user_role includes all four PrimaryRole values idempotently', () => {
    expect(alignment).toContain("ADD VALUE IF NOT EXISTS 'institution_manager'")
    expect(alignment).toContain("ADD VALUE IF NOT EXISTS 'secretary'")
    expect(alignment).toContain("ADD VALUE IF NOT EXISTS 'teacher'")
    expect(alignment).toContain("ADD VALUE IF NOT EXISTS 'platform_admin'")
  })

  it('enforces platform_admin global vs tenant institution_id CHECK', () => {
    expect(alignment).toContain('ALTER COLUMN institution_id DROP NOT NULL')
    expect(alignment).toContain('users_institution_id_role_consistency')
    expect(alignment).toContain("primary_role = 'platform_admin'::public.user_role")
    expect(alignment).toContain('AND institution_id IS NULL')
    expect(alignment).toContain("primary_role <> 'platform_admin'::public.user_role")
    expect(alignment).toContain('AND institution_id IS NOT NULL')
  })

  it('requires global platform_admin in auth helper and Phase 1 gate', () => {
    const helper = functionBody(alignment, 'auth_user_is_active_platform_admin')
    expect(helper).toContain("u.primary_role = 'platform_admin'")
    expect(helper).toContain("u.status = 'active'")
    expect(helper).toContain('u.institution_id IS NULL')

    const requireActive = functionBody(alignment, 'platform_admin_require_active')
    expect(requireActive).toContain("v_actor.primary_role <> 'platform_admin'")
    expect(requireActive).toContain("v_actor.status <> 'active'")
    expect(requireActive).toContain('v_actor.institution_id IS NOT NULL')
    expect(alignment).toContain(
      'REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM authenticated',
    )
  })

  it('scopes Storage writes to institution-logos for platform_admin only', () => {
    expect(alignment).toContain("VALUES ('institution-logos', 'institution-logos', true)")
    expect(alignment).toContain('ON CONFLICT (id) DO UPDATE')
    expect(alignment).toContain('SET public = EXCLUDED.public')

    for (const policy of [
      'institution_logos_storage_platform_admin_insert',
      'institution_logos_storage_platform_admin_update',
      'institution_logos_storage_platform_admin_delete',
      'institution_logos_storage_authenticated_select',
    ]) {
      expect(alignment).toContain(`DROP POLICY IF EXISTS ${policy} ON storage.objects`)
      expect(alignment).toContain(policy)
    }

    expect(alignment).toContain("bucket_id = 'institution-logos'")
    expect(alignment).toContain('auth_user_is_active_platform_admin()')
    expect(alignment).not.toContain('request-attachments')
    expect(alignment).not.toContain('printing')
  })

  it('preserves narrow institutions logo UPDATE grant and policies', () => {
    expect(alignment).toContain('ADD COLUMN IF NOT EXISTS logo_url TEXT')
    expect(alignment).toContain('ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ')
    expect(alignment).toContain(
      'GRANT UPDATE (logo_url, logo_updated_at) ON public.institutions TO authenticated',
    )
    expect(alignment).toContain('institutions_platform_admin_select_all')
    expect(alignment).toContain('institutions_platform_admin_update_logo')
    expect(alignment).not.toMatch(/GRANT UPDATE\s+ON public\.institutions TO authenticated/)
    expect(alignment).not.toMatch(
      /CREATE POLICY institutions_platform_admin_[^\n]*\n\s*ON public\.institutions\n\s*FOR INSERT/,
    )
    expect(alignment).not.toMatch(
      /CREATE POLICY institutions_platform_admin_[^\n]*\n\s*ON public\.institutions\n\s*FOR DELETE/,
    )
  })

  it('uses idempotent policy recreation safe for already-fixed live DB', () => {
    expect(alignment).toContain('DROP POLICY IF EXISTS institutions_platform_admin_select_all')
    expect(alignment).toContain('DROP POLICY IF EXISTS institutions_platform_admin_update_logo')
    expect(alignment).toContain('DROP CONSTRAINT IF EXISTS users_institution_id_role_consistency')
    expect(alignment).toContain('ADD VALUE IF NOT EXISTS')
    expect(alignment).toContain('CREATE OR REPLACE FUNCTION public.auth_user_is_active_platform_admin')
    expect(alignment).toContain('CREATE OR REPLACE FUNCTION public.platform_admin_require_active')
  })
})
