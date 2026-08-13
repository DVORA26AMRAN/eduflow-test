# Release Gate 2 — Multi-Institution Validation

**Final verdict: RELEASE GATE 2 — PASS**  
**Date: 2026-08-13**

This document records the final verified state of Release Gate 2 (cross-institution isolation). It combines controlled live UI validation with backend / Storage / RLS investigations. It does not authorize code, RLS, Storage, migration, or deploy changes.

---

## 1. Executive summary

Release Gate 2 validates that tenant data for **Institution Anna** and **Institution Rama** remains isolated across requests, messages, attachments, printing, meetings/calendar, notifications, substitute board, and archive surfaces.

Controlled live UI tests and live-database policy inspection (where performed) confirm:

- Same-institution actors see only their institution’s data (as designed for each product surface).
- Foreign-institution authenticated users cannot see foreign requests, messages, attachments, printing jobs, or meetings in the UI.
- Direct-path Storage download and meeting UUID probes are blocked by live policies, not only by UI hiding.
- An earlier hypothesis of request cross-tenant exposure was **not reproduced** under controlled conditions and must **not** be treated as a confirmed production defect.

**RELEASE GATE 2 — PASS**

---

## 2. Institutions used in live validation

| Institution | Role in Gate 2 |
|-------------|----------------|
| **Anna** | Primary “home” tenant for request / attachment / message controls (e.g. Tamar, Rivka) |
| **Rama** | Second tenant for printing / meetings and as foreign peer for Anna-owned artifacts |

All “foreign” denial cases below mean: authenticated user whose `institution_id` is the other school.

---

## 3. Controlled request isolation

| Check | Result |
|-------|--------|
| Teacher **Tamar** (Anna) created request **TEST-TAMAR-1449** | Pass — persisted correctly |
| Tamar sees the request | Pass |
| Manager **Rivka** (Anna) sees the request | Pass |
| Rama user does **not** see the request | Pass |

**Conclusion:** Request row visibility is institution-correct under controlled validation.

---

## 4. Request message isolation

| Artifact | Result |
|----------|--------|
| Thread / case **TEST-MESSAGE-ANNA-ONLY** | Controlled Anna-only message validation |
| Tamar / Rivka (Anna) | Allowed |
| Rama user | Denied |

**Conclusion:** Request conversation / message visibility does not cross institutions in live UI validation.

---

## 5. Request attachment isolation

### Live UI

| Check | Result |
|-------|--------|
| Tamar (Anna) uploaded attachment on **TEST-TAMAR-1449** | Pass |
| Rivka (Anna) can see and download | Pass |
| Rama user cannot see request or attachment in UI | Pass |

### Backend / Storage investigation

| Item | Verified state |
|------|----------------|
| Bucket | `request-attachments` (**private**) |
| Path convention | `{institution_id}/{request_id}/{attachment_id}/{file_name}` |
| Metadata table | `public.request_attachments` |
| Live Storage SELECT | `request_attachments_storage_authorized_select` — request read auth + path↔request institution bind |
| Live Storage INSERT | Teacher insert bound to creator + path institution |
| Direct-path cross-institution download | **Not possible** under live policies |

**Storage isolation: PASS**

---

## 6. Printing isolation

### Live UI

| Check | Result |
|-------|--------|
| Teacher **Dina** (Rama) submitted a printing request | Pass |
| Secretary (Rama) can see it | Pass |
| Secretary (Anna) cannot see it | Pass |

### Backend / Storage investigation

| Item | Verified state |
|------|----------------|
| Tables | `printing_requests`, `print_items` (+ audit) |
| Bucket | `printing-files` (**private**) |
| Path convention | `{institution_id}/{printing_request_id}/{print_item_id}/{uuid}` |
| Live Storage policies | Teacher select/insert + staff select with request↔path institution bind (Gate 1 shape) |
| Direct-path cross-institution download | **Not possible** under live policies |
| Same-institution manager | Allowed on printing queue / files (staff policies) — intended/current |

**Printing isolation: PASS**

---

## 7. Meetings / calendar

### Live UI

| Check | Result |
|-------|--------|
| Meeting **MEET-RAMA-ONLY** created in Rama | Pass |
| Invited Rama teacher received invitation and accepted | Pass |
| Meeting appears on that teacher’s calendar | Pass |
| Uninvited Anna user does not see the meeting | Pass |

### Backend investigation

| Item | Verified state |
|------|----------------|
| Model | Participant-bound (`creator` / `requester` / `recipient` / `calendar_owner`); `meetings.institution_id` |
| Create | Same-institution actor↔recipient enforcement |
| SELECT RLS | Participant-only (not institution-wide staff queue) |
| Direct meeting UUID (foreign user) | **Deny** — details, slots, Meet live context, reminders |
| Reminder dispatcher / Meet provisioner | **service_role** JWT; not bypassable by knowing meeting id alone |
| `meeting_calendar_user_profile` | Live = self or same-institution only (Gate 1) |

**Meetings / calendar isolation: PASS**

---

## 8. Notifications

