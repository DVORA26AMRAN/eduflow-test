/**
 * Encryption key rotation architecture (prepared; production rotation not executed).
 *
 * Schema:
 * - google_token_encryption_keys(key_id, status: active|decrypt_only|retired)
 * - user_google_connections.encryption_key_id
 *
 * Edge secrets:
 * - GOOGLE_TOKEN_ENCRYPTION_KEY_ID + GOOGLE_TOKEN_ENCRYPTION_KEY (active)
 * - GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS_ID + GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS (decrypt_only)
 *
 * Runbook (manual, future — do not auto-run):
 * 1. Generate new 32-byte key; set as active in secrets + insert registry row status=active
 * 2. Mark previous registry row status=decrypt_only; keep previous secret loaded
 * 3. Worker loop: list_connections_needing_reencrypt(target) → dual decrypt → encrypt with active
 *    → update_reencrypted_refresh_token
 * 4. When count=0, set previous registry status=retired; remove PREVIOUS secrets
 */

export const GOOGLE_TOKEN_ENCRYPTION_ACTIVE_KEY_ID_DEFAULT = 'v1'

export const GOOGLE_TOKEN_ENCRYPTION_KEY_STATUSES = [
  'active',
  'decrypt_only',
  'retired',
] as const

export type GoogleTokenEncryptionKeyStatus =
  (typeof GOOGLE_TOKEN_ENCRYPTION_KEY_STATUSES)[number]

export function selectDecryptKeyIds(args: {
  rowKeyId: string | null | undefined
  activeKeyId: string
  previousKeyId: string | null
}): string[] {
  if (args.rowKeyId === args.activeKeyId) {
    return [args.activeKeyId]
  }
  if (args.rowKeyId && args.previousKeyId && args.rowKeyId === args.previousKeyId) {
    return [args.previousKeyId]
  }
  const ids = [args.activeKeyId]
  if (args.previousKeyId) {
    ids.push(args.previousKeyId)
  }
  return ids
}

export function isReencryptNeeded(rowKeyId: string | null, activeKeyId: string): boolean {
  return rowKeyId != null && rowKeyId !== activeKeyId
}
