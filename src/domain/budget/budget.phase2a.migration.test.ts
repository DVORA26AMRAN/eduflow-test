import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const p2aPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821124000_budget_phase2a_period_lifecycle.sql',
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
const p1dPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821123000_budget_phase1d_transfers.sql',
)

const p2aSql = readFileSync(p2aPath, 'utf8')
const p1aSql = readFileSync(p1aPath, 'utf8')
const p1bSql = readFileSync(p1bPath, 'utf8')
const p1cSql = readFileSync(p1cPath, 'utf8')
const p1dSql = readFileSync(p1dPath, 'utf8')

const createFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.create_budget_period_draft'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.create_budget_period_draft'),
)
const editFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.edit_budget_period_draft'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.edit_budget_period_draft'),
)
const reviewFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_period_activation_review'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.get_budget_period_activation_review'),
)
const activateFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.activate_budget_period'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.activate_budget_period'),
)
const closeFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.close_budget_period'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.close_budget_period'),
)
const listFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.list_budget_periods'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.list_budget_periods'),
)
const reviewPayloadFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.budget_build_activation_review_payload'),
  p2aSql.indexOf('REVOKE ALL ON FUNCTION public.budget_build_activation_review_payload'),
)
const finErrFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.budget_period_financial_mutation_error'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.budget_period_financial_mutation_error'),
)
const lockFn = p2aSql.slice(
  p2aSql.indexOf(
    'CREATE OR REPLACE FUNCTION public.budget_lock_institution_budget_periods',
  ),
  p2aSql.indexOf(
    'COMMENT ON FUNCTION public.budget_lock_institution_budget_periods',
  ),
)
const setInitialFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.set_initial_budget_allocation'),
)
const adjustFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.adjust_budget_allocation'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.adjust_budget_allocation'),
)
const transferFn = p2aSql.slice(
  p2aSql.indexOf('CREATE OR REPLACE FUNCTION public.transfer_budget_authority'),
  p2aSql.indexOf('COMMENT ON FUNCTION public.transfer_budget_authority'),
)

describe('budget Phase 2A — schema', () => {
  it('extends budget_periods forward-only with updated_by_user_id and stricter dates', () => {
    expect(p2aSql).toContain('ADD COLUMN IF NOT EXISTS updated_by_user_id')
    expect(p2aSql).toContain('budget_periods_start_before_end')
    expect(p2aSql).toContain('CHECK (start_date < end_date)')
    expect(p2aSql).toContain('budget_periods_name_max_length')
  })

  it('reuses one-active partial unique index from P1A', () => {
    expect(p1aSql).toContain('idx_budget_periods_one_active_per_institution')
    expect(p2aSql).not.toContain('DROP INDEX idx_budget_periods_one_active_per_institution')
  })

  it('adds lifecycle audit table append-only without client access', () => {
    expect(p2aSql).toContain('CREATE TABLE public.budget_period_lifecycle_audit_events')
    expect(p2aSql).toContain("'period_created'")
    expect(p2aSql).toContain("'period_metadata_updated'")
    expect(p2aSql).toContain("'period_activated'")
    expect(p2aSql).toContain("'period_closed'")
    expect(p2aSql).toContain('budget_period_lifecycle_audit_no_update')
    expect(p2aSql).toContain('budget_period_lifecycle_audit_no_delete')
    expect(p2aSql).toContain(
      'REVOKE ALL ON TABLE public.budget_period_lifecycle_audit_events FROM authenticated',
    )
  })
})

describe('budget Phase 2A — overlap and immutability enforcement', () => {
  it('enforces same-institution non-overlap at database level', () => {
    expect(p2aSql).toContain('CREATE TRIGGER budget_periods_enforce_no_overlap')
    expect(p2aSql).toContain("RAISE EXCEPTION 'budget_period_overlap'")
    expect(p2aSql).toContain('budget_period_has_overlap')
    expect(createFn).toContain('budget_period_overlap')
    expect(editFn).toContain('budget_period_overlap')
  })

  it('blocks closed terminal state, deletes, and forbidden status regressions', () => {
    expect(p2aSql).toContain('CREATE TRIGGER budget_periods_enforce_lifecycle_immutability')
    expect(p2aSql).toContain("RAISE EXCEPTION 'budget_period_closed'")
    expect(p2aSql).toContain("OLD.status = 'draft' AND NEW.status = 'active'")
    expect(p2aSql).toContain("OLD.status = 'active' AND NEW.status = 'closed'")
    expect(editFn).toContain("budget_fail('budget_period_not_draft')")
  })
})

