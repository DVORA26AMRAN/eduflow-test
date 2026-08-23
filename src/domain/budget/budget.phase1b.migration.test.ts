import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821121000_budget_phase1b_permission_foundation.sql',
)
const p1aMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821120000_budget_phase1a_configuration_schema.sql',
)
const migrationSql = readFileSync(migrationPath, 'utf8')
const p1aMigrationSql = readFileSync(p1aMigrationPath, 'utf8')

const BUDGET_CAPABILITY_KEYS = [
  'budget.view',
  'budget.manage_structure',
  'budget.allocate_funds',
  'budget.transfer_funds',
  'budget.activate_period',
  'budget.close_period',
  'budget.approve_request',
  'budget.verify_invoice',
  'budget.cancel_commitment',
  'budget.prepare_report',
  'budget.approve_report',
  'budget.submit_report',
  'budget.manage_settings',
] as const

describe('budget Phase 1B — permission foundation migration', () => {
  it('documents compatibility decision against legacy capabilities tables', () => {
    expect(migrationSql).toContain('public.capabilities')
    expect(migrationSql).toContain('public.user_capabilities')
    expect(migrationSql).toContain('budget_capabilities')
    expect(migrationSql).toContain('budget_user_grants')
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.capabilities/)
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.user_capabilities/)
    expect(migrationSql).not.toMatch(/INSERT INTO public\.capabilities/)
    expect(migrationSql).not.toMatch(/INSERT INTO public\.user_capabilities/)
  })

  it('creates capability catalogue, grants, enablement, and audit tables', () => {
    expect(migrationSql).toContain('CREATE TABLE public.budget_capabilities')
    expect(migrationSql).toContain('CREATE TABLE public.budget_user_grants')
    expect(migrationSql).toContain('CREATE TABLE public.budget_institution_enablement')
    expect(migrationSql).toContain('CREATE TABLE public.budget_permission_audit_events')
  })

  it('seeds all Budget capability identifiers uniquely and stably', () => {
    for (const capability of BUDGET_CAPABILITY_KEYS) {
      expect(migrationSql).toContain(`('${capability}',`)
    }

    const seedSection = migrationSql.slice(
      migrationSql.indexOf('INSERT INTO public.budget_capabilities'),
      migrationSql.indexOf('ON CONFLICT (capability_key) DO NOTHING') + 'ON CONFLICT (capability_key) DO NOTHING'.length,
    )

    for (const capability of BUDGET_CAPABILITY_KEYS) {
      expect(seedSection.match(new RegExp(`'${capability.replace('.', '\\.')}'`, 'g'))).toHaveLength(1)
    }
  })

  it('defines institution-scoped grants with duplicate prevention and tenant trigger', () => {
    expect(migrationSql).toContain('budget_user_grants_institution_user_capability_unique')
    expect(migrationSql).toContain('UNIQUE (institution_id, user_id, capability_key)')
    expect(migrationSql).toContain('enforce_budget_user_grant_scope')
    expect(migrationSql).toContain('Budget grant user must belong to the grant institution')
  })

  it('implements bootstrap for active institution managers only', () => {
    expect(migrationSql).toContain('enable_budget_management_for_institution')
    expect(migrationSql).toMatch(
      /enable_budget_management_for_institution[\s\S]*primary_role <> 'institution_manager'/,
    )
    expect(migrationSql).toMatch(
      /enable_budget_management_for_institution[\s\S]*FOR UPDATE[\s\S]*budget_institution_enablement/,
    )
    expect(migrationSql).toContain("'already_enabled', true")
    expect(migrationSql).not.toMatch(
      /enable_budget_management_for_institution[\s\S]*platform_admin/,
    )
  })

  it('implements fail-closed capability check helper without caller-supplied user id', () => {
    expect(migrationSql).toContain('budget_user_has_capability')
    expect(migrationSql).toMatch(
      /budget_user_has_capability[\s\S]*u\.id = auth\.uid\(\)/,
    )
    expect(migrationSql).not.toMatch(
      /budget_user_has_capability\(\s*p_user_id/,
    )
    expect(migrationSql).toMatch(
      /budget_user_has_capability[\s\S]*budget_is_valid_capability\(p_capability\)/,
    )
    expect(migrationSql).toMatch(
      /budget_user_has_capability[\s\S]*budget_institution_is_enabled\(p_institution_id\)/,
    )
    expect(migrationSql).toMatch(
      /budget_user_has_capability[\s\S]*u\.status = 'active'/,
    )
  })

  it('requires manage_settings for grant and revoke administration', () => {
    expect(migrationSql).toContain('grant_budget_capability')
    expect(migrationSql).toContain('revoke_budget_capability')
    expect(migrationSql).toMatch(
      /grant_budget_capability[\s\S]*budget_user_has_capability\([\s\S]*'budget\.manage_settings'/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*budget_user_has_capability\([\s\S]*'budget\.manage_settings'/,
    )
  })

  it('enforces last manage_settings administrator protection on revoke', () => {
    expect(migrationSql).toContain('budget_count_active_manage_settings_holders')
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*budget_last_admin_required/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*v_capability = 'budget\.manage_settings'/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*v_target_has_grant[\s\S]*g\.user_id <> p_target_user_id/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*u\.status = 'active'/,
    )
    expect(migrationSql).not.toMatch(
      /revoke_budget_capability[\s\S]*v_target_user\.status = 'active'[\s\S]*budget_count_active_manage_settings_holders/,
    )
  })

  it('documents grant/revoke idempotency key as audit correlation only', () => {
    expect(migrationSql).toMatch(
      /grant_budget_capability[\s\S]*p_idempotency_key is audit correlation metadata only/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*p_idempotency_key is audit correlation metadata only/,
    )
    expect(migrationSql).toContain(
      'UNIQUE (institution_id, user_id, capability_key)',
    )
    expect(migrationSql).toMatch(
      /grant_budget_capability[\s\S]*duplicate', true/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*unchanged', true/,
    )
  })

  it('scopes bootstrap idempotency uniqueness to institution', () => {
    expect(migrationSql).toContain(
      'idx_budget_institution_enablement_institution_bootstrap_key',
    )
    expect(migrationSql).toContain(
      'ON public.budget_institution_enablement (institution_id, bootstrap_idempotency_key)',
    )
    expect(migrationSql).not.toMatch(
      /CREATE UNIQUE INDEX[\s\S]*budget_institution_enablement \(bootstrap_idempotency_key\)/,
    )
    expect(migrationSql).toMatch(
      /bootstrap_idempotency_key is unique per institution/,
    )
  })

  it('writes append-only permission audit events for bootstrap, grant, and revoke', () => {
    expect(migrationSql).toContain('budget_write_permission_audit')
    expect(migrationSql).toContain("action IN ('bootstrap', 'grant', 'revoke')")
    expect(migrationSql).toContain('budget_permission_audit_reject_mutation')
    expect(migrationSql).toContain('budget_permission_audit_no_update')
    expect(migrationSql).toContain('budget_permission_audit_no_delete')
    expect(migrationSql).not.toContain('budget_ledger_entries')
  })

  it('introduces P1A SELECT policies gated by budget.view capability helper', () => {
    expect(migrationSql).toContain('GRANT SELECT ON TABLE public.budget_periods TO authenticated')
    expect(migrationSql).toContain('GRANT SELECT ON TABLE public.budget_funding_sources TO authenticated')
    expect(migrationSql).toContain('GRANT SELECT ON TABLE public.budget_categories TO authenticated')
    expect(migrationSql).toContain('budget_periods_select_view')
    expect(migrationSql).toContain('budget_funding_sources_select_view')
    expect(migrationSql).toContain('budget_categories_select_view')
    expect(migrationSql).toMatch(
      /budget_periods_select_view[\s\S]*budget_user_has_capability\(institution_id, 'budget\.view'\)/,
    )
  })

  it('keeps permission tables fail-closed with no authenticated direct access', () => {
    for (const table of [
      'public.budget_capabilities',
      'public.budget_institution_enablement',
      'public.budget_user_grants',
      'public.budget_permission_audit_events',
    ]) {
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM anon`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM authenticated`)
    }

    expect(migrationSql).not.toMatch(
      /CREATE POLICY[\s\S]*ON public\.budget_(capabilities|institution_enablement|user_grants|permission_audit_events)/,
    )
  })

  it('does not grant authenticated mutation on P1A configuration tables', () => {
    expect(migrationSql).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE).*ON public\.budget_(periods|funding_sources|categories)/,
    )
  })

  it('uses fixed search_path and revokes client EXECUTE on SECURITY DEFINER helpers', () => {
    const definerFunctions = [
      'budget_institution_is_enabled',
      'budget_count_active_manage_settings_holders',
      'budget_user_has_capability',
      'budget_write_permission_audit',
      'enable_budget_management_for_institution',
      'grant_budget_capability',
      'revoke_budget_capability',
    ]

    for (const fn of definerFunctions) {
      expect(migrationSql).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*SECURITY DEFINER[\\s\\S]*SET search_path = public`),
      )
      expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
    }

    expect(migrationSql).toMatch(
      /enforce_budget_user_grant_scope[\s\S]*SET search_path = public/,
    )
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_budget_user_grant_scope() FROM authenticated',
    )
  })

  const budgetFunctions = [
    'budget_fail(TEXT)',
    'budget_is_valid_capability(TEXT)',
    'budget_institution_is_enabled(UUID)',
    'budget_count_active_manage_settings_holders(UUID)',
    'budget_user_has_capability(UUID, TEXT)',
    'budget_write_permission_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB)',
    'enable_budget_management_for_institution(TEXT)',
    'grant_budget_capability(UUID, TEXT, TEXT)',
    'revoke_budget_capability(UUID, TEXT, TEXT)',
    'enforce_budget_user_grant_scope()',
  ] as const

  const clientExecutableFunctions = [
    'budget_user_has_capability(UUID, TEXT)',
    'enable_budget_management_for_institution(TEXT)',
    'grant_budget_capability(UUID, TEXT, TEXT)',
    'revoke_budget_capability(UUID, TEXT, TEXT)',
  ] as const

  const internalOnlyFunctions = [
    'budget_fail(TEXT)',
    'budget_is_valid_capability(TEXT)',
    'budget_institution_is_enabled(UUID)',
    'budget_count_active_manage_settings_holders(UUID)',
    'budget_write_permission_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB)',
    'enforce_budget_user_grant_scope()',
  ] as const

  it('denies PUBLIC and anon EXECUTE on all Budget functions', () => {
    for (const fn of budgetFunctions) {
      expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`)
      expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon`)
    }
  })

  it('denies authenticated EXECUTE on internal Budget helpers only', () => {
    for (const fn of internalOnlyFunctions) {
      expect(migrationSql).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM authenticated`,
      )
      expect(migrationSql).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} TO authenticated`,
        ),
      )
    }
  })

  it('grants authenticated EXECUTE only on application contract RPCs', () => {
    for (const fn of clientExecutableFunctions) {
      expect(migrationSql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`,
      )
    }

    for (const fn of internalOnlyFunctions) {
      expect(migrationSql).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} TO authenticated`,
        ),
      )
    }
  })

  it('documents the final P1B function EXECUTE security matrix', () => {
    expect(migrationSql).toContain('P1B function EXECUTE security matrix (N1)')
    expect(migrationSql).toContain('budget_fail(TEXT)')
    expect(migrationSql).toContain('budget_is_valid_capability(TEXT)')
    expect(migrationSql).toContain('budget_institution_is_enabled(UUID)')
    expect(migrationSql).toContain('budget_count_active_manage_settings_holders(UUID)')
    expect(migrationSql).toContain('budget_write_permission_audit(...)')
    expect(migrationSql).toContain('enforce_budget_user_grant_scope()')
    expect(migrationSql).toContain('budget_user_has_capability(UUID, TEXT)')
    expect(migrationSql).toContain('All Budget functions: PUBLIC = NO, anon = NO')
  })

  it('defines stable domain error codes', () => {
    for (const code of [
      'budget_permission_denied',
      'budget_management_not_enabled',
      'budget_invalid_capability',
      'budget_target_user_invalid',
      'budget_last_admin_required',
      'budget_duplicate_operation',
    ]) {
      expect(migrationSql).toContain(`'${code}'`)
    }
  })

  it('uses institution row locking for bootstrap and grant concurrency without SKIP LOCKED', () => {
    expect(migrationSql).toMatch(
      /enable_budget_management_for_institution[\s\S]*FROM public\.institutions[\s\S]*FOR UPDATE/,
    )
    expect(migrationSql).toMatch(
      /grant_budget_capability[\s\S]*FROM public\.institutions[\s\S]*FOR UPDATE/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*FROM public\.institutions[\s\S]*FOR UPDATE/,
    )
    expect(migrationSql).not.toContain('SKIP LOCKED')
    expect(migrationSql).toMatch(
      /enable_budget_management_for_institution[\s\S]*already_enabled', true/,
    )
    expect(migrationSql).toMatch(
      /enable_budget_management_for_institution[\s\S]*WHEN unique_violation/,
    )
  })

  it('counts only active users toward last-admin invariant', () => {
    expect(migrationSql).toMatch(
      /budget_count_active_manage_settings_holders[\s\S]*u\.status = 'active'/,
    )
    expect(migrationSql).toMatch(
      /revoke_budget_capability[\s\S]*manage_settings[\s\S]*u\.status = 'active'/,
    )
  })

  it('does not implement P1C/P1D financial scope', () => {
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_allocations/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_ledger_entries/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_transfers/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_financial_operations/)
    expect(migrationSql).not.toContain('transfer_budget_amount')
    expect(migrationSql).not.toContain('set_initial_budget_allocation')
  })

  it('does not edit P1A migration or touch requests / Phase 3', () => {
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.school_registration_quotations/)
    expect(migrationSql).not.toMatch(/quotation_pdf/)
    expect(p1aMigrationSql).toContain('CREATE TABLE public.budget_periods')
  })
})
