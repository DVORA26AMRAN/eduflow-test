# Storage Backup & Restore Runbook (MPEX B2)

Independent, copy-based backup of production Supabase Storage objects into the
private Cloudflare R2 bucket `mpex-production-backup`.

**Status: B2 Backup & Restore = PASS** (controlled restore drill completed).

---

## Architecture

| Concern | Choice |
| --- | --- |
| Execution | GitHub Actions (outside Supabase) |
| Source | Supabase Production Storage |
| Destination | Cloudflare R2 `mpex-production-backup` (public access disabled) |
| Model | **Copy-based / non-destructive** — missing source objects do **not** delete R2 copies |
| Key layout | `supabase-storage/<bucket>/<original-object-path>` |
| Protected buckets | `request-attachments`, `printing-files` |

Add future protected buckets only in `scripts/storage-backup/config.mjs`
(`PROTECTED_SOURCE_BUCKETS`).

---

## Secrets

Repository secrets (never commit, never log, never write into manifests):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`

R2 credentials must remain **Object Read & Write** on `mpex-production-backup`
only (no R2 Admin).

The utilities fail closed if any required variable is missing.

After any accidental local exposure of R2 credentials: roll the R2 access key,
update GitHub Secrets with the new values, re-run backup, and clear local
sensitive environment variables. Do not record secret values in this document.

---

## Automated backup

Workflow: `.github/workflows/storage-backup.yml`

- **Schedule:** daily (`17 2 * * *` UTC)
- **Manual:** Actions → `storage-backup` → Run workflow (`workflow_dispatch`)
- **Concurrency:** `storage-backup-production` with `cancel-in-progress: false`
  (no uncontrolled overlapping runs)
- **Permissions:** `contents: read`
- **Artifacts:** source objects are **not** uploaded as GitHub artifacts

Local / operator equivalent (with secrets in the environment only):

```bash
npm run storage:backup
# or
node scripts/storage-backup/backup.mjs
```

### Summary fields

Each run logs a non-secret summary:

- source bucket(s)
- objects discovered / uploaded / skipped-existing / failed
- bytes processed
- start/finish timestamps
- failure phases (`enumeration` vs `object`)

A run with any failed object exits non-zero (workflow FAILED). Partial copies
already written remain usable; the overall run still fails visibly.

### Observability checklist

From the Actions run:

1. Did today's backup run?
2. Did it succeed (green) or fail (red)?
3. How many objects were discovered / uploaded / failed?
4. Which bucket failed (summary `buckets[].bucket`)?
5. Was failure during enumeration or object copy (`failurePhases`)?

Do not log secret values or object contents. Full filenames are avoided in
failure records (path hash hint only).

---

## Restore (operator-controlled only)

There is **no** scheduled restore. Restore is a disaster-recovery action.

```bash
npm run storage:restore -- --bucket request-attachments --path "<exact-object-path>"

# Explicit overwrite only when intentional:
npm run storage:restore -- --bucket request-attachments --path "<exact-object-path>" --overwrite
```

Or:

```bash
node scripts/storage-backup/restore.mjs --bucket printing-files --path "<exact-object-path>"
```

Alternative: `--r2-key supabase-storage/<bucket>/<path>`.

**Default:** refuse overwrite if the Supabase object already exists.

---

## Controlled restore drill (operator procedure)

Use a **non-sensitive** / disposable application attachment only — never
irreplaceable production data. Prefer an institution-bound path created via the
normal UI:

`{institution_id}/{request_id}/{attachment_id}/{filename}`

1. Upload a disposable attachment through the application into
   `request-attachments` (or `printing-files` for printing drills).
2. Trigger backup (`workflow_dispatch` or `npm run storage:backup`).
3. Confirm the R2 key exists:
   `supabase-storage/<bucket>/<exact-path>`
4. Record size / integrity evidence (R2 head Content-Length vs source).
5. Delete **only** the Supabase Storage object bytes. Keep
   `public.request_attachments` (or equivalent) metadata intact. Do not touch R2.
6. Restore from R2 **without** `--overwrite` (should recreate at the exact path).
7. Confirm the object exists again at the **exact** original Storage path.
8. Confirm an authorized app download succeeds.
9. Confirm unauthorized cross-institution access remains denied.

---

## Controlled restore drill — completed evidence (B2 PASS)

**Verdict: B2 Backup & Restore = PASS**

| Evidence | Result |
| --- | --- |
| Automated GitHub Actions `storage-backup` workflow | Succeeds (schedule / manual) |
| Protected source buckets | `request-attachments`, `printing-files` |
| Destination | Private Cloudflare R2 `mpex-production-backup` |
| Real request attachment backed up to R2 | Confirmed |
| Controlled deletion | Supabase Storage object bytes only; `request_attachments` metadata row retained |
| Restore source | Cloudflare R2 → exact original Supabase Storage path |
| Restore result | `bucket: request-attachments`, `bytes: 1675292`, `overwrite: false` |
| Authorized application access (Institution A) | Restored attachment opened/downloaded successfully |
| Cross-institution isolation (Institution B) | Institution B user could not see Institution A requests after restore |
| Credential hygiene | R2 credentials rolled after accidental local exposure; GitHub Secrets updated; backup re-run succeeded with new credentials; local sensitive env vars removed after the drill |

Do not store secret values, access keys, tokens, or credential material in this
runbook or in Release Gate notes.

---

## Retention

R2 copies are **not** deleted by production retention cleanup (e.g. printing
lifecycle). No R2 lifecycle deletion policy is introduced in this phase without
architecture approval.

---

## Failure modes (expected visible FAIL)

- Supabase or R2 authentication failure
- Source enumeration failure
- Download / upload failure after bounded retries (3 attempts)
- Integrity verification failure (destination size mismatch)

Retries are bounded — no infinite retry loops.

---

## Acceptance criteria (B2 PASS)

All criteria evidenced:

- [x] Daily automated backup exists
- [x] Manual backup invocation works
- [x] `request-attachments` protected
- [x] `printing-files` protected
- [x] R2 remains private
- [x] Destination backup is non-destructive
- [x] Backup failure is visible
- [x] Pagination is proven
- [x] Secrets remain outside source control/logs
- [x] A real object has been backed up successfully
- [x] A controlled object has been restored successfully
- [x] Exact original object path is preserved
- [x] Application can access the restored object normally
- [x] Cross-institution authorization remains enforced
- [x] Runbook exists
- [x] Tests / lint / build pass
