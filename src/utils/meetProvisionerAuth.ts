/**
 * Pure auth gate mirrored for Vitest (Edge: _shared/requireServiceRole.ts).
 * meeting-meet-provisioner must only run when JWT role === service_role.
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
    const json = Buffer.from(padded, 'base64').toString('utf8')
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
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
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