describe('budget Phase 2A — create_budget_period_draft', () => {
  it('requires manage_structure and always creates draft status server-side', () => {
    expect(createFn).toContain("v_actor UUID := auth.uid()")
    expect(createFn).toContain("'budget.manage_structure'")
    expect(createFn).toContain("'draft'")
    expect(createFn).not.toMatch(/p_status/i)
    expect(createFn).not.toMatch(/p_institution_id/i)
    expect(createFn).toContain('budget_invalid_dates')
    expect(createFn).toContain('period_created')
  })

  it('locks institution row before overlap check and insert', () => {
    expect(createFn).toContain('budget_lock_institution_budget_periods')
    expect(lockFn).toMatch(
      /FROM public\.institutions[\s\S]*FOR UPDATE[\s\S]*FROM public\.budget_periods[\s\S]*ORDER BY p\.id[\s\S]*FOR UPDATE/,
    )
    const institutionLock = createFn.indexOf('budget_lock_institution_budget_periods')
    const overlapCheck = createFn.indexOf('budget_period_has_overlap')
    const insert = createFn.indexOf('INSERT INTO public.budget_periods')
    expect(institutionLock).toBeGreaterThan(-1)
    expect(overlapCheck).toBeGreaterThan(institutionLock)
    expect(insert).toBeGreaterThan(overlapCheck)
    expect(p2aSql).not.toMatch(/FOR UPDATE\s+SKIP LOCKED/i)
  })
})

describe('budget Phase 2A — institution-scoped concurrency lock', () => {
  it('uses institution row FOR UPDATE as mutex even when zero budget_periods exist', () => {
    expect(lockFn).toContain('FROM public.institutions')
    expect(lockFn).toContain('FOR UPDATE')
    expect(lockFn).toContain("RAISE EXCEPTION 'budget_not_found'")
    expect(lockFn).toContain('ORDER BY p.id')
    expect(p2aSql).not.toContain('pg_advisory')
    expect(p2aSql).not.toMatch(/FOR UPDATE\s+SKIP LOCKED/i)
  })

  it('does not add institution lock to financial mutation RPCs', () => {
    for (const fn of [setInitialFn, adjustFn, transferFn, closeFn]) {
      expect(fn).not.toContain('budget_lock_institution_budget_periods')
    }
  })
})

describe('budget Phase 2A — edit_budget_period_draft', () => {
  it('acquires institution lock before target period read and forbids period-before-institution inversion', () => {
    const institutionLock = editFn.indexOf('budget_lock_institution_budget_periods')
    const targetRead = editFn.indexOf('WHERE id = p_period_id')
    const overlapCheck = editFn.indexOf('budget_period_has_overlap')
    const update = editFn.indexOf('UPDATE public.budget_periods')
    expect(institutionLock).toBeGreaterThan(-1)
    expect(targetRead).toBeGreaterThan(institutionLock)
    expect(overlapCheck).toBeGreaterThan(targetRead)
    expect(update).toBeGreaterThan(overlapCheck)
    expect(editFn).not.toMatch(
      /WHERE id = p_period_id[\s\S]*FOR UPDATE[\s\S]*budget_lock_institution_budget_periods/,
    )
    expect(editFn).not.toContain('FOR UPDATE')
  })

  it('allows draft metadata edits only', () => {
    expect(editFn).toContain("'budget.manage_structure'")
    expect(editFn).toContain("v_period.status <> 'draft'")
    expect(editFn).toContain('period_metadata_updated')
    expect(editFn).toContain('updated_by_user_id = v_actor')
    expect(editFn).not.toContain('SET status =')
  })
})

