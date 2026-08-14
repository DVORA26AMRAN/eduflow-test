# Storage Backup & Restore Runbook (MPEX B2)

Independent, copy-based backup of production Supabase Storage objects into the
private Cloudflare R2 bucket `mpex-production-backup`.

**Status rule:** B2 remains a **BLOCKER** until a controlled restore drill is
evidenced. This document describes how to operate backup/restore; it does not
by itself mark B2 PASS.

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

## Controlled restore drill (required before B2 PASS)

Use a **non-sensitive** test object only — never irreplaceable production data.

1. Upload a disposable test object into `request-attachments` or `printing-files`
   at a known path (e.g. under a dedicated drill prefix).
2. Trigger backup (`workflow_dispatch` or `npm run storage:backup`).
3. Confirm the R2 key exists:
   `supabase-storage/<bucket>/<exact-path>`
4. Record size / integrity evidence (R2 head Content-Length vs source).
5. Remove or relocate the test object in Supabase (controlled).
6. Restore from R2 **without** `--overwrite` first (should recreate).
7. Confirm the object exists again at the **exact** original path.
8. Confirm an authorized app download succeeds.
9. Confirm unauthorized cross-institution access remains denied.

Record evidence (run URLs, sizes, timestamps) in the Release Gate notes.
Until this drill succeeds: **B2 = BLOCKER**.

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

Mark B2 PASS only when all are evidenced:

- [ ] Daily automated backup exists
- [ ] Manual backup invocation works
- [ ] `request-attachments` protected
- [ ] `printing-files` protected
- [ ] R2 remains private
- [ ] Destination backup is non-destructive
- [ ] Backup failure is visible
- [ ] Pagination is proven
- [ ] Secrets remain outside source control/logs
- [ ] A real object has been backed up successfully
- [ ] A controlled object has been restored successfully
- [ ] Exact original object path is preserved
- [ ] Application can access the restored object normally
- [ ] Cross-institution authorization remains enforced
- [ ] Runbook exists
- [ ] Tests / lint / build pass
