# MPEX Printing Requests — Phase 1 Validation Report

Status: **Implementation complete for Phase 1 contracts** (pending migration apply on target environment)  
System: MPEX  
Feature: Printing Requests  
Phase: 1 — Domain, Security and Contracts  
Date: 2026-08-04

---

## 1. Files changed

| Path | Role |
|---|---|
| `supabase/migrations/20250804120000_printing_requests_phase1.sql` | Schema, RLS, storage, helpers |
| `supabase/migrations/20250804120100_printing_requests_phase1_commands.sql` | SECURITY DEFINER command RPCs |
| `src/types/printing.ts` | Typed contracts, limits, error codes, MIME allow-list |
| `src/domain/printing/validation.ts` | Cutoff, page selection, file/settings validation |
| `src/domain/printing/lifecycle.ts` | Transitions, parent status, claim/transfer/auth mirrors |
| `src/services/printingRequests.ts` | Typed RPC wrappers (no production UI) |
| `src/domain/printing/printing.migration.test.ts` | Migration contract tests |
| `src/domain/printing/printing.domain.test.ts` | Domain/security/lifecycle tests |
| `docs/printing-requests-phase1.md` | This report |

No production teacher/secretary UI was added.

---

## 2. Migrations created

1. `20250804120000_printing_requests_phase1.sql`
2. `20250804120100_printing_requests_phase1_commands.sql`

---

## 3. Tables / entities created

| Entity | Purpose |
|---|---|
| `printing_requests` | Parent job: number, teacher, institution, required_by, status, assignment, timestamps, `files_purged_at` |
| `print_items` | Per-document settings + storage reference + item status |
| `printing_request_audit_events` | Append-only audit trail |
| `printing_request_number_counters` | Institution-scoped human-readable numbers |
| `institutions.minimum_print_notice_minutes` | Advance-notice policy (default 60) |
| `institutions.deadline_warning_minutes` | Urgency contract (default 120) |
| `institutions.file_retention_days` | Retention contract (default **90**) |

Human-readable `request_number` is unique per institution and is **never** used in authorization predicates.

---

## 4. Storage changes

- Private bucket `printing-files` (`public = FALSE`)
- `file_size_limit = 52428800` (50 MB)
- Object paths: `{institution_id}/{request_id}/{item_id}/{system-uuid}`
- Original filename stored as metadata only on `print_items`

---

## 5. Authorization policies added

**Tables (SELECT only for `authenticated`; mutations via SECURITY DEFINER RPCs):**

- Teacher: own requests/items/audit via `teacher_user_id = auth.uid()` + active teacher helper
- Secretary / Manager: institution-scoped SELECT via existing role helpers
- No authenticated INSERT/UPDATE/DELETE grants on printing tables
- Audit: BEFORE UPDATE/DELETE reject triggers (append-only)

**Storage:**

- Teacher SELECT/INSERT on own unclaimed editable requests
- Secretary/Manager SELECT for own institution paths
- Bucket is not public

---

## 6. Backend operations / contracts added

| RPC | Actor |
|---|---|
| `printing_create_request` | Teacher (auth identity + institution from context) |
| `printing_update_request` | Teacher (pre-claim only) |
| `printing_cancel_request` | Teacher (pre-claim only) |
| `printing_claim_request` | Secretary/Manager (atomic Start Processing) |
| `printing_release_request` | Assignee or Manager |
| `printing_transfer_request` | Assignee or Manager → same-institution secretary |
| `printing_return_item_for_correction` | Assigned processor |
| `printing_resubmit_item` | Teacher |
| `printing_reject_item` | Assigned processor |
| `printing_mark_item_printed` | Assigned processor |
| `printing_update_institution_settings` | Secretary/Manager |
| `printing_validate_required_by` / `printing_derive_parent_status` | Helpers |

Client wrappers: `src/services/printingRequests.ts`  
Reads: RLS `select` by id (not by request number).  
Files: signed URLs via private bucket + storage RLS.

**Copies upper limit (documented):** `MAX_PRINT_COPIES = 500` (DB check + TS).

---

## 7. Lifecycle implementation

**Request:** `submitted | in_progress | needs_correction | printed | rejected | cancelled`  
**Item:** `pending | processing | returned_for_correction | resubmitted | printed | rejected`  

- Transition matrix enforced in `printing_item_transition_allowed` (SQL) and mirrored in TS tests
- Parent status derived by `printing_derive_parent_status` / `printing_sync_parent_status`
- Teacher edit/cancel locked when assigned or `processing_started_at` set
- Cancel is a state transition (`cancelled`), not physical delete

---

## 8. Deadline implementation

