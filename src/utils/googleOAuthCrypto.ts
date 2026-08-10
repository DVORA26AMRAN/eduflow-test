/**
 * Google OAuth crypto helpers (browser / Vitest).
 * Edge Functions mirror this algorithm in supabase/functions/_shared/googleOAuthCrypto.ts.
 *
 * Token encryption: AES-256-GCM with random 12-byte nonce.
 * OAuth state: SHA-256 hash of high-entropy token (store hash only).
 */

const STATE_TOKEN_BYTES = 32
const PKCE_VERIFIER_BYTES = 32
const AES_GCM_NONCE_BYTES = 12

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64(base64: string): Uint8Array {
  // Strip whitespace first: Postgres encode(bytea, 'base64') emits MIME line breaks.
  // Padding must be computed from the cleaned length or atob throws InvalidCharacterError.
  const clean = base64.replace(/\s+/g, '')
  const normalized = clean.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateOAuthStateToken(): string {
  const bytes = new Uint8Array(STATE_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function hashOAuthStateToken(stateToken: string): Promise<string> {
  return sha256Hex(stateToken)
}

export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(PKCE_VERIFIER_BYTES)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function pkceChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toBase64Url(new Uint8Array(digest))
}

export async function importAesGcmKeyFromBase64(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64)
  if (raw.byteLength !== 32) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded).')
  }
  const keyBytes = new Uint8Array(raw)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptRefreshToken(
  plaintext: string,
  key: CryptoKey,
): Promise<{ ciphertextBase64: string; nonceBase64: string }> {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES)
  crypto.getRandomValues(nonce)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    ciphertextBase64: toBase64(new Uint8Array(ciphertext)),
    nonceBase64: toBase64(nonce),
  }
}

export async function decryptRefreshToken(
  ciphertextBase64: string,
  nonceBase64: string,
  key: CryptoKey,
): Promise<string> {
  const iv = new Uint8Array(fromBase64(nonceBase64))
  const ciphertext = new Uint8Array(fromBase64(ciphertextBase64))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

export type TokenEncryptionKeyRing = {
  activeKeyId: string
  activeKey: string
  previousKeyId: string | null
  previousKey: string | null
}

export async function decryptRefreshTokenWithKeyRing(
  ciphertextBase64: string,
  nonceBase64: string,
  encryptionKeyId: string | null | undefined,
  ring: TokenEncryptionKeyRing,
): Promise<{ plaintext: string; usedKeyId: string }> {
  const candidates: Array<{ keyId: string; keyB64: string }> = []

  if (encryptionKeyId === ring.activeKeyId) {
    candidates.push({ keyId: ring.activeKeyId, keyB64: ring.activeKey })
  } else if (encryptionKeyId && ring.previousKeyId === encryptionKeyId && ring.previousKey) {
    candidates.push({ keyId: ring.previousKeyId, keyB64: ring.previousKey })
  } else {
    candidates.push({ keyId: ring.activeKeyId, keyB64: ring.activeKey })
    if (ring.previousKeyId && ring.previousKey) {
      candidates.push({ keyId: ring.previousKeyId, keyB64: ring.previousKey })
    }
  }

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const key = await importAesGcmKeyFromBase64(candidate.keyB64)
      const plaintext = await decryptRefreshToken(ciphertextBase64, nonceBase64, key)
      return { plaintext, usedKeyId: candidate.keyId }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to decrypt refresh token with available key ring.')
}

/** Redact secrets from objects/strings before logging or returning to clients. */
export function redactSecretsForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[REDACTED]')
      .replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]')
      .replace(/"refresh_token"\s*:\s*"[^"]*"/gi, '"refresh_token":"[REDACTED]"')
      .replace(/"access_token"\s*:\s*"[^"]*"/gi, '"access_token":"[REDACTED]"')
      .replace(/code_verifier=[^&\s]+/gi, 'code_verifier=[REDACTED]')
      .replace(/https?:\/\/meet\.google\.com\/[^\s"']+/gi, '[REDACTED_MEET_URL]')
  }
  if (Array.isArray(value)) {
    return value.map(redactSecretsForLog)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|cipher|nonce|verifier|password/i.test(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactSecretsForLog(v)
      }
    }
    return out
  }
  return value
}

export type GoogleOAuthActorRole = 'institution_manager' | 'secretary' | 'teacher' | string

export function canStartGoogleOAuth(args: {
  role: GoogleOAuthActorRole
  status: string
  institutionId: string | null | undefined
}): boolean {
  if (args.status !== 'active') {
    return false
  }
  if (!args.institutionId) {
    return false
  }
  return args.role === 'institution_manager' || args.role === 'secretary'
}

export function resolveGoogleConnectionUiStatus(args: {
  connectionStatus: string | null | undefined
  connected: boolean
}): 'not_connected' | 'connected' | 'reauthorization_required' {
  if (args.connectionStatus === 'reauthorization_required') {
    return 'reauthorization_required'
  }
  if (args.connectionStatus === 'connected' || args.connected) {
    return 'connected'
  }
  return 'not_connected'
}
