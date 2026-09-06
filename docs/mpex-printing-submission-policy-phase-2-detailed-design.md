# MPEX Printing Submission Policy — Phase 2 Detailed Design

Status: **Phase 2A LIVE PASS · Phase 2B UI IMPLEMENTED (not deployed) · Phase 2C NOT STARTED**  
Date: 2026-09-06  
Project: `kkafmsvntwqweudallty` (eduflow)  
Prerequisite: Printing Phase 1 minimum-notice validation + EXECUTE grant hardening **PASS** (committed/pushed)

---

## 0. Product decisions (final)

Institutions must configure how early teachers may submit printing requests.

**Settings UX choices (one active policy):**

| UI choice | Policy mode | Value |
|---|---|---|
| 30 minutes | relative notice | 30 |
| 60 minutes | relative notice | 60 |
| 2 hours | relative notice | 120 |
| 3 hours | relative notice | 180 |
| 1 day | relative notice | 1440 |
| Custom | relative notice | operator hours/minutes → minutes |
| By fixed morning time | daily cutoff | institution-local `TIME` (e.g. 08:00) |

**Daily cutoff rule (hard, no override):**

If daily cutoff is configured and the teacher submits **strictly after** that institution-local time, `required_by` **must not** fall on the **same institution-local calendar date** as “now”. Earliest allowed local date becomes **tomorrow**, subject only to other existing validation (file payload, auth, etc.).

There is **no** “send anyway”, warning-only path, or teacher override.

**Explicit non-goals for Phase 2:**

- Printing cycles / weekly submission windows
- Misusing `minimum_print_notice_minutes` as a daily cutoff encoding
- Redesigning the whole Printing workspace
- Changing Phase 1 EXECUTE grant posture beyond new/replaced RPC signatures

---

## 1. Semantic distinction (mandatory)

These are **different** policies. Exactly **one** is active per institution.

### A. Relative notice

```text
required_by >= server NOW() + minimum_print_notice_minutes
```

(Implemented today with strict `<` rejection ⇒ equality at the boundary is **accepted**.)

Authority: absolute `TIMESTAMPTZ` math. Institution timezone is **not** needed for the duration comparison once both sides are UTC instants.

### B. Daily morning cutoff

```text
After institution-local cutoff TIME on local date D:
  required_by’s institution-local date must be > D
  (i.e. earliest local calendar day = D+1)
```

Authority: `institutions.timezone` + `NOW()` + stored local `TIME` (not UTC `TIME`).

**Do not** encode cutoff as “minutes until 08:00” inside `minimum_print_notice_minutes`.

---

## 2. Current repository baseline (evidence)

| Concern | Current state |
|---|---|
| Relative notice column | `institutions.minimum_print_notice_minutes` DEFAULT 60, CHECK 0..10080 |
| Timezone | `institutions.timezone` IANA TEXT, NOT NULL, DEFAULT `'UTC'` (prod rows typically `Asia/Jerusalem`) |
| Validator | `printing_validate_required_by(institution_id, required_by)` — relative only; loads timezone but **unused** |
| Create | `printing_create_request` always validates |
| Update | `printing_update_request` validates only when `p_required_by IS NOT NULL` |
| Settings RPC | `printing_update_institution_settings(min, warning, retention)` — secretary **or** institution_manager; institution from `printing_resolve_actor_institution()` |
| Settings load | `loadInstitutionPrintingSettings` (RLS select) |
| Settings mutate UI | **None** — service wrapper exists, no callers |
| Teacher UX | Modal uses `isRequiredByTooLateClient` / Hebrew advance-notice copy |
| Daily cutoff / policy mode columns | **Do not exist** |

Ownership boundary for client I/O remains `src/services/printingRequests.ts` + `src/types/printing.ts` + domain helpers under `src/domain/printing/`.

---

## 3. Data model (smallest exclusive-mode design)

### 3.1 Recommended columns on `public.institutions`

| Column | Type | Default | Notes |
|---|---|---|---|
| `print_submission_policy_mode` | `TEXT NOT NULL` | `'relative_notice'` | Enum-like CHECK |
| `minimum_print_notice_minutes` | existing `INTEGER NOT NULL` | keep **60** | Authoritative **only** when mode = `relative_notice` |
| `print_daily_cutoff_local_time` | `TIME` (without time zone) | `NULL` | Authoritative **only** when mode = `daily_cutoff`; **never** store as UTC |

