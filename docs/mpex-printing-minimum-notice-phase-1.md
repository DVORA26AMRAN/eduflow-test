# MPEX Printing Minimum Notice — Phase 1 Validation

Status: **PASS**  
Date: 2026-09-06 (final acceptance after live grant remediation)  
Project: linked Supabase `kkafmsvntwqweudallty` (eduflow)

---

## Final verdict

| Gate | Result |
|---|---|
| AUTHORING | **PASS** |
| LIVE SECURITY REMEDIATION | **PASS** |
| LIVE ACL EVIDENCE | **PASS** (see below) |
| MINIMUM NOTICE SERVER ENFORCEMENT | **PASS** |
| PHASE 1 | **PASS** |
| PHASE 2 READINESS | **YES** |

### Live ACL evidence (post-remediation, project `kkafmsvntwqweudallty`)

| Check | Result |
|---|---|
| `printing_*` functions inspected | **35** |
| PUBLIC EXECUTE | **0** |
| anon EXECUTE | **0** |
| authenticated EXECUTE | **16** reviewed Class A functions only |
| service_role EXECUTE | **3** reviewed Class B worker functions only |
| Function bodies | **unchanged** (grant-only remediation) |

---

## Scope

Validate and remediate so that:

> Each institution controls how far in advance a teacher must submit a printing  
> request relative to the request’s `required_by` date/time, via  
> `institutions.minimum_print_notice_minutes`, with authoritative PostgreSQL enforcement,  
> and printing RPCs are not executable by `anon` / `PUBLIC`.

Out of scope for this phase (unchanged):

- Secretary/manager settings UI (Phase 2)
- Teacher UX redesign
- Printing cycles / weekly submission cutoffs

---

## Existing Data Model

**Source (repo):** `supabase/migrations/20250804120000_printing_requests_phase1.sql`

| Property | Evidence |
|---|---|
| Column | `public.institutions.minimum_print_notice_minutes` |
| Type | `INTEGER` |
| Default | **60** (`ALTER COLUMN … SET DEFAULT 60`) |
| NULL | Backfilled with `COALESCE(..., 60)` then `SET NOT NULL` |
| CHECK | `institutions_minimum_print_notice_minutes_valid`: `>= 0 AND <= 10080` (0–7 days in minutes) |
| Comment | Minimum minutes before `required_by` that a request may be submitted or retargeted |

**Invalid persistence:**

| Value | Persistable? |
|---|---|
| Negative | **No** — CHECK + RPC validation reject |
| `> 10080` | **No** — CHECK + RPC validation reject |
| `NULL` | **No** — column `NOT NULL` |
| `0` | **Yes** — allowed by CHECK (zero advance notice) |

Related request column: `printing_requests.required_by TIMESTAMPTZ NOT NULL`.

---

## Server Enforcement

### Helper: `printing_validate_required_by(institution_id, required_by)`

```sql
v_now TIMESTAMPTZ := NOW();
-- load minimum_print_notice_minutes
IF p_required_by < (v_now + make_interval(mins => v_notice)) THEN
  RETURN 'PRINT_REQUEST_TOO_LATE';
END IF;
RETURN NULL;
```

- Authoritative clock: PostgreSQL `NOW()`
- Comparison: absolute `TIMESTAMPTZ` instants
- Institution `timezone` is selected but **not used** in the duration comparison (correct for notice minutes)

### Boundary semantics (deterministic)

| Condition | Result |
|---|---|
| `required_by < NOW() + notice` | Reject — `PRINT_REQUEST_TOO_LATE` |
| `required_by = NOW() + notice` | **Accept** (strict `<` only) |
| `required_by > NOW() + notice` | Accept |

Mirrored in TS `isPrintingRequestTooLate` (`now > cutoff` ⇒ too late; equality accepted).

### Mutation paths

| Path | Changes `required_by`? | Calls `printing_validate_required_by`? |
|---|---|---|
| `printing_create_request` | Yes (insert) | **Yes** |
| `printing_update_request` | Only when `p_required_by IS NOT NULL` | **Yes** when changing `required_by` |
| `printing_resubmit_item` | **No** (item payload only) | **No** — parent `required_by` unchanged |

