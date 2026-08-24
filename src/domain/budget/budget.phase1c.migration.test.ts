import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821122000_budget_phase1c_ledger_foundation.sql',
)
const p1aPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821120000_budget_phase1a_configuration_schema.sql',
)
const p1bPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821121000_budget_phase1b_permission_foundation.sql',
)

const migrationSql = readFileSync(migrationPath, 'utf8')
const p1aSql = readFileSync(p1aPath, 'utf8')
const p1bSql = readFileSync(p1bPath, 'utf8')

describe('budget Phase 1C — money standard', () => {
  it('uses BIGINT minor units with overflow-safe range validation and rejects float/numeric money', () => {
    expect(migrationSql).toContain('amount_minor            BIGINT')
    expect(migrationSql).toContain(
      'amount_minor BETWEEN -9999999999999 AND 9999999999999',
    )
    expect(migrationSql).toContain('budget_money_business_cap')
    expect(migrationSql).toContain('9999999999999::BIGINT')
    expect(migrationSql).not.toMatch(/\babs\s*\(\s*amount_minor\s*\)/i)
    expect(migrationSql).not.toMatch(/\babs\s*\(\s*p_delta_minor\s*\)/i)
    expect(migrationSql).not.toMatch(/amount_minor\s+(NUMERIC|DOUBLE|REAL|FLOAT)/i)
    expect(migrationSql).not.toMatch(/authorized_amount_minor\s+(NUMERIC|DOUBLE|REAL|FLOAT)/i)
  })
})

describe('budget Phase 1C — N1 archived structure fail-closed', () => {
  it('requires active category and funding source for set_initial_budget_allocation', () => {
    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    expect(initialFn).toMatch(/v_category\.status\s*<>\s*'active'/)
    expect(initialFn).toMatch(/v_source\.status\s*<>\s*'active'/)
    expect(initialFn).toMatch(
      /IF v_category\.status <> 'active'[\s\S]*budget_structure_locked/,
    )
    expect(initialFn).toMatch(
      /IF v_source\.status <> 'active'[\s\S]*budget_structure_locked/,
    )
  })

  it('blocks all adjust_budget_allocation deltas when category or source is archived', () => {
    const adjustFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
    )
    expect(adjustFn).toMatch(/v_category\.status\s*<>\s*'active'/)
    expect(adjustFn).toMatch(/v_source\.status\s*<>\s*'active'/)
    expect(adjustFn).toMatch(/budget_structure_locked/)
    expect(adjustFn).toMatch(
      /v_category\.status\s*<>\s*'active'\s*OR\s*v_source\.status\s*<>\s*'active'/,
    )
  })

  it('denies initial allocation against archived category or source before reserve checks', () => {
    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    const archivedCategoryGuard = initialFn.indexOf("IF v_category.status <> 'active'")
    const archivedSourceGuard = initialFn.indexOf("IF v_source.status <> 'active'")
    const reserveCheck = initialFn.indexOf('budget_funding_source_reserve_minor')

    expect(archivedCategoryGuard).toBeGreaterThan(-1)
    expect(archivedSourceGuard).toBeGreaterThan(-1)
    expect(archivedCategoryGuard).toBeLessThan(reserveCheck)
    expect(archivedSourceGuard).toBeLessThan(reserveCheck)
  })

  it('denies positive and negative adjustments when category or source is archived', () => {
    const adjustFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
    )
    const archivedGuard = adjustFn.indexOf(
      "IF v_category.status <> 'active' OR v_source.status <> 'active'",
    )
    const positiveBranch = adjustFn.indexOf('IF p_delta_minor > 0 THEN')
    const negativeBranch = adjustFn.indexOf('IF (v_current + p_delta_minor) < 0 THEN')

    expect(archivedGuard).toBeGreaterThan(-1)
    expect(archivedGuard).toBeLessThan(positiveBranch)
    expect(archivedGuard).toBeLessThan(negativeBranch)
  })

  it('keeps historical balances readable via internal views after structure archival', () => {
    expect(migrationSql).toContain('budget_allocation_balances_v')
    expect(migrationSql).toContain('budget_funding_source_balances_v')
    expect(migrationSql).toContain('current_budget_authority_minor')
    expect(migrationSql).not.toMatch(
      /adjust_budget_allocation[\s\S]*DELETE FROM public\.budget_ledger_entries/,
    )
    expect(migrationSql).not.toMatch(
      /set_initial_budget_allocation[\s\S]*DELETE FROM public\.budget_ledger_entries/,
    )
  })
})