Optional retained columns (unchanged by this policy work):  
`deadline_warning_minutes`, `file_retention_days`, `timezone`.

### 3.2 Constraints

```text
CHECK (print_submission_policy_mode IN ('relative_notice', 'daily_cutoff'))

CHECK (
  (print_submission_policy_mode = 'relative_notice'
     AND minimum_print_notice_minutes BETWEEN 0 AND 10080)
  OR
  (print_submission_policy_mode = 'daily_cutoff'
     AND print_daily_cutoff_local_time IS NOT NULL)
)
```

Additional product validation in RPC (not necessarily DB CHECK):

- Relative presets / custom: minutes in `0..10080` (reuse existing range).
- Custom UI may prefer a tighter UX range (e.g. 1 minute .. 7 days) but must not exceed DB CHECK.
- Daily cutoff: any valid `TIME` (00:00–23:59:59). Product example is morning (08:00); architecture does not forbid afternoon cutoffs.
- When mode = `relative_notice`, `print_daily_cutoff_local_time` **may be NULL** (preferred) or left stale; **server must ignore** it. Prefer clearing to NULL on save to relative mode for clarity.
- When mode = `daily_cutoff`, `minimum_print_notice_minutes` is **ignored for enforcement**. Prefer leaving the last relative value intact so switching back restores prior notice without silent reset to 60.

### 3.3 Migration / default behavior (no silent product change)

Forward-only `ALTER TABLE … ADD COLUMN`:

1. Add `print_submission_policy_mode TEXT NOT NULL DEFAULT 'relative_notice'`.
2. Add `print_daily_cutoff_local_time TIME NULL`.
3. Add CHECKs above.
4. **Do not** UPDATE existing `minimum_print_notice_minutes`.
5. **Do not** rewrite any `printing_requests` rows.

Result: every existing institution remains on **relative notice** with its current minutes value (typically 60). Behavior unchanged until an authorized secretary/manager explicitly switches mode.

Rollback safety: forward-only; if a later hotfix must disable daily mode, a follow-up migration can force `print_submission_policy_mode = 'relative_notice'` without touching request rows. No destructive DROP of notice column.

### 3.4 Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Encode cutoff as sentinel notice minutes | Semantic collision; breaks relative math |
| Store cutoff as `TIMESTAMPTZ` or UTC `TIME` | Cutoff is a **civil clock** in institution TZ; DST would corrupt meaning |
| Two simultaneously active policies | Product requires exclusive OR |
| New table for policy | Unnecessary for one row per institution |

---

## 4. Server-side enforcement

### 4.1 Authority

| Signal | Authority |
|---|---|
| “Now” | PostgreSQL `NOW()` (`TIMESTAMPTZ`) |
| Timezone | `institutions.timezone` (IANA) |
| Policy config | Institution columns above |
| Client clock / browser TZ / `Origin` | **Never** |

UI gates are UX only.

### 4.2 Locus

Keep a single helper as the enforcement core:

`printing_validate_required_by(p_institution_id UUID, p_required_by TIMESTAMPTZ) → TEXT`

Extend it to branch on `print_submission_policy_mode`.

Call sites (unchanged wiring):

- `printing_create_request` — always
- `printing_update_request` — when `p_required_by IS NOT NULL`

No new client-writable path to tables.

### 4.3 Relative mode (preserve)

```sql
v_now := NOW();
-- load minimum_print_notice_minutes
IF p_required_by < (v_now + make_interval(mins => v_notice)) THEN
  RETURN 'PRINT_REQUEST_TOO_LATE';
END IF;
RETURN NULL;
```

Boundary: **exact equality accepted**; only strictly earlier than `NOW()+notice` rejected.

### 4.4 Daily-cutoff mode

Conceptual algorithm (PostgreSQL):

