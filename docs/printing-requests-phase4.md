# MPEX Printing Requests — Phase 4 Completion Report

Status: **IMPLEMENTED + OPS VERIFIED — production blocked on concurrent-claim smoke**  
System: MPEX  
Feature: Printing Requests  
Phase: 4 — Notifications, Corrections, Retention and Production Readiness  
Date: 2026-08-05 (validation refresh)

---

## 1. Files changed / added

### Migrations
- `supabase/migrations/20250804200000_printing_requests_phase4.sql`
- `supabase/migrations/20250804210000_printing_requests_phase4_schedules.sql` (pg_cron jobs; left as-is after apply)

### Edge workers
- `supabase/functions/printing-overdue-dispatcher/index.ts`
- `supabase/functions/printing-retention-cleanup/index.ts`
- `supabase/config.toml` — `verify_jwt = true` for both workers

### App
- `src/types/printing.ts` — Phase 4 error codes
- `src/utils/printingUi.ts` — Hebrew error map
- `src/utils/printingNotifications.ts` (+ tests)
- `src/services/printingRequests.ts` — purge-aware file access + list fields
- Teacher correction: `TeacherPrintItemCorrectionModal.tsx` (+ test)
- `MyPrintingRequestsPanel.tsx` — returned-item correction UX
- Teacher deep links: `TeacherPrintingArea` / `TeacherRequestsSection` / `TeacherDashboardPage` / `TeacherNotificationsSection`
- Staff overdue deep links: `AdminNotificationsSection` / `AdminNotificationsList` + Secretary/Manager dashboards
- `SecretaryPrintingWorkspace.tsx` — resubmitted indicator, purge gating, `focusRequestId`

### Docs / smoke
- `docs/printing-requests-phase4.md` (this report)
- `scripts/printing-concurrent-claim-smoke.mjs`

---

## 2–3. Migrations / backend operations

| Operation | Purpose |
|---|---|
| `printing_emit_notification` | Idempotent insert via unique indexes |
| `printing_notify_teacher_*` | Completed / returned / rejected |
| Patched return / reject / mark-printed / resubmit RPCs | Emit + correction polish |
| `printing_dispatch_overdue_notifications` | Service-role overdue fan-out |
| `printing_list_retention_purge_candidates` | Bounded eligible batch |
| `printing_mark_item_file_purged` | Metadata after storage delete |
| Storage INSERT policy update | Teacher correction upload while claimed |

Columns: `printing_requests.overdue_notified_at`, `print_items.file_purged_at`

---

## 4–6. Notification integration

Reuses `public.notifications` (no parallel bus).

Types:
- `PRINT_REQUEST_COMPLETED`
- `PRINT_ITEM_RETURNED_FOR_CORRECTION`
- `PRINT_ITEM_REJECTED`
- `PRINT_REQUEST_OVERDUE`

**Deduplication:** partial unique indexes + `unique_violation` swallow. Overdue also sets `overdue_notified_at`. Completion uses `completed:<request_id>` once.

Metadata: request number / filename / reason — never storage paths or signed URLs.

Deep links:
- Teacher → My Printing Requests (`focusRequestId`)
- Staff overdue → printing workspace details (`focusRequestId`; auth still enforced)

---

## 7–9. Correction / resubmission / request state

- Correction CTA only for `returned_for_correction`
- Resubmit via `printing_resubmit_item` (backend-owned transitions)
- Assignment preserved when present; shared queue if released
- Parent status backend-derived (`needs_correction` → `in_progress` → `printed`)
- Cutoff not re-applied on correction; `required_by` unchanged

---

## 10–12. Overdue / retention workers

| Worker | Auth | Schedule | Batch |
|---|---|---|---|
| `printing-overdue-dispatcher` | service_role (`verify_jwt=true` + app gate) | `*/15 * * * *` | 50 |
| `printing-retention-cleanup` | service_role (`verify_jwt=true` + app gate) | `15 2 * * *` | 50 |