describe('budget Phase 2A — activation review', () => {
  it('returns structured readiness with blockers, warnings, and totals', () => {
    expect(reviewFn).toContain("'budget.activate_period'")
    expect(reviewPayloadFn).toContain("'period_id'")
    expect(reviewPayloadFn).toContain("'ready'")
    expect(reviewPayloadFn).toContain("'blockers'")
    expect(reviewPayloadFn).toContain("'warnings'")
    expect(reviewPayloadFn).toContain("'totals'")
    expect(reviewPayloadFn).toContain("'authorized_minor'")
    expect(reviewPayloadFn).toContain("'allocated_current_minor'")
    expect(reviewPayloadFn).toContain("'reserve_minor'")
  })

  it('defines blocker and warning taxonomy including empty budget and reserve warning', () => {
    expect(reviewPayloadFn).toContain("'period_not_draft'")
    expect(reviewPayloadFn).toContain("'before_start_date'")
    expect(reviewPayloadFn).toContain("'active_period_exists'")
    expect(reviewPayloadFn).toContain("'no_authorized_funding'")
    expect(reviewPayloadFn).toContain("'financial_invariant_violation'")
    expect(reviewPayloadFn).toContain("'unallocated_reserve'")
    expect(reviewPayloadFn).not.toContain('100%')
  })
})

describe('budget Phase 2A — activate_budget_period', () => {
  it('requires activate_period capability and manual authoritative checks', () => {
    expect(activateFn).toContain("'budget.activate_period'")
    expect(activateFn).toContain('budget_lock_institution_budget_periods')
    const institutionLock = activateFn.indexOf('budget_lock_institution_budget_periods')
    const targetLock = activateFn.indexOf('WHERE id = p_period_id')
    expect(institutionLock).toBeGreaterThan(-1)
    expect(targetLock).toBeGreaterThan(institutionLock)
    expect(activateFn).toContain('budget_build_activation_review_payload')
    expect(activateFn).toContain('budget_period_before_start')
    expect(activateFn).toContain('budget_period_active_exists')
    expect(activateFn).toContain('budget_period_activation_blocked')
    expect(activateFn).toContain('period_activated')
    expect(activateFn).not.toContain("status = 'closed'")
    expect(activateFn).not.toMatch(/auto.?close/i)
  })

  it('does not auto-close another active period', () => {
    expect(activateFn).toContain('budget_period_active_exists')
    expect(activateFn).not.toMatch(/UPDATE public\.budget_periods[\s\S]*status = 'closed'/i)
  })
})

describe('budget Phase 2A — end-date financial freeze', () => {
  it('uses budget_period_ended when current date is past end_date', () => {
    expect(finErrFn).toContain('CURRENT_DATE > p_period.end_date')
    expect(finErrFn).toContain("'budget_period_ended'")
  })

  it('patches set_initial, adjust, and transfer RPCs after period lock', () => {
    for (const fn of [setInitialFn, adjustFn, transferFn]) {
      expect(fn).toContain('budget_period_financial_mutation_error(v_period)')
      expect(fn).toContain('RETURN public.budget_fail(v_fin_err)')
    }
    expect(finErrFn).toContain("'budget_period_ended'")
    const initialFreeze = setInitialFn.indexOf('budget_period_financial_mutation_error')
    const initialCategory = setInitialFn.indexOf('FROM public.budget_categories')
    expect(initialFreeze).toBeGreaterThan(-1)
    expect(initialFreeze).toBeLessThan(initialCategory)

    const adjustFreeze = adjustFn.indexOf('budget_period_financial_mutation_error')
    const adjustSource = adjustFn.indexOf('FROM public.budget_funding_sources')
    expect(adjustFreeze).toBeLessThan(adjustSource)

    const transferFreeze = transferFn.indexOf('budget_period_financial_mutation_error')
    const transferFs = transferFn.indexOf('FROM public.budget_funding_sources')
    expect(transferFreeze).toBeLessThan(transferFs)
  })
})