```sql
v_now          := NOW();                                      -- timestamptz
v_tz           := institutions.timezone;                      -- e.g. Asia/Jerusalem
v_local_ts     := v_now AT TIME ZONE v_tz;                    -- timestamp without time zone
v_local_date   := v_local_ts::date;
v_local_time   := v_local_ts::time;
v_cutoff       := institutions.print_daily_cutoff_local_time; -- time without time zone
v_req_local_date := (p_required_by AT TIME ZONE v_tz)::date;

-- Absolute floor: required_by must not be in the past (same boundary style as notice=0)
IF p_required_by < v_now THEN
  RETURN 'PRINT_REQUEST_TOO_LATE';  -- or keep dedicated code; see §4.5
END IF;

IF v_local_time > v_cutoff THEN
  -- strictly after cutoff ⇒ same local calendar day forbidden
  IF v_req_local_date <= v_local_date THEN
    RETURN 'PRINT_REQUEST_SAME_DAY_CLOSED';
  END IF;
END IF;

-- at or before cutoff: same local day allowed (and any future local day)
RETURN NULL;
```

#### Cutoff boundary (final)

| Local condition | Same-day `required_by` |
|---|---|
| `local_time < cutoff` | Allowed (plus past-floor) |
| `local_time = cutoff` | **Allowed** |
| `local_time > cutoff` | **Rejected** |

Matches product preference and mirrors relative-mode “exact boundary accepted”.

#### Why `AT TIME ZONE` is safe here

- `timestamptz AT TIME ZONE iana` yields the civil timestamp in that zone, correctly applying DST rules for that instant.
- Comparing `::date` values compares **institution-local calendar dates**, not UTC dates.
- Comparing `::time` to stored `TIME` compares civil clock-of-day in the same zone interpretation.
- DST spring-forward / fall-back affects which UTC instant maps to a local wall time; for **policy**, we only need “what is the local date/time of `NOW()`?” and “what local date is `required_by`?” — both answered consistently via the same `AT TIME ZONE` conversion.

**Do not** hardcode `Asia/Jerusalem`. Invalid/missing timezone should fail closed (`INVALID_PRINT_SETTINGS` / institution misconfiguration) rather than silently using UTC if product later adds stricter TZ validation; today timezone is already NOT NULL with IANA text.

### 4.5 Error codes

| Code | When |
|---|---|
| `PRINT_REQUEST_TOO_LATE` | Relative notice violation; also absolute past floor in daily mode |
| `PRINT_REQUEST_SAME_DAY_CLOSED` | **New** — daily mode, after cutoff, `required_by` local date ≤ today |
| `INVALID_PRINT_SETTINGS` | Bad settings payload / inconsistent mode fields |
| `SECRETARY_NOT_AUTHORIZED` | Teacher/deputy/other on settings RPC |

Prefer a **distinct** same-day code so teacher UI can show cutoff-specific Hebrew without parsing notice minutes.

Extend `PrintingErrorCode` / RPC result parsers accordingly in Phase 2A/2C.

### 4.6 Prospective settings changes

When secretary/manager changes mode or values:

- **Existing** `printing_requests.required_by` rows are **not** rewritten.
- **New** creates use the new policy immediately.
- **Updates** that change `required_by` re-validate against the **current** policy.
- Updates that omit `required_by` do not re-check the stored instant.

Same prospective semantics as Phase 1 relative notice.

---

## 5. Settings authorization

Preserve existing gate inside extended `printing_update_institution_settings`:

| Actor | Configure? |
|---|---|
| secretary (active, same institution) | **Yes** |
| institution_manager (active, same institution) | **Yes** |
| teacher | **No** |
| deputy | **No** (D2 left settings on secretary/manager) |
| Cross-institution | **Impossible** — institution from `printing_resolve_actor_institution()`, no client institution id |

**Extend** the existing settings RPC; do **not** add direct `UPDATE` on `institutions` for these columns.

### 5.1 Suggested RPC signature evolution

Replace/extend:

```text
printing_update_institution_settings(
  p_minimum_print_notice_minutes INTEGER DEFAULT NULL,
  p_deadline_warning_minutes INTEGER DEFAULT NULL,
  p_file_retention_days INTEGER DEFAULT NULL,
  p_print_submission_policy_mode TEXT DEFAULT NULL,
  p_print_daily_cutoff_local_time TIME DEFAULT NULL
) → JSONB
```

Rules:

- Partial updates remain COALESCE-style for warning/retention.
- Mode switch must be explicit: when setting `daily_cutoff`, require non-null cutoff time in the same call (or already stored).
- When setting `relative_notice`, require notice minutes in-range (param or existing column).
- Audit payload must include mode + cutoff + notice fields.
- **Grants:** recreate EXECUTE grants for the new signature only to `authenticated` (Phase 1 hardening pattern: revoke PUBLIC/anon/service_role). Drop obsolete overload if signature arity changes.

