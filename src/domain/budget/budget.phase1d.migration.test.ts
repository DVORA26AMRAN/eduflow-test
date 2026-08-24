import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const p1dPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821123000_budget_phase1d_transfers.sql',
)
const p1aPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821120000_budget_phase1a_configuration_schema.sql',
)
const p1bPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821121000_budget_phase1b_permission_foundation.sql',
)
const p1cPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821122000_budget_phase1c_ledger_foundation.sql',
)

const p1dSql = readFileSync(p1dPath, 'utf8')
const p1aSql = readFileSync(p1aPath, 'utf8')
const p1bSql = readFileSync(p1bPath, 'utf8')
const p1cSql = readFileSync(p1cPath, 'utf8')

const transferFn = p1dSql.slice(
  p1dSql.indexOf('CREATE OR REPLACE FUNCTION public.transfer_budget_authority'),
  p1dSql.indexOf('COMMENT ON FUNCTION public.transfer_budget_authority'),
)

describe('budget Phase 1D — RPC contract', () => {
  it('implements transfer_budget_authority with transfer_funds and no role fallback', () => {
    expect(p1dSql).toContain(
      'CREATE OR REPLACE FUNCTION public.transfer_budget_authority(',
    )
    expect(transferFn).toContain('p_source_allocation_id UUID')
    expect(transferFn).toContain('p_destination_allocation_id UUID')
    expect(transferFn).toContain('p_amount_minor BIGINT')
    expect(transferFn).toContain('p_reason TEXT')
    expect(transferFn).toContain('p_idempotency_key TEXT')
    expect(transferFn).toContain('RETURNS JSONB')
    expect(transferFn).toContain('SECURITY DEFINER')
    expect(transferFn).toContain('SET search_path = public')
    expect(transferFn).toContain('auth.uid()')
    expect(transferFn).toMatch(/budget_user_has_capability\(\s*v_actor_user\.institution_id,\s*'budget\.transfer_funds'/)
    expect(transferFn).not.toMatch(/p_institution_id/)
    expect(transferFn).not.toMatch(/p_actor_user_id/)
    expect(transferFn).not.toMatch(/p_request_fingerprint/)
    expect(transferFn).not.toMatch(/p_fingerprint/)
    expect(transferFn).not.toMatch(/primary_role/)
    expect(transferFn).not.toMatch(/institution_manager/)
  })
})

describe('budget Phase 1D — auth', () => {
  it('requires transfer_funds, active actor, and enabled institution', () => {
    expect(transferFn).toContain("v_actor_user.status <> 'active'")
    expect(transferFn).toContain('budget_institution_is_enabled')
    expect(transferFn).toContain("'budget.transfer_funds'")
    expect(transferFn).toContain("budget_fail('budget_permission_denied')")
    expect(transferFn).toContain("budget_fail('budget_management_not_enabled')")
    expect(transferFn).toMatch(
      /institution_id = v_actor_user\.institution_id[\s\S]*budget_not_found/,
    )
  })
})

describe('budget Phase 1D — scope', () => {
  it('requires same institution, period, and funding source and does not create destination allocations', () => {
    expect(transferFn).toMatch(
      /v_source\.funding_source_id IS DISTINCT FROM v_dest\.funding_source_id[\s\S]*budget_transfer_cross_source_forbidden/,
    )
    expect(transferFn).toMatch(
      /v_source\.budget_period_id IS DISTINCT FROM v_dest\.budget_period_id[\s\S]*budget_not_found/,
    )
    expect(transferFn).toContain("budget_fail('budget_transfer_same_allocation')")
    expect(transferFn).not.toContain('INSERT INTO public.budget_allocations')
    expect(transferFn).toMatch(
      /p_destination_allocation_id[\s\S]*budget_not_found/,
    )
  })
})

describe('budget Phase 1D — status', () => {
  it('allows draft and active periods and rejects closed and archived structure', () => {
    expect(transferFn).toContain("v_period.status NOT IN ('draft', 'active')")
    expect(transferFn).toContain("budget_fail('budget_period_closed')")
    expect(transferFn).toMatch(
      /v_source_fs\.status <> 'active'[\s\S]*budget_structure_locked/,
    )
    expect(transferFn).toMatch(
      /v_source_category\.status <> 'active'[\s\S]*v_dest_category\.status <> 'active'[\s\S]*budget_structure_locked/,
    )
  })
})

describe('budget Phase 1D — money', () => {
  it('accepts positive BIGINT only with business cap and no ABS()', () => {
    expect(transferFn).toMatch(/p_amount_minor\s+BIGINT/)
    expect(transferFn).toMatch(/p_amount_minor IS NULL/)
    expect(transferFn).toMatch(/p_amount_minor <= 0/)
    expect(transferFn).toMatch(
      /p_amount_minor > public\.budget_money_business_cap\(\)/,
    )
    expect(transferFn).toContain("budget_fail('budget_invalid_amount')")
    expect(p1dSql).not.toMatch(/(?<![\w])abs\s*\(/i)
    expect(p1dSql).not.toMatch(/\b(NUMERIC|DOUBLE PRECISION|REAL|FLOAT)\b/i)
    expect(transferFn).toContain("budget_fail('budget_insufficient_available')")
    expect(transferFn).toContain('budget_allocation_available_minor')
    expect(transferFn).not.toMatch(
      /p_amount_minor > public\.budget_allocation_current_authority_minor/,
    )
  })
})

describe('budget Phase 1D — ledger pair', () => {
  it('writes transfer_out negative and transfer_in positive under one budget_transfer operation', () => {
    expect(p1dSql).toContain("'budget_transfer'")
    expect(transferFn).toContain("'transfer_out'")
    expect(transferFn).toContain("'transfer_in'")
    expect(transferFn).toContain('-p_amount_minor')
    expect(transferFn).toMatch(/'budget_authority'[\s\S]*'transfer_out'/)
    expect(transferFn).toMatch(/'budget_authority'[\s\S]*'transfer_in'/)
    expect(p1dSql).toContain('idx_budget_ledger_one_transfer_out_per_operation')
    expect(p1dSql).toContain('idx_budget_ledger_one_transfer_in_per_operation')
    expect(p1dSql).toContain('budget_ledger_entries_transfer_out_negative')
    expect(p1dSql).toContain('budget_ledger_entries_transfer_in_positive')
    expect(p1dSql).toContain('enforce_budget_transfer_ledger_pair')
    expect(p1dSql).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(transferFn).not.toMatch(/UPDATE public\.budget_ledger_entries/)
    expect(transferFn).not.toMatch(/DELETE FROM public\.budget_ledger_entries/)
    expect(p1dSql).not.toContain('CREATE TABLE public.budget_transfers')
  })

  it('keeps original budget as initial_allocation only', () => {
    expect(p1cSql).toMatch(
      /original_budget_authority_minor[\s\S]*event_type = 'initial_allocation'/,
    )
    expect(p1dSql).not.toContain('CREATE OR REPLACE VIEW public.budget_allocation_balances_v')
    expect(p1cSql).toContain("event_type = 'initial_allocation'")
  })
})

describe('budget Phase 1D — balances', () => {
  it('redistributes current authority without changing reserve or allocated totals', () => {
    expect(p1cSql).toMatch(
      /current_budget_authority_minor[\s\S]*financial_dimension = 'budget_authority'/,
    )
    expect(p1cSql).toContain('available_minor')
    expect(p1dSql).toContain('budget_allocation_available_minor')
    expect(transferFn).toContain('v_source_current - p_amount_minor')
    expect(transferFn).toContain('v_dest_current + p_amount_minor')
    expect(transferFn).not.toContain('authorized_amount_minor')
    expect(transferFn).not.toMatch(/UPDATE public\.budget_funding_sources/)
    expect(transferFn).not.toMatch(/UPDATE public\.budget_periods/)
  })
})

describe('budget Phase 1D — idempotency', () => {
  it('fingerprints source, destination, amount, reason, and operation type server-side', () => {
    expect(p1dSql).toContain('budget_fingerprint_budget_transfer')
    expect(p1dSql).toContain('"operation_type":"budget_transfer"')
    expect(p1dSql).toContain('"source_allocation_id":"')
    expect(p1dSql).toContain('"destination_allocation_id":"')
    expect(p1dSql).toContain('"amount_minor":"')
    expect(p1dSql).toContain('to_jsonb(BTRIM(p_reason))')
    expect(transferFn).toMatch(
      /operation_type <> 'budget_transfer'[\s\S]*request_fingerprint <> v_fingerprint[\s\S]*budget_duplicate_operation/,
    )
    expect(transferFn).toContain("'duplicate', true")
    expect(transferFn).toContain("'duplicate', false")
  })
})

describe('budget Phase 1D — concurrency contract', () => {
  it('locks period, funding source, then allocations in UUID order and recomputes available', () => {
    expect(transferFn).toContain(
      'Lock order: period → funding source → allocations (UUID ascending) → initialization re-check → operation → ledger',
    )
    expect(transferFn).toMatch(
      /FROM public\.budget_periods[\s\S]*FOR UPDATE/,
    )
    expect(transferFn).toMatch(
      /FROM public\.budget_funding_sources[\s\S]*FOR UPDATE/,
    )
    expect(transferFn).toContain('p_source_allocation_id < p_destination_allocation_id')
    expect(transferFn).toContain('v_first_id := p_source_allocation_id')
    expect(transferFn).toContain('v_first_id := p_destination_allocation_id')
    expect(transferFn).toMatch(
      /WHERE id = v_first_id[\s\S]*FOR UPDATE[\s\S]*WHERE id = v_second_id[\s\S]*FOR UPDATE/,
    )
    const firstLock = transferFn.indexOf('WHERE id = v_first_id')
    const secondLock = transferFn.indexOf('WHERE id = v_second_id')
    const initSource = transferFn.indexOf(
      "budget_fail('budget_transfer_source_not_initialized')",
    )
    const initDest = transferFn.indexOf(
      "budget_fail('budget_transfer_destination_not_initialized')",
    )
    const availableRecalc = transferFn.indexOf(
      'v_available := public.budget_allocation_available_minor',
    )
    const opInsert = transferFn.indexOf(
      'INSERT INTO public.budget_financial_operations',
    )
    expect(firstLock).toBeGreaterThan(-1)
    expect(secondLock).toBeGreaterThan(firstLock)
    expect(initSource).toBeGreaterThan(secondLock)
    expect(initDest).toBeGreaterThan(initSource)
    expect(availableRecalc).toBeGreaterThan(initDest)
    expect(opInsert).toBeGreaterThan(availableRecalc)
    expect(p1dSql).not.toContain('SKIP LOCKED')
    expect(transferFn).toMatch(
      /INSERT INTO public\.budget_ledger_entries[\s\S]*'transfer_out'[\s\S]*'transfer_in'/,
    )
  })
})

describe('budget Phase 1D N1 — destination/source initial allocation', () => {
  it('requires budget_authority initial_allocation on both allocations after locks', () => {
    expect(transferFn).toContain("budget_fail('budget_transfer_source_not_initialized')")
    expect(transferFn).toContain(
      "budget_fail('budget_transfer_destination_not_initialized')",
    )
    expect(transferFn).toMatch(
      /financial_dimension = 'budget_authority'[\s\S]*event_type = 'initial_allocation'[\s\S]*budget_transfer_source_not_initialized/,
    )
    expect(transferFn).toMatch(
      /financial_dimension = 'budget_authority'[\s\S]*event_type = 'initial_allocation'[\s\S]*budget_transfer_destination_not_initialized/,
    )
    expect(transferFn).not.toMatch(
      /budget_transfer_destination_not_initialized[\s\S]*budget_not_found/,
    )
  })

  it('does not treat allocation identity, current balance, or non-initial events as initialization', () => {
    expect(transferFn).not.toMatch(
      /budget_transfer_destination_not_initialized[\s\S]*current_budget_authority/,
    )
    const initDest = transferFn.indexOf(
      "budget_fail('budget_transfer_destination_not_initialized')",
    )
    const opInsert = transferFn.indexOf(
      'INSERT INTO public.budget_financial_operations',
    )
    expect(initDest).toBeGreaterThan(-1)
    expect(initDest).toBeLessThan(opInsert)
    expect(transferFn).not.toContain('INSERT INTO public.budget_allocations')
    expect(transferFn).not.toMatch(
      /event_type = 'allocation_adjustment'[\s\S]*budget_transfer_destination_not_initialized/,
    )
  })
})

describe('budget Phase 1D N1 — deferred transfer pair invariant', () => {
  const assertFn = p1dSql.slice(
    p1dSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.assert_budget_transfer_operation_pair',
    ),
    p1dSql.indexOf(
      'COMMENT ON FUNCTION public.assert_budget_transfer_operation_pair',
    ),
  )

  it('defers pair validation to commit and requires exactly one out and one in', () => {
    expect(p1dSql).toContain('CREATE CONSTRAINT TRIGGER budget_ledger_entries_transfer_pair')
    expect(assertFn).toContain('v_count <> 2')
    expect(assertFn).toContain("event_type = 'transfer_out'")
    expect(assertFn).toContain("event_type = 'transfer_in'")
    expect(assertFn).toContain("financial_dimension = 'budget_authority'")
    expect(p1dSql).toContain('idx_budget_ledger_one_transfer_out_per_operation')
    expect(p1dSql).toContain('idx_budget_ledger_one_transfer_in_per_operation')
  })

  it('enforces opposite signs, overflow-safe equal magnitude, net zero, and distinct allocations', () => {
    expect(assertFn).toContain('v_out.amount_minor >= 0')
    expect(assertFn).toContain('v_in.amount_minor <= 0')
    expect(assertFn).toContain('v_in.amount_minor <> (0::BIGINT - v_out.amount_minor)')
    expect(assertFn).not.toMatch(/(?<![\w])abs\s*\(/i)
    expect(assertFn).toContain('v_out.allocation_id IS NOT DISTINCT FROM v_in.allocation_id')
    expect(assertFn).toContain("RAISE EXCEPTION 'budget_transfer_same_allocation'")
    expect(assertFn).not.toMatch(/SQLERRM/i)
  })
})

describe('budget Phase 1D N2 — operation-side and ledger-side deferred pair', () => {
  const assertFn = p1dSql.slice(
    p1dSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.assert_budget_transfer_operation_pair',
    ),
    p1dSql.indexOf(
      'COMMENT ON FUNCTION public.assert_budget_transfer_operation_pair',
    ),
  )
  const opTriggerFn = p1dSql.slice(
    p1dSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.enforce_budget_transfer_operation_pair()',
    ),
    p1dSql.indexOf(
      'COMMENT ON FUNCTION public.enforce_budget_transfer_operation_pair()',
    ),
  )
  const ledgerTriggerFn = p1dSql.slice(
    p1dSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.enforce_budget_transfer_ledger_pair()',
    ),
    p1dSql.indexOf(
      'COMMENT ON FUNCTION public.enforce_budget_transfer_ledger_pair()',
    ),
  )

  it('schedules deferred validation from both operation INSERT and ledger transfer INSERT', () => {
    expect(p1dSql).toContain(
      'CREATE CONSTRAINT TRIGGER budget_financial_operations_transfer_pair',
    )
    expect(p1dSql).toContain(
      'CREATE CONSTRAINT TRIGGER budget_ledger_entries_transfer_pair',
    )
    expect(p1dSql).toMatch(
      /CREATE CONSTRAINT TRIGGER budget_financial_operations_transfer_pair[\s\S]*DEFERRABLE INITIALLY DEFERRED[\s\S]*WHEN \(NEW\.operation_type = 'budget_transfer'\)/,
    )
    expect(p1dSql).toMatch(
      /CREATE CONSTRAINT TRIGGER budget_ledger_entries_transfer_pair[\s\S]*DEFERRABLE INITIALLY DEFERRED[\s\S]*WHEN \(NEW\.event_type IN \('transfer_out', 'transfer_in'\)\)/,
    )
    expect(opTriggerFn).toContain(
      'PERFORM public.assert_budget_transfer_operation_pair(NEW.id)',
    )
    expect(ledgerTriggerFn).toContain(
      'PERFORM public.assert_budget_transfer_operation_pair(NEW.operation_id)',
    )
  })

  it('fails closed for zero ledger rows, one-sided pairs, malformed amounts, same allocation, and third row', () => {
    // Operation-side covers budget_transfer + zero ledger rows (ledger trigger never fires).
    expect(p1dSql).toContain(
      'Operation-side: schedules even when zero ledger rows follow',
    )
    expect(assertFn).toContain('v_count <> 2')
    expect(assertFn).toContain("event_type = 'transfer_out'")
    expect(assertFn).toContain("event_type = 'transfer_in'")
    expect(assertFn).toContain('v_out.amount_minor >= 0')
    expect(assertFn).toContain('v_in.amount_minor <= 0')
    expect(assertFn).toContain('v_in.amount_minor <> (0::BIGINT - v_out.amount_minor)')
    expect(assertFn).toContain('v_out.allocation_id IS NOT DISTINCT FROM v_in.allocation_id')
    expect(assertFn).toContain("RAISE EXCEPTION 'budget_transfer_same_allocation'")
    expect(assertFn).toContain("RAISE EXCEPTION 'budget_not_found'")
    expect(assertFn).not.toMatch(/SQLERRM/i)
    expect(assertFn).not.toMatch(/pg_constraint/i)
  })

  it('allows normal RPC operation INSERT then atomic pair INSERT until commit validation', () => {
    const opInsert = transferFn.indexOf(
      'INSERT INTO public.budget_financial_operations',
    )
    const ledgerInsert = transferFn.indexOf(
      'INSERT INTO public.budget_ledger_entries',
    )
    expect(opInsert).toBeGreaterThan(-1)
    expect(ledgerInsert).toBeGreaterThan(opInsert)
    expect(transferFn).toMatch(
      /INSERT INTO public\.budget_ledger_entries[\s\S]*'transfer_out'[\s\S]*'transfer_in'/,
    )
    expect(p1dSql).toContain(
      'deferred checks run at COMMIT after the pair exists',
    )
  })
})