---

## Authorization (settings)

### `printing_update_institution_settings`

1. `v_actor := auth.uid()`
2. `v_institution_id := printing_resolve_actor_institution()` — **not** client-supplied
3. Allow iff active **secretary** OR active **institution_manager** for that institution
4. Else `SECRETARY_NOT_AUTHORIZED`
5. Range-check notice / warning / retention before UPDATE
6. Updates only `WHERE id = v_institution_id`

| Actor | Configure? |
|---|---|
| secretary | **Yes** |
| institution_manager | **Yes** |
| teacher | **No** |
| deputy | **No** (D2 left settings on secretary/manager only) |
| Cross-institution | **Impossible** via this RPC (no institution id parameter) |

---

## RLS and table writes

- RLS enabled on printing tables; policies are **SELECT-only**
- No authenticated INSERT/UPDATE/DELETE grants on `printing_requests` / `print_items`
- Mutations only via SECURITY DEFINER RPCs
- Teachers cannot directly UPDATE `minimum_print_notice_minutes` through table privileges

---

## Security remediation (applied)

### Defect (pre-remediation)

Live catalog showed **every** `public.printing_*` function with **`anon` EXECUTE** (PUBLIC already false).

### Migration

`supabase/migrations/20250902120000_printing_rpc_execute_grant_hardening.sql`

- **Grant-only** — no `CREATE OR REPLACE FUNCTION`, no `ALTER TABLE`, no RLS/policy changes, no business-rule changes
- Signatures from live `pg_get_function_identity_arguments`
- Applied live via authorized single-file linked apply (not `db push`)

| Class | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| A — Application RPCs + storage path helpers (16) | no | no | EXECUTE | no |
| B — Worker RPCs (3) | no | no | no | EXECUTE |
| C — Internal helpers | no | no | no | no |

Static contracts: `src/domain/printing/printing.migration.test.ts` suite  
`printing RPC EXECUTE grant hardening`.

---

## Time Semantics

| Topic | Finding |
|---|---|
| Storage | `required_by TIMESTAMPTZ` |
| Enforcement | Absolute instant vs `NOW() + interval` |
| Browser clock | Cannot bypass server validator |
| Institution TZ | Needed to build/display local wall time; not needed for notice duration math |

---

## Update / Resubmission Semantics

When `minimum_print_notice_minutes` changes (e.g. 60 → 120):

| Case | Behavior |
|---|---|
| Already submitted rows | **Not rewritten** |
| New creates | Use current institution setting via validator |
| Editable update that changes `required_by` | Revalidated against **current** setting |
| Editable update that omits `required_by` | Existing `required_by` kept; **not** re-checked |
| Item correction resubmit | Does not change or revalidate `required_by` |

---

## Existing Frontend Support

| Item | Evidence |
|---|---|
| Load settings | `loadInstitutionPrintingSettings` |
| Teacher UX gate | Client mirror only — **not** enforcement |
| Settings mutation client | `updateInstitutionPrintingSettings` → RPC |
| Settings UI | **None** — Phase 2 |
| Suitable Phase 2 home | `SecretaryPrintingWorkspace` |

---

## Phase 1 Acceptance

| Criterion | Result |
|---|---|
| Column + constraints exist | **PASS** |
| Product default 60 minutes | **PASS** |
| Server create/update enforce notice | **PASS** |
| Boundary equality accepted | **PASS** |
| Settings RPC auth (secretary/manager; teacher/deputy denied) | **PASS** |
| Institution identity not client-supplied | **PASS** |
| Direct table write protection | **PASS** |
| Function EXECUTE safe (no anon/PUBLIC) | **PASS** (live ACL) |
| Settings UI | Deferred to Phase 2 |
| Phase 2 ready | **YES** |

---

## Isolation note

Unrelated dirty work (Quotation, Agreement, Registration, app-origin leftovers, config, fonts/PDF, tmp/scripts) must not be mixed into the Printing Phase 1 commit.