describe('budget Phase 2A — close_budget_period', () => {
  it('requires close_period capability and active status only', () => {
    expect(closeFn).toContain("'budget.close_period'")
    expect(closeFn).toContain("v_period.status <> 'active'")
    expect(closeFn).toContain("budget_fail('budget_period_not_active')")
    expect(closeFn).toContain("status = 'closed'")
    expect(closeFn).toContain('period_closed')
    expect(closeFn).not.toMatch(/auto.?close/i)
  })

  it('documents deferred commitment gate without inventing commitment storage', () => {
    expect(closeFn).toContain('Deferred commitment gate')
    expect(closeFn).toContain('open_commitment_minor > 0')
    expect(closeFn).toContain('budget_period_open_commitments')
    expect(p2aSql).not.toContain('CREATE TABLE public.budget_commitments')
    expect(p2aSql).not.toMatch(/CREATE TABLE public\.budget_.*commitment/i)
  })

  it('does not block close on reserve or unallocated authority alone', () => {
    expect(closeFn).not.toMatch(/reserve_minor\s*>\s*0[\s\S]*budget_fail/i)
    expect(closeFn).not.toMatch(/allocated_current_minor[\s\S]*budget_fail/i)
  })
})

describe('budget Phase 2A — list_budget_periods', () => {
  it('provides tenant-scoped historical read via budget.view', () => {
    expect(listFn).toContain("'budget.view'")
    expect(listFn).toContain('institution_id = v_actor_user.institution_id')
    expect(listFn).toContain("'period_id'")
    expect(listFn).toContain("'status'")
    expect(listFn).toContain("'start_date'")
    expect(listFn).toContain("'end_date'")
    expect(listFn).toContain('ORDER BY p.start_date DESC')
  })
})

describe('budget Phase 2A — capabilities', () => {
  it('uses existing P1B capability catalogue without role fallback', () => {
    expect(p1bSql).toContain("('budget.manage_structure'")
    expect(p1bSql).toContain("('budget.activate_period'")
    expect(p1bSql).toContain("('budget.close_period'")
    expect(p1bSql).toContain("('budget.view'")
    expect(createFn).not.toMatch(/primary_role/i)
    expect(activateFn).not.toMatch(/primary_role/i)
    expect(closeFn).not.toMatch(/primary_role/i)
    expect(p2aSql).not.toContain('INSERT INTO public.budget_capabilities')
  })
})

describe('budget Phase 2A — RLS / ACL / function security', () => {
  it('grants authenticated EXECUTE only on client lifecycle and patched financial RPCs', () => {
    for (const sig of [
      'create_budget_period_draft(TEXT, DATE, DATE)',
      'edit_budget_period_draft(UUID, TEXT, DATE, DATE)',
      'get_budget_period_activation_review(UUID)',
      'activate_budget_period(UUID)',
      'close_budget_period(UUID)',
      'list_budget_periods()',
      'set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT)',
      'adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT)',
      'transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT)',
    ]) {
      expect(p2aSql).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated`)
    }

    for (const fn of [
      'budget_write_period_lifecycle_audit(UUID, UUID, UUID, TEXT, JSONB)',
      'budget_lock_institution_budget_periods(UUID)',
      'budget_period_has_overlap(UUID, DATE, DATE, UUID)',
      'budget_period_financial_mutation_error(public.budget_periods)',
      'budget_period_activation_totals(UUID)',
      'budget_build_activation_review_payload(public.budget_periods, UUID)',
      'enforce_budget_period_no_overlap()',
      'enforce_budget_period_lifecycle_immutability()',
      'budget_period_lifecycle_audit_reject_mutation()',
    ]) {
      expect(p2aSql.replace(/\s+/g, ' ')).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM authenticated`,
      )
    }
  })

  it('uses SECURITY DEFINER and fixed search_path on client RPCs', () => {
    for (const fn of [createFn, editFn, reviewFn, activateFn, closeFn, listFn]) {
      expect(fn).toContain('SECURITY DEFINER')
      expect(fn).toContain('SET search_path = public')
    }
  })
})

