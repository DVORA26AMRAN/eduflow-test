/**
 * Service-role gate for privileged Edge workers (Meet provisioner, etc.).
 * verify_jwt=true alone is insufficient: anon/authenticated JWTs also pass the gateway.
 * Callers must present a JWT whose payload role claim is exactly "service_role".
 */

export type ServiceRoleAuthResult =
  | { ok: true; role: 'service_role' }
  | { ok: false; status: 401 | 403; error: 'unauthorized' | 'forbidden' }

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length < 2 || !parts[1]) {
    return null
  }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : // Deno / Node fallback
          (globalThis as { Buffer?: { from: (s: string, enc: string) => { toString: (e: string) => string } } })
            .Buffer?.from(padded, 'base64')
            .toString('utf8')
    if (!json) {
      return null
    }
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Equivalent to rejecting unless auth.jwt()->>'role' = 'service_role'.
 * Does not trust client-supplied role headers — only the JWT payload claim.
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

  // anon, authenticated, or any other role — never execute privileged workers.
  return { ok: false, status: 403, error: 'forbidden' }
}
