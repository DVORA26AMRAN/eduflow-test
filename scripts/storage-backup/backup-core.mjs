import { createWriteStream, createReadStream } from 'node:fs'
import { unlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import {
  BACKUP_CONCURRENCY,
  ENUMERATION_PAGE_SIZE,
  MAX_ATTEMPTS,
  PROTECTED_SOURCE_BUCKETS,
  RETRY_BASE_DELAY_MS,
} from './config.mjs'
import { buildR2ObjectKey } from './paths.mjs'
import { getR2BackupBucketName } from './clients.mjs'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withBoundedRetry(label, fn, attempts = MAX_ATTEMPTS) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= attempts) {
        break
      }
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      console.warn(
        `[storage-backup] retry ${attempt}/${attempts} after ${label}: ${errorMessage(error)}`,
      )
      await sleep(delay)
    }
  }
  throw lastError
}

/**
 * Strip credentials / tokens from diagnostic text. Never log raw secrets.
 */
export function redactSecrets(text) {
  if (typeof text !== 'string' || text === '') {
    return ''
  }
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
      '[REDACTED_JWT]',
    )
    .replace(
      /(authorization|apikey|api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi,
      '$1:[REDACTED]',
    )
    .replace(/sb_secret_[A-Za-z0-9]+/gi, '[REDACTED_SB_SECRET]')
}

function pickErrorCode(error) {
  if (!error || typeof error !== 'object') return null
  const candidates = [error.code, error.error_code, error.error?.code]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return redactSecrets(value.trim()).slice(0, 64)
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function pickErrorStatus(error) {
  if (!error || typeof error !== 'object') return null
  const candidates = [
    error.status,
    error.statusCode,
    error.$metadata?.httpStatusCode,
    error.error?.status,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) {
      return Number(value.trim())
    }
  }
  return null
}

/**
 * Safe, structured error fields for logs/summaries (no secrets).
 * @returns {{ message: string, code: string | null, status: number | null }}
 */
export function sanitizeErrorForLog(error) {
  let raw = 'unknown_error'
  if (error && typeof error.message === 'string' && error.message.trim()) {
    raw = error.message.trim()
  } else if (error != null) {
    raw = String(error)
  }
  return {
    message: redactSecrets(raw).slice(0, 200),
    code: pickErrorCode(error),
    status: pickErrorStatus(error),
  }
}

export function errorMessage(error) {
  return sanitizeErrorForLog(error).message
}

/**
 * Flat diagnostic object safe for console / Actions logs.
 */
export function formatFailureDiagnostic(bucket, phase, error, extra = {}) {
  const safe = sanitizeErrorForLog(error)
  const diagnostic = {
    bucket,
    phase,
    message: safe.message,
  }
  if (safe.code) {
    diagnostic.code = safe.code
  }
  if (safe.status != null) {
    diagnostic.status = safe.status
  }
  if (typeof extra.pathHash === 'string' && extra.pathHash) {
    diagnostic.pathHash = extra.pathHash
  }
  return diagnostic
}

/** Print one failure as a single JSON line (avoids Node inspect collapsing arrays). */
export function logFailureDiagnostic(diagnostic) {
  console.error(`[storage-backup] failure ${JSON.stringify(diagnostic)}`)
}

function extractObjectSize(metadata) {
  if (!metadata || typeof metadata !== 'object') return null
  if (typeof metadata.size === 'number' && Number.isFinite(metadata.size)) {
    return metadata.size
  }
  if (typeof metadata.contentLength === 'number' && Number.isFinite(metadata.contentLength)) {
    return metadata.contentLength
  }
  return null
}

/**
 * Enumerate all object names in a Supabase Storage bucket via storage.objects.
 * Pagination is mandatory — never assume a single page.
 */
export async function enumerateBucketObjects(supabase, bucketId) {
  /** @type {{ name: string, size: number | null }[]} */
  const objects = []
  let from = 0

  for (;;) {
    const to = from + ENUMERATION_PAGE_SIZE - 1
    const { data, error } = await supabase
      .schema('storage')
      .from('objects')
      .select('name, metadata')
      .eq('bucket_id', bucketId)
      .order('name', { ascending: true })
      .range(from, to)

    if (error) {
      const safe = sanitizeErrorForLog(error)
      const wrapped = new Error(
        `enumerate failed for bucket=${bucketId}: ${safe.message}`,
      )
      if (safe.code) {
        wrapped.code = safe.code
      }
      if (safe.status != null) {
        wrapped.status = safe.status
      }
      throw wrapped
    }

    const rows = Array.isArray(data) ? data : []
    for (const row of rows) {
      if (typeof row?.name === 'string' && row.name.trim() !== '') {
        objects.push({
          name: row.name,
          size: extractObjectSize(row.metadata),
        })
      }
    }

    if (rows.length < ENUMERATION_PAGE_SIZE) {
      break
    }
    from += ENUMERATION_PAGE_SIZE
  }

  return objects
}

async function headDestination(r2, key) {
  try {
    const result = await r2.send(
      new HeadObjectCommand({
        Bucket: getR2BackupBucketName(),
        Key: key,
      }),
    )
    return {
      exists: true,
      contentLength:
        typeof result.ContentLength === 'number' ? result.ContentLength : null,
    }
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    const name = error?.name
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
      return { exists: false, contentLength: null }
    }
    throw error
  }
}

function tempBackupPath(bucketId) {
  const safe = bucketId.replace(/[^a-z0-9_-]/gi, '_')
  return join(
    tmpdir(),
    `mpex-storage-backup-${safe}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`,
  )
}