describe('budget Phase 1C — N1 overflow-safe money validation', () => {
  const BIGINT_MIN = '-9223372036854775808'
  const BIGINT_MAX = '9223372036854775807'

  it('validates adjust delta with direct range checks and no ABS()', () => {
    const adjustFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
    )
    expect(adjustFn).toMatch(/p_delta_minor\s*<\s*-9999999999999/)
    expect(adjustFn).toMatch(
      /p_delta_minor\s*>\s*public\.budget_money_business_cap\(\)/,
    )
    expect(adjustFn).not.toMatch(/\babs\s*\(\s*p_delta_minor\s*\)/i)
  })

  it('maps initial and delta out-of-range values to budget_invalid_amount', () => {
    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    expect(initialFn).toMatch(/p_amount_minor\s*<=\s*0/)
    expect(initialFn).toMatch(
      /p_amount_minor\s*>\s*public\.budget_money_business_cap\(\)/,
    )
    expect(initialFn).toMatch(/budget_invalid_amount/)
    expect(initialFn).not.toMatch(/\babs\s*\(\s*p_amount_minor\s*\)/i)

    const adjustFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
    )
    expect(adjustFn).toMatch(/budget_invalid_amount/)
  })

  it('documents BIGINT min/max contract rejection without ABS overflow', () => {
    expect(BIGINT_MIN).toBe('-9223372036854775808')
    expect(BIGINT_MAX).toBe('9223372036854775807')
    expect(BigInt(BIGINT_MIN) <= 0n).toBe(true)
    expect(BigInt(BIGINT_MAX) > 9999999999999n).toBe(true)

    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    const adjustFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
    )

    expect(initialFn).not.toMatch(/\babs\s*\(/i)
    expect(adjustFn).not.toMatch(/\babs\s*\(\s*p_delta_minor\s*\)/i)
    expect(migrationSql).not.toMatch(/\babs\s*\(\s*amount_minor\s*\)/i)
  })
})

describe('budget Phase 1C — N1 allocation identity race', () => {
  it('wraps allocation INSERT in a narrow unique_violation handler keyed to period+category', () => {
    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    const allocationInsertBlock = initialFn.slice(
      initialFn.indexOf('IF v_allocation.id IS NULL THEN'),
      initialFn.indexOf('BEGIN\n        INSERT INTO public.budget_financial_operations'),
    )

    expect(allocationInsertBlock).toContain('WHEN unique_violation THEN')
    expect(allocationInsertBlock).toContain('GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME')
    expect(allocationInsertBlock).toContain(
      "v_constraint IS DISTINCT FROM 'budget_allocations_period_category_unique'",
    )
    expect(allocationInsertBlock).toContain('RAISE')
    expect(allocationInsertBlock).toContain('budget_initial_allocation_exists')
    expect(allocationInsertBlock).toMatch(/FOR UPDATE[\s\S]*budget_initial_allocation_exists/)
  })

  it('does not use a function-level unique_violation handler', () => {
    const initialFn = migrationSql.slice(
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
      migrationSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
    )
    expect(initialFn.match(/WHEN unique_violation THEN/g)).toHaveLength(3)
    expect(initialFn).toMatch(
      /v_constraint IS DISTINCT FROM 'budget_allocations_period_category_unique'[\s\S]*RAISE/,
    )
  })
})