Service wrapper: extend `updateInstitutionPrintingSettings` in `printingRequests.ts` — no new service module.

---

## 6. Secretary / manager UX (Phase 2B)

**Implementation status: authored in repo (not deployed).**

### 6.1 Placement

Compact panel `PrintingSubmissionPolicySettings` inside existing
`SecretaryPrintingWorkspace` (`DashboardSection title="הדפסות"`), above the
פעילות / היסטוריה tabs.

Shared by secretary and institution_manager dashboards (same workspace mount).
Not mounted for teacher or deputy.

### 6.2 Controls (Hebrew product copy)

Question: `כמה זמן מראש מורות צריכות לשלוח להדפסה?`

Radio options:

1. 30 דקות מראש → relative 30  
2. שעה מראש → relative 60  
3. שעתיים מראש → relative 120  
4. 3 שעות מראש → relative 180  
5. יום מראש → relative 1440  
6. זמן אחר → hours + minutes → total minutes (no raw-minutes entry)  
7. עד שעה קבועה באותו יום → `<input type="time">`

Helpers: `src/utils/printingSubmissionPolicy.ts`  
Service: `updateInstitutionPrintingSettings` only (no direct table writes).

### 6.3 Consequence copy (before save)

Daily:

> לאחר שעה זו לא ניתן לשלוח בקשת הדפסה להיום.

Also: time follows the institution clock configured in the system (no IANA jargon in UI).

### 6.4 Save states

| State | Behavior |
|---|---|
| Unchanged | Save disabled; “אין שינויים לשמירה” |
| Dirty | Save enabled |
| Saving | Controls disabled; prevents duplicate submit |
| Success | Local saved state updated; status message |
| Error | Safe Hebrew error; form values preserved |

No save on panel open / initialization.

### 6.5 Out of scope in 2B

Teacher policy banner and date disabling → **Phase 2C**.

---

## 7. Teacher UX (Phase 2C)

### 7.1 Policy visibility

Before choosing `required_by`, show active policy:

| Mode | Example Hebrew |
|---|---|
| Relative 60 | יש לשלוח בקשת הדפסה לפחות שעה מראש. |
| Relative custom | יש לשלוח בקשת הדפסה לפחות {formatted duration} מראש. |
| Daily 08:00 | להדפסה היום יש לשלוח עד 08:00. |

Reuse/extend `advanceNoticeHebrewMessage` (or sibling helpers) in `src/utils/printingUi.ts`.

### 7.2 After cutoff (daily mode)

Using **institution timezone** + **server-aligned** “now” is ideal; practical client approach:

- Compute institution-local now via `Intl` + `institutions.timezone` (UX).
- If `localTime > cutoff`: disable **today** in the date picker; default earliest selectable date to **tomorrow**; show explanation that today’s submission window closed.
- Still submit through existing create/update RPCs; handle `PRINT_REQUEST_SAME_DAY_CLOSED` / `PRINT_REQUEST_TOO_LATE` safely if UI is bypassed or clock skews.

### 7.3 Relative mode teacher gate

Keep existing client mirror (`isPrintingRequestTooLate`) updated only for relative mode; daily mode uses date-disable logic instead of subtracting minutes from `required_by`.

---

## 8. API / type impact (likely)

| Area | Change |
|---|---|
| `InstitutionPrintingSettings` | Add `print_submission_policy_mode`, `print_daily_cutoff_local_time` |
| `loadInstitutionPrintingSettings` | Select + return new fields |
| `updateInstitutionPrintingSettings` | Pass mode + cutoff; keep warning/retention |
| `PRINTING_RPC` / parsers | New error code; settings audit shape |
| `printing_validate_required_by` SQL + migration tests | Mode branch + TZ cases |
| `isPrintingRequestTooLate` / new `isPrintingSameDayClosed` domain helpers | Client mirrors |
| `TeacherPrintingArea` / `TeacherPrintingRequestModal` | Policy banner + date constraints |
| `SecretaryPrintingWorkspace` (+ tests) | Settings panel |
| Hebrew UI helpers / `printingUi.test.ts` | Copy + gating |

No separate settings microservice. No Edge Function required for this policy.

---

## 9. Test plan

### 9.1 Relative (domain + SQL static / integration where available)

