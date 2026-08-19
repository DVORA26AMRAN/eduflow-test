/**
 * S3 Fail-Closed Profile Contract Tests.
 * Validates that missing/null/unknown status never grants operational access.
 *
 * Requirement numbers reference the S3 Fail-Closed task spec.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Session } from '@supabase/supabase-js'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const PROFILE_SERVICE = 'src/services/profile.ts'
const APP = 'src/App.tsx'
const TYPES = 'src/types/user.ts'

// ---------------------------------------------------------------------------
// Source-level contract assertions
// ---------------------------------------------------------------------------

describe('fail-closed profile contract — source assertions', () => {
  it('req 12: no fallback to active exists in profile parsing', () => {
    const profile = read(PROFILE_SERVICE)
    // The old fail-open pattern must not exist
    expect(profile).not.toContain(": 'active'")
    expect(profile).not.toMatch(/\?\s*['"]active['"]\s*:/g)
  })

  it('req 11: users.status is part of required profile SELECT', () => {
    const profile = read(PROFILE_SERVICE)
    expect(profile).toContain('select=id,full_name,primary_role,status,institution_id')
  })

  it('req 6: missing/null/unrecognized status returns ok: false (fail closed)', () => {
    const profile = read(PROFILE_SERVICE)
    expect(profile).toContain("row.status !== 'active' && row.status !== 'inactive'")
    // Produces a load failure, not a dashboard
    expect(profile).toContain('סטטוס חשבון לא ידוע')
    expect(profile).toContain("ok: false")
  })

  it('req 6: AuthenticatedUserProfile.status is a strict union — not string', () => {
    const types = read(TYPES)
    expect(types).toContain("UserAccountStatus = 'active' | 'inactive'")
    expect(types).toContain('status: UserAccountStatus')
    // AuthenticatedUserProfile must not use loose string for status
    const profileTypeBlock = types.slice(
      types.indexOf('AuthenticatedUserProfile = {'),
      types.indexOf('}', types.indexOf('AuthenticatedUserProfile = {')),
    )
    expect(profileTypeBlock).not.toContain('status: string')
  })

  it('req 2: App shows inactive-account screen for explicit inactive only', () => {
    const app = read(APP)
    expect(app).toContain("currentProfile.status !== 'active'")
    expect(app).toContain('החשבון אינו פעיל')
  })

  it('req 8: profile error state uses existing ProfileLoadErrorPage (safe exit)', () => {
    const app = read(APP)
    expect(app).toContain('ProfileLoadErrorPage')
    expect(app).toContain('profileLoadError')
  })

  it('req 7: inactive screen provides logout', () => {
    const app = read(APP)
    const inactiveBlock = app.slice(
      app.indexOf("currentProfile.status !== 'active'"),
      app.indexOf('const loginSuccessTransition'),
    )
    expect(inactiveBlock).toContain('logout()')
    expect(inactiveBlock).toContain('יציאה מהמערכת')
  })

  it('req 10: Platform Admin is subject to the same status guard', () => {
    const app = read(APP)
    const inactiveCheckPos = app.indexOf("currentProfile.status !== 'active'")
    const platformAdminPos = app.indexOf("currentProfile.role === 'platform_admin'")
    // The inactive/unknown check fires BEFORE platform_admin routing
    expect(inactiveCheckPos).toBeGreaterThan(0)
    expect(platformAdminPos).toBeGreaterThan(inactiveCheckPos)
  })
})

// ---------------------------------------------------------------------------
// Runtime: loadCurrentUserProfile unit tests via mocked fetch
// ---------------------------------------------------------------------------

vi.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
    },
  },
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-anon-key',
}))

function makeSession(userId = 'user-1', email = 'test@test.com'): Session {
  return {
    user: { id: userId, email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    refresh_token: 'mock-refresh-token',
  } as unknown as Session
}

function mockFetchResponse(body: unknown, status = 200) {
  const responseText = JSON.stringify(body)
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(responseText),
  })
}

const validInstitution = {
  id: 'inst-1',
  name: 'בית ספר',
  timezone: 'Asia/Jerusalem',
  logo_url: null,
  logo_updated_at: null,
}

async function callLoadProfile() {
  const { loadCurrentUserProfile } = await import('../services/profile')
  return loadCurrentUserProfile(makeSession(), 'test')
}

describe('fail-closed profile contract — runtime unit tests', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('req 1: explicit active profile → ok: true', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מנהלת',
      primary_role: 'institution_manager',
      status: 'active',
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile.status).toBe('active')
    }
  })

  it('req 2: explicit inactive profile → ok: true with status inactive', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מורה',
      primary_role: 'teacher',
      status: 'inactive',
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile.status).toBe('inactive')
    }
  })

  it('req 3: missing status field → ok: false (fail closed)', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מורה',
      primary_role: 'teacher',
      // status field absent
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(false)
  })

  it('req 4: null status → ok: false (fail closed)', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מורה',
      primary_role: 'teacher',
      status: null,
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(false)
  })

  it('req 5: unknown/garbage status → ok: false (fail closed)', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מורה',
      primary_role: 'teacher',
      status: 'suspended',
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(false)
  })

  it('req 6: status=true (boolean, malformed) → ok: false', async () => {
    mockFetchResponse([{
      id: 'user-1',
      full_name: 'מורה',
      primary_role: 'teacher',
      status: true,
      institution_id: 'inst-1',
      institutions: validInstitution,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(false)
  })

  it('req 10: platform_admin active → ok: true (no institution required)', async () => {
    mockFetchResponse([{
      id: 'admin-1',
      full_name: 'אדמין',
      primary_role: 'platform_admin',
      status: 'active',
      institution_id: null,
      institutions: null,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile.status).toBe('active')
      expect(result.profile.role).toBe('platform_admin')
    }
  })

  it('req 10: platform_admin with missing status → ok: false (same guard applies)', async () => {
    mockFetchResponse([{
      id: 'admin-1',
      full_name: 'אדמין',
      primary_role: 'platform_admin',
      // status absent
      institution_id: null,
      institutions: null,
    }])
    const result = await callLoadProfile()
    expect(result.ok).toBe(false)
  })
})