describe('budget Phase 1C — N1 stable error contract', () => {
  it('returns only approved stable budget error codes without SQLERRM leakage', () => {
    for (const code of [
      'budget_structure_locked',
      'budget_invalid_amount',
      'budget_initial_allocation_exists',
      'budget_duplicate_operation',
      'budget_insufficient_available',
      'budget_not_found',
      'budget_permission_denied',
    ]) {
      expect(migrationSql).toContain(`'${code}'`)
    }
    expect(migrationSql).not.toMatch(/SQLERRM/i)
    expect(migrationSql).not.toMatch(
      /budget_fail\([^)]*budget_allocations_period_category_unique/,
    )
    expect(migrationSql).not.toMatch(
      /jsonb_build_object\([^)]*budget_allocations_period_category_unique/,
    )
  })
})

describe('budget Phase 1C — allocation schema', () => {
  it('creates allocation identity without money columns', () => {
    expect(migrationSql).toContain('CREATE TABLE public.budget_allocations')
    expect(migrationSql).toContain('UNIQUE (budget_period_id, category_id)')
    expect(migrationSql).toContain('budget_allocations_period_category_unique')
    expect(migrationSql).toContain('idx_budget_allocations_budget_period_id')
    expect(migrationSql).toContain('idx_budget_allocations_funding_source_id')
    expect(migrationSql).toContain('idx_budget_allocations_category_id')
    expect(migrationSql).toMatch(
      /CREATE TABLE public\.budget_allocations[\s\S]*?funding_source_id/,
    )
    const allocationTable = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE public.budget_allocations'),
      migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_budget_allocation_scope'),
    )
    expect(allocationTable).not.toMatch(/amount_minor/)
  })

  it('enforces leaf category and tenant/source/period consistency', () => {
    expect(migrationSql).toContain('enforce_budget_allocation_scope')
    expect(migrationSql).toContain('budget_category_is_leaf')
    expect(migrationSql).toContain('budget_allocations_funding_source_scope_fk')
    expect(migrationSql).toContain('budget_allocations_period_institution_fk')
  })

  it('locks parent categories with allocation or ledger history from gaining children', () => {
    expect(migrationSql).toContain('budget_structure_locked')
    expect(migrationSql).toMatch(
      /enforce_budget_category_hierarchy[\s\S]*budget_allocations[\s\S]*budget_ledger_entries/,
    )
  })
})

describe('budget Phase 1C — operations and ledger', () => {
  it('creates immutable financial operations with fingerprint constraints', () => {
    expect(migrationSql).toContain('CREATE TABLE public.budget_financial_operations')
    expect(migrationSql).toContain("operation_type IN ('initial_allocation', 'allocation_adjustment')")
    expect(migrationSql).toContain('UNIQUE (institution_id, idempotency_key)')
    expect(migrationSql).toContain("request_fingerprint ~ '^[0-9a-f]{64}$'")
    expect(migrationSql).toContain('char_length(idempotency_key) <= 128')
    expect(migrationSql).toContain('budget_financial_operations is append-only')
  })

  it('creates append-only ledger with budget_authority P1C events only', () => {
    expect(migrationSql).toContain('CREATE TABLE public.budget_ledger_entries')
    expect(migrationSql).toMatch(/financial_dimension\s+TEXT\s+NOT NULL/)
    expect(migrationSql).toContain(
      "financial_dimension IN ('budget_authority', 'commitment', 'actual_expense')",
    )
    expect(migrationSql).toContain("event_type IN ('initial_allocation', 'allocation_adjustment')")
    expect(migrationSql).toContain('amount_minor <> 0')
    expect(migrationSql).toContain('budget_ledger_entries is append-only')
    expect(migrationSql).toContain('idx_budget_ledger_one_initial_per_allocation')
    expect(migrationSql).not.toContain('transfer_in')
    expect(migrationSql).not.toContain('transfer_out')
    expect(migrationSql).not.toContain('transfer_budget_amount')
  })

  it('enforces operation/allocation scope consistency on ledger insert', () => {
    expect(migrationSql).toContain('enforce_budget_ledger_operation_scope')
    expect(migrationSql).toContain('budget_ledger_entries_allocation_scope_fk')
  })
})

