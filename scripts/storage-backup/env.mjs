/**
 * Fail-closed env loading for backup/restore. Never log secret values.
 */

function requireEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

export function loadBackupEnv() {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    r2AccessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    r2AccountId: requireEnv('R2_ACCOUNT_ID'),
  }
}

export function createR2Endpoint(accountId) {
  if (typeof accountId !== 'string' || accountId.trim() === '') {
    throw new Error('R2_ACCOUNT_ID is required')
  }
  return `https://${accountId.trim()}.r2.cloudflarestorage.com`
}