describe('budget Phase 2A — stable errors', () => {
  it('defines required stable error codes without SQLERRM leakage', () => {
    for (const code of [
      'budget_invalid_dates',
      'budget_period_overlap',
      'budget_period_not_draft',
      'budget_period_not_active',
      'budget_period_before_start',
      'budget_period_active_exists',
      'budget_period_activation_blocked',
      'budget_period_ended',
      'budget_period_open_commitments',
      'budget_period_closed',
      'budget_permission_denied',
      'budget_not_found',
    ]) {
      expect(p2aSql).toContain(`'${code}'`)
    }
    expect(p2aSql).not.toMatch(/SQLERRM/i)
  })
})

describe('budget Phase 2A — static concurrency contract (SQL structure only)', () => {
  it('serializes create/edit/activate via institution mutex then period ordering', () => {
    expect(createFn).toContain('budget_lock_institution_budget_periods')
    expect(editFn).toContain('budget_lock_institution_budget_periods')
    expect(activateFn).toContain('budget_lock_institution_budget_periods')
    expect(lockFn).toMatch(
      /FROM public\.institutions[\s\S]*FOR UPDATE[\s\S]*FROM public\.budget_periods[\s\S]*ORDER BY p\.id[\s\S]*FOR UPDATE/,
    )
    expect(p2aSql).toContain(
      'Lock order: institution row → all institution periods (UUID ascending)',
    )
    expect(editFn).toContain(
      'Lock order: institution row → all institution periods (UUID ascending) → target re-read → overlap re-check → update',
    )
    expect(p2aSql).not.toMatch(/FOR UPDATE\s+SKIP LOCKED/i)
    expect(p1aSql).toContain('idx_budget_periods_one_active_per_institution')
    expect(p2aSql).toContain('budget_periods_enforce_no_overlap')
  })

  it('has no period-before-institution lock inversion in Phase 2A lifecycle RPCs', () => {
    for (const fn of [createFn, editFn, activateFn]) {
      const institutionLock = fn.indexOf('budget_lock_institution_budget_periods')
      expect(institutionLock).toBeGreaterThan(-1)
      const preInstitutionPeriodLock = fn.slice(0, institutionLock).includes('FOR UPDATE')
      expect(preInstitutionPeriodLock).toBe(false)
    }
  })

  it('re-checks activation authoritatively after advisory review path', () => {
    expect(activateFn).toContain('budget_build_activation_review_payload')
    expect(reviewFn).not.toContain('FOR UPDATE')
    expect(activateFn).toContain('FOR UPDATE')
  })

  it('keeps close vs financial serialization on shared period FOR UPDATE only', () => {
    expect(closeFn).toContain('FOR UPDATE')
    expect(setInitialFn).toContain('FOR UPDATE')
    expect(adjustFn).toContain('FOR UPDATE')
    expect(transferFn).toContain('FOR UPDATE')
    expect(closeFn).not.toContain('budget_lock_institution_budget_periods')
  })
})

describe('budget Phase 2A — regression guardrails', () => {
  it('does not edit P1A/P1B/P1C/P1D migration files', () => {
    expect(p1aSql).toContain('CREATE TABLE public.budget_periods')
    expect(p1aSql).not.toContain('create_budget_period_draft')
    expect(p1bSql).toContain("('budget.activate_period'")
    expect(p1bSql).not.toContain('activate_budget_period')
    expect(p1cSql).toContain('set_initial_budget_allocation')
    expect(p1cSql).not.toContain('budget_period_ended')
    expect(p1dSql).toContain('transfer_budget_authority')
    expect(p1dSql).not.toContain('budget_period_ended')
  })

  it('does not touch requests, commitments, expenses, Phase 3, or Substitute Board', () => {
    expect(p2aSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(p2aSql).not.toContain('school_registration_quotations')
    expect(p2aSql).not.toContain('quotation_pdf')
    expect(p2aSql).not.toContain('substitute')
    expect(p2aSql).not.toContain('CREATE TABLE public.budget_actual_expenses')
    expect(p2aSql).not.toMatch(/event_type IN \('commitment'/i)
  })
})