describe('budget Phase 1C — initial and adjustment RPCs', () => {
  it('implements set_initial_budget_allocation with draft-only and once-per-allocation rules', () => {
    expect(migrationSql).toContain('set_initial_budget_allocation')
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*budget\.allocate_funds/,
    )
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*budget_period_not_draft/,
    )
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*budget_initial_allocation_exists/,
    )
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*event_type[\s\S]*'initial_allocation'/,
    )
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*financial_dimension[\s\S]*'budget_authority'/,
    )
  })

  it('implements adjust_budget_allocation with reason, reserve, and floor checks', () => {
    expect(migrationSql).toContain('adjust_budget_allocation')
    expect(migrationSql).toMatch(
      /adjust_budget_allocation[\s\S]*budget\.allocate_funds/,
    )
    expect(migrationSql).toMatch(
      /adjust_budget_allocation[\s\S]*budget_period_closed/,
    )
    expect(migrationSql).toMatch(
      /adjust_budget_allocation[\s\S]*budget_insufficient_available/,
    )
    expect(migrationSql).toMatch(
      /adjust_budget_allocation[\s\S]*'allocation_adjustment'/,
    )
    expect(migrationSql).toMatch(
      /COMMENT ON FUNCTION public\.adjust_budget_allocation[\s\S]*budget\.allocate_funds/,
    )
  })

  it('generates server-side fingerprints and does not accept client fingerprints', () => {
    expect(migrationSql).toContain('budget_fingerprint_initial_allocation')
    expect(migrationSql).toContain('budget_fingerprint_allocation_adjustment')
    expect(migrationSql).toContain('budget_sha256_hex')
    expect(migrationSql).toContain("digest(convert_to(p_canonical, 'UTF8'), 'sha256')")
    expect(migrationSql).not.toMatch(/p_request_fingerprint/)
    expect(migrationSql).not.toMatch(/p_fingerprint/)
  })
})

describe('budget Phase 1C — balances and read RPC', () => {
  it('defines internal balance views without authenticated grants', () => {
    expect(migrationSql).toContain('budget_allocation_balances_v')
    expect(migrationSql).toContain('budget_funding_source_balances_v')
    expect(migrationSql).toContain('original_budget_authority_minor')
    expect(migrationSql).toContain('current_budget_authority_minor')
    expect(migrationSql).toContain('open_commitment_minor')
    expect(migrationSql).toContain('actual_expense_minor')
    expect(migrationSql).toContain('available_minor')
    expect(migrationSql).toContain('reserve_minor')
    expect(migrationSql).toContain(
      'REVOKE ALL ON TABLE public.budget_allocation_balances_v FROM authenticated',
    )
    expect(migrationSql).toContain(
      'REVOKE ALL ON TABLE public.budget_funding_source_balances_v FROM authenticated',
    )
  })

  it('implements get_budget_period_balances distinguishing authorized/allocated/reserve', () => {
    expect(migrationSql).toContain('get_budget_period_balances')
    expect(migrationSql).toMatch(
      /get_budget_period_balances[\s\S]*budget\.view/,
    )
    expect(migrationSql).toContain("'authorized_minor'")
    expect(migrationSql).toContain("'allocated_current_minor'")
    expect(migrationSql).toContain("'reserve_minor'")
    expect(migrationSql).toContain("'operational_available_minor'")
    expect(migrationSql).toContain("'open_commitment_minor'")
    expect(migrationSql).toContain("'actual_expense_minor'")
  })
})

