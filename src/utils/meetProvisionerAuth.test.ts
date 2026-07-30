import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTestJwt,
  requireServiceRoleJwt,
} from './meetProvisionerAuth'

const workerPath = resolve(
  process.cwd(),
  'supabase/functions/meeting-meet-provisioner/index.ts',
)
const sharedGatePath = resolve(
  process.cwd(),
  'supabase/functions/_shared/requireServiceRole.ts',
)

describe('meeting-meet-provisioner service_role gate', () => {
  const worker = readFileSync(workerPath, 'utf8')
  const sharedGate = readFileSync(sharedGatePath, 'utf8')

  it('enforces service_role inside the Edge Function (not verify_jwt alone)', () => {
    expect(worker).toContain('requireServiceRoleJwt')
    expect(worker).toContain("auth.error")
    expect(worker).toMatch(/status:\s*403|auth\.status/)
    expect(worker).toContain('getBearerToken(request)')
    expect(sharedGate).toContain("role === 'service_role'")
    expect(sharedGate).toContain("status: 403")
    expect(sharedGate).toContain("error: 'forbidden'")
  })

  it('rejects missing Authorization / no JWT with 401', () => {
    expect(requireServiceRoleJwt(null)).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    })
    expect(requireServiceRoleJwt(undefined)).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    })
    expect(requireServiceRoleJwt('')).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    })
    expect(requireServiceRoleJwt('Basic abc')).toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    })
  })

  it('rejects anon JWT with 403', () => {
    const anonJwt = buildTestJwt({ role: 'anon', iss: 'supabase' })
    expect(requireServiceRoleJwt(`Bearer ${anonJwt}`)).toEqual({
      ok: false,
      status: 403,
      error: 'forbidden',
    })
  })

  it('rejects authenticated user JWT with 403', () => {
    const userJwt = buildTestJwt({
      role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000001',
      iss: 'supabase',
    })
    expect(requireServiceRoleJwt(`Bearer ${userJwt}`)).toEqual({
      ok: false,
      status: 403,
      error: 'forbidden',
    })
  })

  it('accepts service_role JWT', () => {
    const serviceJwt = buildTestJwt({ role: 'service_role', iss: 'supabase' })
    expect(requireServiceRoleJwt(`Bearer ${serviceJwt}`)).toEqual({
      ok: true,
      role: 'service_role',
    })
  })
})