- 60-minute: before boundary rejected; exact boundary accepted; after accepted  
- Custom notice (e.g. 30, 120, 1440)  
- Existing DST relative tests remain green  

### 9.2 Daily cutoff

- Before cutoff, `required_by` today → accept  
- Exactly at cutoff, today → accept  
- After cutoff, today → reject (`PRINT_REQUEST_SAME_DAY_CLOSED`)  
- After cutoff, tomorrow → accept  
- `required_by` whose **UTC date** differs from institution-local date but local date is today → treated as **today**  
- Institution timezone respected (e.g. `Asia/Jerusalem` vs `UTC`)  
- DST case: spring-forward / fall-back day — local date/time derivation stable  

### 9.3 Authorization

- secretary allowed; manager allowed  
- teacher denied; deputy denied  
- cross-institution impossible (no institution param)  

### 9.4 Migration contracts

- grant-only posture preserved for new/replaced settings signature  
- CHECK enforces mode/cutoff consistency  
- defaults leave existing institutions on relative  

### 9.5 UI

- preset selection maps to correct mode/minutes  
- custom hours/minutes → minutes  
- daily cutoff time picker  
- teacher policy text per mode  
- today disabled after cutoff  
- server error surfaced safely  

---

## 10. Implementation phases (do not implement yet)

### Phase 2A — Database model + RPC enforcement + tests

- Migration: new columns + CHECKs + defaults  
- Extend `printing_validate_required_by`  
- Extend `printing_update_institution_settings` (+ EXECUTE grants for new signature)  
- Domain TS mirrors + migration/domain tests  
- **No** secretary UI, **no** teacher UX polish beyond keeping relative path working  

**Exit:** relative behavior unchanged for existing rows; daily mode enforceable via RPC/tests.

### Phase 2B — Secretary/manager settings UI

- Panel in `SecretaryPrintingWorkspace`  
- Wire load/update service fields  
- Consequence copy, save/success/error  
- Component tests  

**Exit:** authorized operators can switch modes without SQL.

### Phase 2C — Teacher policy visibility + date restrictions + integration validation

- Policy banner copy  
- Daily: disable today after cutoff; earliest tomorrow  
- Error-code handling  
- Focused UI + optional linked integration checks  

**Exit:** teachers understand and cannot casually select forbidden same-day dates; server remains authority.

---

## 11. Dirty tree / collision risks (2026-09-06)

`git status --short` shows **no dirty Printing source paths**. Phase 1 printing grant migration + migration tests + Phase 1 doc are already committed.

Unrelated dirty/untracked work present (must not mix into Phase 2 implementation commits):

- Quotation / Registration / Agreement migrations & UI  
- `docs/mpex-production-app-origin-hardening.md` (minor dirty)  
- `.env.example`, `supabase/config.toml`  
- fonts / PDF edge functions / tmp / scripts  

**Collision risk:** low for Printing Phase 2A–2C **if** commits stay isolated to printing migrations, `src/domain/printing/**`, `src/services/printingRequests.ts`, `src/types/printing.ts`, teacher/secretary printing components, and printing docs. Avoid `git add .`.

This design task modifies **only** this document.

---

## 12. Open implementation notes (non-blocking)

1. Exact Hebrew strings for all presets can be finalized in 2B/2C with product copy review.  
2. Whether past-floor in daily mode reuses `PRINT_REQUEST_TOO_LATE` vs a second code — recommend reuse for past, distinct code for same-day closed.  
3. Clearing vs retaining `print_daily_cutoff_local_time` when switching to relative — prefer clear-on-save for audit clarity.  
4. Optional later: validate `institutions.timezone` against a known IANA allow-list — out of Phase 2 scope unless live data proves invalid TZs.

---

## 13. Design acceptance checklist

| Item | Status |
|---|---|
| Exclusive relative XOR daily model | Specified |
| No misuse of notice minutes as cutoff | Specified |
| Existing institutions unchanged at migrate | Specified |
| Cutoff boundary: exact accepted / after rejected | Specified |
| Timezone authority = `institutions.timezone` | Specified |
| Server enforcement in validate helper + create/update | Specified |
| Settings auth preserved | Specified |
| Secretary + teacher UX sketched | Specified |
| Phases 2A/2B/2C | Specified |
| Implementation authorized | **NO** |
