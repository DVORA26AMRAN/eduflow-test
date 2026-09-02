# School Budget Management — Phase 2A Validation Evidence

**Migration:** `supabase/migrations/20250821124000_budget_phase2a_period_lifecycle.sql`
**Contract tests:** `src/domain/budget/budget.phase2a.migration.test.ts`
**Linked project applied:** `kkafmsvntwqweudallty` (eduflow) — explicit file apply, not `db push`

---

## Final Phase 2A status

| Area | Status |
|---|---|
| **IMPLEMENTATION** | APPROVED |
| **MIGRATION** | APPLIED |
| **STRUCTURAL LIVE VERIFICATION** | PASSED |
| **SECURITY LIVE VERIFICATION** | PASSED |
| **REAL CONCURRENCY VERIFICATION** | DEFERRED (P2A-VAL-001) |

Real two-session PostgreSQL concurrency tests have **not** passed. Static SQL contract
tests do not close this debt.

---

## Architecture evidence established

- Institution-row mutex architecture reviewed (Correction #1)
- Canonical lock order: **institution → periods UUID ascending → downstream**
- `edit_budget_period_draft` lock order corrected (Correction #2): institution lock before target read; no target `FOR UPDATE` in edit
- One-active partial unique index exists live (`idx_budget_periods_one_active_per_institution`)
- Close and financial RPCs use shared period `FOR UPDATE` serialization
- Migration applied successfully to linked project via reviewed explicit file apply
- Live structural and security verification passed post-apply
- No production `budget_periods` data existed during validation (row count 0)

---

## Validation debt

### P2A-VAL-001 — Real PostgreSQL concurrency validation

| Field | Value |
|---|---|
| **ID** | P2A-VAL-001 |
| **Title** | Real PostgreSQL concurrency validation |
| **Status** | DEFERRED — TOOLING UNAVAILABLE |

**Scope still requiring real two-session PostgreSQL validation:**

1. Zero-period concurrent CREATE overlap serialization
2. Concurrent activation / one-active behavior
3. Close vs financial mutation serialization

**Reason deferred:**

No existing local direct PostgreSQL client is available. The repository does not
currently have the `pg` dependency installed. Installing tooling solely for this
validation was explicitly not authorized.

**Attempted live mutex test (institution-row lock only):**

Not executed — local environment lacks `pg` / `psql` (or equivalent) capable of
maintaining two concurrent sessions with held transactions. This is **validation debt**,
not an implementation defect.

**Required closure condition:**

Execute real two-session PostgreSQL concurrency tests in a safe isolated environment
or with approved operator tooling, with deterministic synchronization and documented
results.

**Closure rules:**

- This debt **MUST NOT** be silently marked complete by static SQL/text tests.
- Mutex-only institution lock proof on production requires approved direct Postgres
  tooling; full RPC overlap/activation/financial races require bootstrap actors and
  isolated or rollback-safe execution.

---

## Live verification summary (completed)

- Pre-apply production safety check: **PASS**
- Controlled migration apply: **PASS**
- Post-apply structural verification: **PASS** (columns, constraints, audit table, lifecycle RPCs, triggers, index, financial RPC patches, ACL/RLS)
- Post-apply security verification: **PASS** (SECURITY DEFINER, fixed `search_path`, authenticated-only EXECUTE on client RPCs)

---

## Out of scope for Phase 2A

- Funding-source / category / allocation UI
- Transfer UI, commitments, expenses, request integration, carry-forward
- Automatic activation or closing
- `public.requests` and Phase 3 quotation/PDF work
