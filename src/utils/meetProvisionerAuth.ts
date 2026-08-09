/**
 * Pure auth gate mirrored for Vitest (Edge: _shared/requireServiceRole.ts).
 * meeting-meet-provisioner must only run when JWT role === service_role.
 *
 * Browser-safe: uses TextEncoder / btoa / atob — no Node Buffer.
 * This only inspects JWT payload shape for unit tests; it does not hold secrets.
 */

export type ServiceRoleAuthResult =
  | { ok: true; role: 'service_role' }
  | { ok: false; status: 401 | 403; error: 'unauthorized' | 'forbidden' }

function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64ToUtf8(base64: string): string {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length < 2 || !parts[1]) {
    return null
  }
  try {
    const json = base64ToUtf8(parts[1])
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Build an unsigned JWT-shaped token for unit tests (payload only is inspected). */
export function buildTestJwt(payload: Record<string, unknown>): string {
  const header = utf8ToBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = utf8ToBase64Url(JSON.stringify(payload))
  return `${header}.${body}.test-signature`
}

/**
 * Equivalent to rejecting unless auth.jwt()->>'role' = 'service_role'.
 */
export function requireServiceRoleJwt(
  authorizationHeader: string | null | undefined,
): ServiceRoleAuthResult {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i)
  if (!match || !match[1] || !match[1].trim()) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  const token = match[1].trim()
  const payload = decodeJwtPayload(token)
  if (!payload) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  const role = typeof payload.role === 'string' ? payload.role : null
  if (role === 'service_role') {
    return { ok: true, role: 'service_role' }
  }

  return { ok: false, status: 403, error: 'forbidden' }
}