Structural cron pattern (unchanged; Meet cron body not inspected): `pg_cron` → `net.http_post` using Vault secret **names** `PROJECT_PUBLISHABLE_KEY` and `CRON_SERVICE_ROLE_KEY`.

### Deploy status (2026-08-05)

| Function | Version | Status | verify_jwt |
|---|---|---|---|
| `printing-overdue-dispatcher` | 1 | ACTIVE | true |
| `printing-retention-cleanup` | 1 | ACTIVE | true |

| Cron job | jobid | schedule |
|---|---|---|
| `printing-overdue-dispatcher` | 2 | `*/15 * * * *` |
| `printing-retention-cleanup` | 3 | `15 2 * * *` |

Schedules left as-is (no re-apply).

### Invocation verification (2026-08-05)

Authorized (Vault names only; batch_size 5):
- overdue `request_id=1997` → HTTP **200** — scanned 0, emitted 0
- retention `request_id=1998` → HTTP **200** — scanned 0, purged 0, failed 0

Anonymous (no Authorization):
- overdue `request_id=1999` → HTTP **401** `UNAUTHORIZED_NO_AUTH_HEADER`
- retention `request_id=2000` → HTTP **401** `UNAUTHORIZED_NO_AUTH_HEADER`

---

## 13–16. Audit / errors / a11y / security

Audit: lifecycle + `notification_emitted` + `file_purged`.  
Phase 4 error codes mapped in UI.  
Correction/deep-link UX: RTL, labels, keyboard-friendly controls.  
Workers service-role only; private storage; no public anonymous worker access (verified).

---

## 17. Production concurrency validation

Script: `scripts/printing-concurrent-claim-smoke.mjs`

**Result (2026-08-05): `BLOCKED_BY_CREDENTIAL_AVAILABILITY`**

- Approved environment had neither `DATABASE_URL` nor `SUPABASE_DB_PASSWORD`
- Smoke exited without connecting; no credentials were printed or searched from logs
- Phase 1 SQL claim guards remain in place; true two-client race still **mandatory** before production

---

## 18–20. Tests

**Local automated results (2026-08-04):**

| Suite | Result |
|---|---|
| Phase 4 + Phase 1 core printing helpers | **43/43 passed** |
| Full printing Phase 1–4 component/domain path | **44/44 passed** (7 files) |

Additional deep-link / admin notification tests added later in Phase 4 follow-up (staff overdue navigation).

---

## 21. Remote migration verification

**APPLIED AND VERIFIED** (`20250804200000_printing_requests_phase4.sql`):
- columns, RPCs, dedupe indexes, `PRINT_*` notification types in CHECK

Schedule migration applied once; left as-is thereafter.

---

## 22–23. Limitations / deviations

1. Screenshots (§49) not attached.
2. Concurrent claim smoke blocked by credential availability.
3. Overdue recipients: assigned secretary, else active institution secretaries.
4. Retention clock uses terminal request timestamp (no separate `completed_at`).
5. Unrelated Meet diagnostic artifacts intentionally excluded from Printing production surface.
6. No urgent-request / printer-control scope introduced.

---

## 24. Production-readiness recommendation

| Exit criterion area | Status |
|---|---|
| Notifications + correction + retention backend | Done |
| Remote Phase 4 migration | Done |
| Edge deploy + schedules + auth rejection | Done |
| Authorized worker invoke | Done |
| Local Phase 1–4 automated tests | Green (prior run) |
| True two-client concurrent claim | **BLOCKED_BY_CREDENTIAL_AVAILABILITY** |
| Screenshots | Optional / not attached |

### Verdict

**PRINTING REQUESTS ARE NOT APPROVED FOR PRODUCTION.**

Remaining mandatory gate: provide `DATABASE_URL` or `SUPABASE_DB_PASSWORD` in the approved environment and re-run `node scripts/printing-concurrent-claim-smoke.mjs` until exactly one claim succeeds and one fails with `PRINT_REQUEST_ALREADY_CLAIMED`.