/**
 * Download one Supabase object to a temporary file (streaming when possible).
 * Caller must delete the file.
 */
export async function downloadSourceObjectToFile(
  supabase,
  bucketId,
  objectPath,
  destPath,
) {
  const { data, error } = await supabase.storage.from(bucketId).download(objectPath)
  if (error || !data) {
    throw new Error(`download failed bucket=${bucketId}: ${errorMessage(error)}`)
  }

  const webStream = typeof data.stream === 'function' ? data.stream() : null
  if (webStream) {
    await pipeline(Readable.fromWeb(webStream), createWriteStream(destPath))
  } else {
    const buffer = Buffer.from(await data.arrayBuffer())
    await pipeline(Readable.from(buffer), createWriteStream(destPath))
  }

  const info = await stat(destPath)
  return info.size
}

async function uploadDestinationFromFile(r2, key, filePath, contentLength) {
  await r2.send(
    new PutObjectCommand({
      Bucket: getR2BackupBucketName(),
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: contentLength,
    }),
  )
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath)
  } catch {
    // best-effort cleanup
  }
}

/**
 * Copy one object. Non-destructive: never deletes destination.
 * If destination exists with same size, skip re-upload (still success).
 */
export async function backupOneObject(supabase, r2, bucketId, objectPath, knownSize = null) {
  const r2Key = buildR2ObjectKey(bucketId, objectPath)

  const head = await withBoundedRetry(`head:${bucketId}`, () => headDestination(r2, r2Key))
  if (
    head.exists &&
    typeof knownSize === 'number' &&
    head.contentLength === knownSize
  ) {
    return {
      status: 'skipped_existing',
      bytes: knownSize,
      r2Key,
    }
  }

  const tempPath = tempBackupPath(bucketId)
  try {
    const bytes = await withBoundedRetry(`download:${bucketId}`, () =>
      downloadSourceObjectToFile(supabase, bucketId, objectPath, tempPath),
    )

    if (head.exists && head.contentLength === bytes) {
      return {
        status: 'skipped_existing',
        bytes,
        r2Key,
      }
    }

    await withBoundedRetry(`upload:${bucketId}`, () =>
      uploadDestinationFromFile(r2, r2Key, tempPath, bytes),
    )

    const verify = await withBoundedRetry(`verify:${bucketId}`, () =>
      headDestination(r2, r2Key),
    )
    if (!verify.exists || verify.contentLength !== bytes) {
      throw new Error(
        `integrity verification failed bucket=${bucketId} expectedBytes=${bytes} actual=${verify.contentLength}`,
      )
    }

    return {
      status: 'uploaded',
      bytes,
      r2Key,
    }
  } finally {
    await safeUnlink(tempPath)
  }
}

/**
 * Run workers over items with bounded concurrency.
 */
export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index], index)
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()))
  return results
}

export function createEmptyBucketSummary(bucketId) {
  return {
    bucket: bucketId,
    discovered: 0,
    uploaded: 0,
    skippedExisting: 0,
    failed: 0,
    bytesProcessed: 0,
    failures: [],
  }
}

export async function backupProtectedBuckets(supabase, r2, buckets = PROTECTED_SOURCE_BUCKETS) {
  const startedAt = new Date().toISOString()
  const summaries = []

  for (const bucketId of buckets) {
    const summary = createEmptyBucketSummary(bucketId)
    console.info(`[storage-backup] enumerating bucket=${bucketId}`)

    let objects
    try {
      objects = await enumerateBucketObjects(supabase, bucketId)
    } catch (error) {
      summary.failed = 1
      const diagnostic = formatFailureDiagnostic(bucketId, 'enumeration', error)
      summary.failures.push(diagnostic)
      logFailureDiagnostic(diagnostic)
      summaries.push(summary)
      continue
    }

    summary.discovered = objects.length
    console.info(`[storage-backup] discovered=${objects.length} bucket=${bucketId}`)

    await mapPool(objects, BACKUP_CONCURRENCY, async (entry) => {
      try {
        const result = await backupOneObject(
          supabase,
          r2,
          bucketId,
          entry.name,
          entry.size,
        )
        summary.bytesProcessed += result.bytes
        if (result.status === 'skipped_existing') {
          summary.skippedExisting += 1
        } else {
          summary.uploaded += 1
        }
      } catch (error) {
        summary.failed += 1
        const diagnostic = formatFailureDiagnostic(bucketId, 'object', error, {
          // Avoid logging full object paths (may contain sensitive filenames).
          pathHash: hashPathHint(entry.name),
        })
        summary.failures.push(diagnostic)
        logFailureDiagnostic(diagnostic)
      }
    })

    summaries.push(summary)
  }

  const totals = {
    startedAt,
    finishedAt: new Date().toISOString(),
    buckets: summaries,
    discovered: summaries.reduce((n, s) => n + s.discovered, 0),
    uploaded: summaries.reduce((n, s) => n + s.uploaded, 0),
    skippedExisting: summaries.reduce((n, s) => n + s.skippedExisting, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    bytesProcessed: summaries.reduce((n, s) => n + s.bytesProcessed, 0),
  }

  totals.ok = totals.failed === 0
  return totals
}

function hashPathHint(objectPath) {
  let hash = 0
  for (let i = 0; i < objectPath.length; i += 1) {
    hash = (hash * 31 + objectPath.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Architecture helper: backup never removes R2 objects when sources disappear. */
export function backupDeletesDestinationWhenSourceMissing() {
  return false
}

export function defaultBackupConcurrency() {
  return BACKUP_CONCURRENCY
}
