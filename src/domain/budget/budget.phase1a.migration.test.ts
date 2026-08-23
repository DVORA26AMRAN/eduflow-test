import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821120000_budget_phase1a_configuration_schema.sql',
)
const migrationSql = readFileSync(migrationPath, 'utf8')

describe('budget Phase 1A — configuration schema migration', () => {
  it('creates the three configuration tables', () => {
    expect(migrationSql).toContain('CREATE TABLE public.budget_periods')
    expect(migrationSql).toContain('CREATE TABLE public.budget_funding_sources')
    expect(migrationSql).toContain('CREATE TABLE public.budget_categories')
  })

  it('uses BIGINT authorized_amount_minor with positive and cap checks', () => {
    expect(migrationSql).toContain('authorized_amount_minor BIGINT')
    expect(migrationSql).toContain('authorized_amount_minor > 0')
    expect(migrationSql).toContain('authorized_amount_minor <= 9999999999999')
    expect(migrationSql).not.toMatch(/authorized_amount_minor\s+NUMERIC/i)
    expect(migrationSql).not.toMatch(/authorized_amount_minor\s+DOUBLE/i)
    expect(migrationSql).not.toMatch(/authorized_amount_minor\s+REAL/i)
    expect(migrationSql).not.toMatch(/authorized_amount_minor\s+FLOAT/i)
  })

  it('constrains budget period status and one active period per institution', () => {
    expect(migrationSql).toContain("status IN ('draft', 'active', 'closed')")
    expect(migrationSql).toContain('idx_budget_periods_one_active_per_institution')
    expect(migrationSql).toContain("WHERE status = 'active'")
    expect(migrationSql).toContain('UNIQUE (institution_id, name)')
  })

  it('enforces draft lifecycle shape with no activation or close metadata', () => {
    expect(migrationSql).toContain('budget_periods_lifecycle_valid')
    expect(migrationSql).toMatch(
      /status = 'draft'[\s\S]*activated_at IS NULL[\s\S]*activated_by_user_id IS NULL[\s\S]*closed_at IS NULL[\s\S]*closed_by_user_id IS NULL/,
    )
  })

  it('enforces active lifecycle shape with activation and without close metadata', () => {
    expect(migrationSql).toMatch(
      /status = 'active'[\s\S]*activated_at IS NOT NULL[\s\S]*activated_by_user_id IS NOT NULL[\s\S]*closed_at IS NULL[\s\S]*closed_by_user_id IS NULL/,
    )
  })

  it('enforces closed lifecycle shape with activation, close metadata, and closed_at >= activated_at', () => {
    expect(migrationSql).toMatch(
      /status = 'closed'[\s\S]*activated_at IS NOT NULL[\s\S]*activated_by_user_id IS NOT NULL[\s\S]*closed_at IS NOT NULL[\s\S]*closed_by_user_id IS NOT NULL[\s\S]*closed_at >= activated_at/,
    )
  })

  it('rejects impossible period lifecycle combinations via a single lifecycle CHECK', () => {
    // Draft cannot carry activation or close metadata (only the draft branch allows all-null).
    expect(migrationSql).toContain("status = 'draft'")
    expect(migrationSql).toContain('activated_at IS NULL')
    // Active requires activation and forbids close metadata.
    expect(migrationSql).toContain("status = 'active'")
    expect(migrationSql).toContain('activated_at IS NOT NULL')
    // Closed requires both activation and close metadata.
    expect(migrationSql).toContain("status = 'closed'")
    expect(migrationSql).toContain('closed_at IS NOT NULL')
    // Replaces the weaker pair-only CHECKs.
    expect(migrationSql).not.toContain('budget_periods_activation_fields_paired')
    expect(migrationSql).not.toContain('budget_periods_closed_fields_paired')
  })

  it('enforces funding source tenant consistency with composite FK to budget_periods', () => {
    expect(migrationSql).toContain('budget_funding_sources_period_institution_fk')
    expect(migrationSql).toContain(
      'FOREIGN KEY (budget_period_id, institution_id)',
    )
    expect(migrationSql).toContain('REFERENCES public.budget_periods (id, institution_id)')
  })

  it('enforces category scope with composite FKs to period and funding source', () => {
    expect(migrationSql).toContain('budget_categories_period_institution_fk')
    expect(migrationSql).toContain('budget_categories_funding_source_scope_fk')
    expect(migrationSql).toContain(
      'FOREIGN KEY (funding_source_id, budget_period_id, institution_id)',
    )
    expect(migrationSql).toContain('budget_categories_parent_institution_fk')
  })

  it('enforces maximum hierarchy depth of two via trigger', () => {
    expect(migrationSql).toContain('enforce_budget_category_hierarchy')
    expect(migrationSql).toContain('Budget category hierarchy cannot exceed two levels')
    expect(migrationSql).toContain(
      'Child category must match parent institution, period, and funding source',
    )
  })

  it('fixes hierarchy trigger search_path and revokes client EXECUTE', () => {
    const hierarchyFnMatch = migrationSql.match(
      /CREATE OR REPLACE FUNCTION public\.enforce_budget_category_hierarchy\(\)[\s\S]*?\$\$;/,
    )
    expect(hierarchyFnMatch?.[0]).toBeTruthy()
    expect(hierarchyFnMatch?.[0]).toContain('SET search_path = public')
    expect(hierarchyFnMatch?.[0]).not.toContain('SECURITY DEFINER')

    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM PUBLIC',
    )
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM anon',
    )
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM authenticated',
    )
  })

  it('documents deferred P1C leaf-stability constraint', () => {
    expect(migrationSql).toContain('P1C will add budget_allocations')
    expect(migrationSql).toContain('leaf-stability')
    expect(migrationSql).toContain('budget_structure_locked')
  })

  it('defines active-name uniqueness for funding sources and both category levels', () => {
    expect(migrationSql).toContain('idx_budget_funding_sources_active_name_per_period')
    expect(migrationSql).toContain('idx_budget_categories_active_level1_name')
    expect(migrationSql).toContain('idx_budget_categories_active_level2_name')
  })

  it('uses shared set_updated_at triggers on mutable configuration tables', () => {
    expect(migrationSql).toContain('budget_periods_set_updated_at')
    expect(migrationSql).toContain('budget_funding_sources_set_updated_at')
    expect(migrationSql).toContain('budget_categories_set_updated_at')
    expect(migrationSql).toContain('EXECUTE PROCEDURE public.set_updated_at()')
    expect(migrationSql).not.toMatch(
      /REVOKE ALL ON FUNCTION public\.set_updated_at/,
    )
    expect(migrationSql).not.toMatch(
      /GRANT .* ON FUNCTION public\.set_updated_at/,
    )
  })

  it('enables RLS and fails closed with no authenticated or anon access', () => {
    expect(migrationSql).toContain('ALTER TABLE public.budget_periods ENABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain(
      'ALTER TABLE public.budget_funding_sources ENABLE ROW LEVEL SECURITY',
    )
    expect(migrationSql).toContain('ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY')

    for (const table of [
      'public.budget_periods',
      'public.budget_funding_sources',
      'public.budget_categories',
    ]) {
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM anon`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM authenticated`)
    }

    expect(migrationSql).not.toMatch(
      /CREATE POLICY[\s\S]*ON public\.budget_(periods|funding_sources|categories)/,
    )
    expect(migrationSql).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|SELECT).*ON public\.budget_/,
    )
  })

  it('uses ON DELETE RESTRICT for configuration relationships', () => {
    const restrictCount = (migrationSql.match(/ON DELETE RESTRICT/g) ?? []).length
    expect(restrictCount).toBeGreaterThanOrEqual(8)
    expect(migrationSql).not.toContain('ON DELETE CASCADE')
  })

  it('does not implement P1B/P1C/P1D scope', () => {
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_allocations/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_ledger_entries/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_transfers/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_financial_operations/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_institution_grants/)
    expect(migrationSql).not.toContain('CREATE OR REPLACE FUNCTION public.budget_user_has_capability')
    expect(migrationSql).not.toContain('enable_budget_management_for_institution')
    expect(migrationSql).not.toContain('transfer_budget_amount')
    expect(migrationSql).not.toContain('set_initial_budget_allocation')
  })

  it('does not touch public.requests or Phase 3 quotation work', () => {
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.school_registration_quotations/)
    expect(migrationSql).not.toMatch(/quotation_pdf/)
  })
})
