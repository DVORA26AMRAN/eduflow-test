#!/usr/bin/env node
/**
 * Copy-based Supabase Storage → Cloudflare R2 backup.
 *
 * Usage:
 *   node scripts/storage-backup/backup.mjs
 *
 * Required env (GitHub Secrets / operator shell — never commit):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID
 */
import { loadBackupEnv } from './env.mjs'
import { createR2Client, createSupabaseAdmin } from './clients.mjs'
import { backupProtectedBuckets } from './backup-core.mjs'
import { PROTECTED_SOURCE_BUCKETS } from './config.mjs'

async function main() {
  const env = loadBackupEnv()
  const supabase = createSupabaseAdmin(env)
  const r2 = createR2Client(env)

  console.info('[storage-backup] start', {
    buckets: PROTECTED_SOURCE_BUCKETS,
    destinationBucket: 'mpex-production-backup',
    model: 'copy-non-destructive',
  })

  const report = await backupProtectedBuckets(supabase, r2)

  // JSON line so Actions shows failure message/code/status (not nested "[Array]").
  console.info(
    `[storage-backup] summary ${JSON.stringify({
      ok: report.ok,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      discovered: report.discovered,
      uploaded: report.uploaded,
      skippedExisting: report.skippedExisting,
      failed: report.failed,
      bytesProcessed: report.bytesProcessed,
      buckets: report.buckets.map((b) => ({
        bucket: b.bucket,
        discovered: b.discovered,
        uploaded: b.uploaded,
        skippedExisting: b.skippedExisting,
        failed: b.failed,
        bytesProcessed: b.bytesProcessed,
        failures: b.failures.map((f) => ({
          phase: f.phase,
          message: f.message,
          ...(f.code ? { code: f.code } : {}),
          ...(f.status != null ? { status: f.status } : {}),
          ...(f.pathHash ? { pathHash: f.pathHash } : {}),
        })),
      })),
    })}`,
  )

  if (!report.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('[storage-backup] fatal', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
