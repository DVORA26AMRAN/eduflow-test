/**
 * Storage backup configuration — protected Supabase buckets → Cloudflare R2.
 * Add future protected buckets to PROTECTED_SOURCE_BUCKETS only.
 */

export const R2_BACKUP_BUCKET = 'mpex-production-backup'

/** Destination key prefix root under the R2 backup bucket. */
export const R2_KEY_PREFIX = 'supabase-storage'

/**
 * Production buckets that must be copied to R2.
 * Order is stable for reporting; membership is the contract.
 */
export const PROTECTED_SOURCE_BUCKETS = Object.freeze([
  'request-attachments',
  'printing-files',
])

/** Page size for storage.objects enumeration (must paginate; never assume one page). */
export const ENUMERATION_PAGE_SIZE = 100

/** Max concurrent object copy operations (bounded memory). */
export const BACKUP_CONCURRENCY = 2

/** Bounded retries for download/upload/head. */
export const MAX_ATTEMPTS = 3

export const RETRY_BASE_DELAY_MS = 500
