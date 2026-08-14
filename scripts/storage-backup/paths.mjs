import { R2_KEY_PREFIX } from './config.mjs'

/**
 * Build the deterministic R2 object key for a Supabase Storage object.
 * Preserves full original path under supabase-storage/<bucket>/<path>.
 *
 * @param {string} sourceBucket
 * @param {string} objectPath - full object key within the source bucket (no leading slash)
 */
export function buildR2ObjectKey(sourceBucket, objectPath) {
  if (typeof sourceBucket !== 'string' || sourceBucket.trim() === '') {
    throw new Error('sourceBucket is required')
  }
  if (typeof objectPath !== 'string' || objectPath.trim() === '') {
    throw new Error('objectPath is required')
  }
  if (sourceBucket.includes('/') || sourceBucket.includes('\\')) {
    throw new Error('sourceBucket must not contain path separators')
  }
  const normalized = objectPath.replace(/^\/+/, '').replace(/\\/g, '/')
  if (normalized === '' || normalized.includes('..')) {
    throw new Error('objectPath is invalid')
  }
  return `${R2_KEY_PREFIX}/${sourceBucket}/${normalized}`
}

/**
 * Parse an R2 backup key back into source bucket + object path.
 * @param {string} r2Key
 * @returns {{ sourceBucket: string, objectPath: string }}
 */
export function parseR2ObjectKey(r2Key) {
  const prefix = `${R2_KEY_PREFIX}/`
  if (typeof r2Key !== 'string' || !r2Key.startsWith(prefix)) {
    throw new Error('r2Key must start with supabase-storage/')
  }
  const rest = r2Key.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error('r2Key must be supabase-storage/<bucket>/<object-path>')
  }
  return {
    sourceBucket: rest.slice(0, slash),
    objectPath: rest.slice(slash + 1),
  }
}

/**
 * True when destination semantics are copy-only (never delete R2 when source disappears).
 * Used by architecture tests and docs; backup CLI must never call DeleteObject for sync.
 */
export function isNonDestructiveBackupModel() {
  return true
}