- Server validates `required_by >= now + minimum_print_notice_minutes`
- Uses institution settings; does **not** hardcode `Asia/Jerusalem`
- Callers must build `required_by` with institution timezone (reuse `institutions.timezone`)
- Policy changes are prospective; re-validated on teacher edit of `required_by`
- Overdue helper: `printing_is_overdue` / TS `isPrintingRequestOverdue` — does not change ownership
- `deadline_warning_minutes` persisted for later UI phases

---

## 9. Concurrent claim implementation

`printing_claim_request`:

1. `SELECT … FOR UPDATE` on the request row
2. Reject if already assigned (unless idempotent self-claim)
3. Conditional `UPDATE … WHERE assigned_secretary_user_id IS NULL`
4. Loser receives `PRINT_REQUEST_ALREADY_CLAIMED`

No automatic release on inactivity (intentional).

---

## 10. Audit implementation

`printing_request_audit_events` records at least:

- `request_created`, `request_edited`, `request_cancelled`
- `secretary_claimed`, `secretary_released`, `secretary_transferred`
- `item_returned_for_correction`, `item_resubmitted`, `item_rejected`, `item_marked_printed`
- `parent_request_completed`
- `institution_settings_updated` (nullable `printing_request_id`)

Append-only; no client INSERT grant.

---

## 11. Automated tests added

| File | Coverage |
|---|---|
| `printing.migration.test.ts` | Schema, private bucket, RLS, RPC surface, error codes, claim concurrency SQL, locks, transfer, settings auth |
| `printing.domain.test.ts` | File size/type, item limits, page selection, cutoff boundaries, cross-day + DST timezone, overdue, transitions, parent status, teacher lock, teacher/institution isolation, concurrent claim simulation, transfer rules |

---

## 12. Test results

```
npx vitest run src/domain/printing
```

| Result | Count |
|---|---|
| Test files passed | 2 |
| Tests passed | **33 / 33** |

---

## 13. Known limitations

1. **Migrations not applied** to staging/production in this change set — apply via the project’s normal linked SQL process before runtime verification.
2. **No live Postgres integration harness** — isolation/concurrency proven via migration SQL contracts + mirrored domain logic (same pattern as Meeting Calendar Phase 1). End-to-end DB race should be re-checked after apply.
3. **MIME allow-list is authoritative server-side**, but content magic-byte sniffing is not yet implemented; clients must send a detected type that must match the allow-list. Extension alone is never used for auth.
4. **Retention cleanup job** is not scheduled in Phase 1; model separates business history (`files_purged_at`) from storage objects for a later controlled purge.
5. **Standalone `add_item` RPC** is not separate — create/update accept the full 1–10 item payload (equivalent contract).

---

## 14. Architectural deviations

| Item | Notes |
|---|---|
| Dedicated printing audit table | Mirrors meeting-calendar pattern; not shared generic audit_logs |
| Settings on `institutions` columns | Matches existing institution config style (not a separate settings table) |
| Manager may claim/process | Aligns with “institution-level access per existing MPEX standards”; transfer target remains secretary-only |
| Paper sizes | Initial allow-list: `a4`, `a3`, `letter`, `legal` (not enumerated in the brief; required for CHECK constraints) |

No intentional weakening of Phase 1 security exit criteria.

---

## Security review checklist (evidence)

| Check | Evidence |
|---|---|
| No public printing bucket | Migration sets `public = FALSE`; test asserts |
| No frontend-controlled teacher ownership | RPC uses `auth.uid()` as `teacher_user_id` |
| No frontend-controlled institution ownership | `printing_resolve_actor_institution()` |
| No unrestricted status update | No authenticated UPDATE grant; transitions via RPCs |
| No client-only deadline validation | `printing_validate_required_by` in create/update |
| Request number not used for auth | Policies/RPCs key on UUID + role helpers |
| Cross-institution denied | RLS + `CROSS_INSTITUTION_ACCESS_DENIED` on transfer |
| Concurrent claim protected | `FOR UPDATE` + `assigned_secretary_user_id IS NULL` |
| 50 MB enforced backend | CHECK + payload validator + bucket limit |
| File-type allow-list backend | `printing_allowed_file_types` / `printing_is_allowed_file_type` |
| Audit recorded | `printing_write_audit` on required actions |
| Institution timezone for deadlines | Instant compare after institution-local construction; TZ from `institutions.timezone` |

---

## Exit criteria mapping

Teacher / institution / file isolation, private storage, limits, cutoff, locks, claim/release/transfer, lifecycle, parent derivation, and audit are implemented and covered by the automated suite above. **Phase 2 UI remains not approved** until these migrations are applied and any environment-level smoke checks the team requires are completed.