describe('budget Phase 1C — concurrency and locks', () => {
  it('documents deterministic lock order without SKIP LOCKED and rechecks reserve post-lock', () => {
    expect(migrationSql).toContain(
      'Lock order: period → funding source → allocation → idempotency/operation → ledger',
    )
    expect(migrationSql).toContain(
      'Lock order: period → funding source → allocation → operation → ledger',
    )
    expect(migrationSql).not.toContain('SKIP LOCKED')
    expect(migrationSql).toMatch(
      /set_initial_budget_allocation[\s\S]*FOR UPDATE[\s\S]*budget_funding_source_reserve_minor/,
    )
    expect(migrationSql).toMatch(
      /adjust_budget_allocation[\s\S]*FOR UPDATE[\s\S]*budget_funding_source_reserve_minor/,
    )
    expect(migrationSql).toContain('idx_budget_ledger_one_initial_per_allocation')
  })
})

describe('budget Phase 1C — RLS / ACL / function security', () => {
  it('fail-closes allocations, operations, and ledger tables', () => {
    for (const table of [
      'public.budget_allocations',
      'public.budget_financial_operations',
      'public.budget_ledger_entries',
    ]) {
      expect(migrationSql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM anon`)
      expect(migrationSql).toContain(`REVOKE ALL ON TABLE ${table} FROM authenticated`)
    }
    expect(migrationSql).not.toMatch(
      /CREATE POLICY[\s\S]*ON public\.budget_(allocations|financial_operations|ledger_entries)/,
    )
  })

  it('grants authenticated EXECUTE only on approved client RPCs', () => {
    for (const fn of [
      'set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT)',
      'adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT)',
      'get_budget_period_balances(UUID)',
    ]) {
      expect(migrationSql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`)
      expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`)
      expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon`)
    }

    for (const fn of [
      'budget_money_business_cap()',
      'budget_sha256_hex(TEXT)',
      'budget_allocation_current_authority_minor(UUID)',
      'budget_funding_source_reserve_minor(UUID)',
      'budget_category_is_leaf(UUID)',
      'budget_fingerprint_initial_allocation(UUID, UUID, BIGINT)',
      'budget_fingerprint_allocation_adjustment(UUID, BIGINT, TEXT)',
    ]) {
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

  it('uses SECURITY DEFINER and fixed search_path on client RPCs', () => {
    for (const fn of [
      'set_initial_budget_allocation',
      'adjust_budget_allocation',
      'get_budget_period_balances',
    ]) {
      expect(migrationSql).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*SECURITY DEFINER[\\s\\S]*SET search_path = public`,
        ),
      )
      expect(migrationSql).toMatch(
        new RegExp(`${fn}[\\s\\S]*auth\\.uid\\(\\)`),
      )
    }
  })
})

describe('budget Phase 1C — stable errors', () => {
  it('defines the required stable error codes', () => {
    for (const code of [
      'budget_permission_denied',
      'budget_management_not_enabled',
      'budget_period_not_draft',
      'budget_period_not_active',
      'budget_period_closed',
      'budget_invalid_amount',
      'budget_insufficient_available',
      'budget_initial_allocation_exists',
      'budget_duplicate_operation',
      'budget_structure_locked',
      'budget_not_found',
    ]) {
      expect(migrationSql).toContain(`'${code}'`)
    }
  })
})

describe('budget Phase 1C — regression guardrails', () => {
  it('does not edit P1A/P1B migrations or implement P1D/transfer/requests/Phase 3', () => {
    expect(p1aSql).toContain('CREATE TABLE public.budget_periods')
    expect(p1aSql).not.toMatch(/CREATE TABLE public\.budget_allocations/)
    expect(p1aSql).not.toMatch(/CREATE TABLE public\.budget_ledger_entries/)
    expect(p1bSql).toContain('budget_user_has_capability')
    expect(p1bSql).not.toContain('budget_ledger_entries')
    expect(migrationSql).not.toContain('transfer_budget_amount')
    expect(migrationSql).not.toContain('CREATE TABLE public.budget_transfers')
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(migrationSql).not.toContain('quotation_pdf')
    expect(migrationSql).not.toContain('school_registration_quotations')
  })
})