| Check | Result |
|-------|--------|
| Cross-institution notification visibility | **None observed** in live validation |

**Conclusion:** No Gate 2 failure from notifications under the controlled Anna/Rama exercises.

---

## 9. Substitute board / archive

| Surface | Result |
|---------|--------|
| Anna / Rama substitute board validation | **No cross-institution visibility observed** |
| Archive surfaces (as exercised) | **No cross-institution visibility observed** |

**Conclusion:** No Gate 2 failure from substitute board or archive under controlled validation.

---

## 10. Important investigation correction

Earlier investigation work briefly suggested possible **request** cross-tenant exposure (e.g. foreign teacher/secretary seeing another institution’s request).

**Final Gate 2 position:**

1. That behavior was **not reproduced** under controlled, labeled tests (distinct request aliases, clear Anna vs Rama actors).
2. Multiple test aliases / requests were initially mixed during exploration, which produced misleading signals.
3. Controlled validation established **correct tenant isolation** for requests (see §3).
4. The earlier hypothesis must **not** be classified as a **confirmed production defect**.

Any future regression work should use unique request labels, record actor institution, and capture Network + RLS evidence before claiming a hole.

---

## 11. Role / tenant matrix (Gate 2 final)

Legend: **A** = allow as designed · **D** = deny · **—** = not primary for that surface

| Actor | Anna request TEST-TAMAR-1449 | Anna attachment | Rama printing | MEET-RAMA-ONLY |
|-------|------------------------------|-----------------|---------------|----------------|
| Tamar (Anna teacher, creator) | A | A | — | — |
| Rivka (Anna manager) | A | A | — | — |
| Dina (Rama teacher, print creator) | D | D | A (own) | — |
| Rama secretary | D | D | A | — |
| Invited Rama meeting participant | D | D | — | A |
| Anna secretary (foreign to Rama print) | — | — | D | — |
| Uninvited Anna user (foreign to Rama meet) | — | — | — | D |
| Generic Rama user vs Anna request/message/attachment | D | D | — | — |

Meeting product model: **participant-only** (same-institution secretary/manager who are not participants do not get institution-wide meeting SELECT).

---

## 12. Defense-in-depth notes

1. **Table GRANTs** on some tables (`request_attachments`, meeting tables, etc.) may be broader than migration “SELECT/INSERT only” intent. Where **no RLS write policy** exists, PostgreSQL RLS remains **fail-closed** for INSERT/UPDATE/DELETE via the authenticated client.
2. **Future GRANT hygiene** is recommended (align live grants with least privilege) but is **not** required to claim Gate 2 PASS.
3. **Migration-history metadata** in tooling may not list every remote version cleanly; **live `pg_policies` / bucket flags** were used as the source of truth for Storage and meeting isolation investigations.
4. Meeting list/participant helpers are primarily **UUID-participant** bound; create-time same-institution plus participant membership blocks foreign UUID access. Optional future hardening: re-assert `institution_id` on all meeting SELECT paths (defense-in-depth only).

---

## 13. Regression requirements

Retain and/or add automated / scripted checks that:

1. **Requests:** Foreign JWT cannot SELECT Anna request by id; Anna creator/manager can.
2. **Messages:** Foreign JWT cannot read Anna-only conversation rows for labeled threads.
3. **Attachments:** Foreign JWT `createSignedUrl` on known Anna `request-attachments` path fails; Gate 1 architecture tests keep request+path institution bind.
4. **Printing:** Foreign secretary cannot list Rama `printing_requests`; foreign `createSignedUrl` on known `printing-files` path fails; path spoof (wrong institution prefix) fails.
5. **Meetings:** Foreign JWT cannot SELECT meeting by id / `get_live_context`; invited participant can after accept; `meeting_calendar_user_profile(foreign id)` returns empty; reminder dispatch / Meet claim require service_role.
6. **Labels:** Use unique fixtures (`TEST-TAMAR-*`, `TEST-MESSAGE-*`, `MEET-*-ONLY`) and never mix aliases across tenants in one run.
7. **Do not weaken RLS** or use service_role in client tests to “make isolation pass.”

Architecture anchors already in repo (non-exhaustive):

- `src/utils/releaseGate1MultiInstitutionIsolation.test.ts` (attachment/printing Storage hardening, meeting profile gate)
- Printing / meeting migration architecture tests under `src/services/` and `src/domain/printing/`

---

## 14. Final sign-off

| Field | Value |
|-------|--------|
| Gate | Release Gate 2 — Multi-institution isolation |
| Institutions | Anna, Rama |
| Controlled UI | Pass |
| Attachment Storage | Pass |
| Printing Storage / RLS | Pass |
| Meetings / calendar backend | Pass |
| Earlier cross-tenant request hypothesis | **Not confirmed** — do not treat as production defect |
| **Final verdict** | **RELEASE GATE 2 — PASS** |
| **Date** | **2026-08-13** |

---

*Document path: `docs/release-gate-2-multi-institution-validation.md`*  
*Investigation-only artifact — no implement/commit/push required by this gate sign-off.*