describe('budget Phase 1D — RLS / ACL / function security', () => {
  it('grants authenticated EXECUTE only on transfer_budget_authority', () => {
    expect(p1dSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) TO authenticated',
    )
    expect(p1dSql).toContain(
      'REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC',
    )
    expect(p1dSql).toContain(
      'REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM anon',
    )

    for (const fn of [
      'budget_allocation_available_minor(UUID)',
      'budget_fingerprint_budget_transfer(UUID, UUID, BIGINT, TEXT)',
      'assert_budget_transfer_operation_pair(UUID)',
      'enforce_budget_transfer_operation_pair()',
      'enforce_budget_transfer_ledger_pair()',
    ]) {
      expect(p1dSql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM authenticated`)
      expect(p1dSql).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} TO authenticated`,
        ),
      )
    }
  })
})

describe('budget Phase 1D — stable errors', () => {
  it('defines required stable error codes without SQLERRM leakage', () => {
    for (const code of [
      'budget_permission_denied',
      'budget_management_not_enabled',
      'budget_not_found',
      'budget_period_closed',
      'budget_structure_locked',
      'budget_invalid_amount',
      'budget_insufficient_available',
      'budget_duplicate_operation',
      'budget_transfer_cross_source_forbidden',
      'budget_transfer_same_allocation',
      'budget_transfer_source_not_initialized',
      'budget_transfer_destination_not_initialized',
    ]) {
      expect(p1dSql).toContain(`'${code}'`)
    }
    expect(p1dSql).not.toMatch(/SQLERRM/i)
  })
})

describe('budget Phase 1D — taxonomy extension', () => {
  it('extends operation and ledger checks without opening commitment/expense events', () => {
    expect(p1dSql).toContain("'budget_transfer'")
    expect(p1dSql).toContain("'transfer_out'")
    expect(p1dSql).toContain("'transfer_in'")
    expect(p1dSql).toContain('-- commitment / actual_expense event types reserved for later phases')
    expect(p1dSql).not.toMatch(
      /financial_dimension = 'commitment'\s+AND event_type/,
    )
  })
})

describe('budget Phase 1D — regression guardrails', () => {
  it('does not edit P1A/P1B/P1C migrations or implement later phases', () => {
    expect(p1aSql).toContain('CREATE TABLE public.budget_periods')
    expect(p1aSql).not.toContain('transfer_budget_authority')
    expect(p1bSql).toContain("('budget.transfer_funds'")
    expect(p1bSql).not.toContain('transfer_budget_authority')
    expect(p1cSql).toContain("operation_type IN ('initial_allocation', 'allocation_adjustment')")
    expect(p1cSql).not.toContain('transfer_in')
    expect(p1cSql).not.toContain('transfer_out')
    expect(p1cSql).not.toContain('transfer_budget_authority')
    expect(p1dSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(p1dSql).not.toContain('quotation_pdf')
    expect(p1dSql).not.toContain('school_registration_quotations')
    expect(p1dSql).not.toContain('CREATE TABLE public.budget_commitments')
    expect(p1dSql).not.toContain("event_type IN ('commitment'")
    expect(p1dSql).not.toContain('CREATE TABLE public.budget_actual_expenses')
  })
})
