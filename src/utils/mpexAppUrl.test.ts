import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MPEX_PRODUCTION_APP_ORIGIN,
  MPEX_PRODUCTION_SUPABASE_HOST,
  isLoopbackHostname,
  isMpexProductionSupabaseUrl,
  resolveMpexAppOrigin,
} from '../../supabase/functions/_shared/mpexAppUrl'

const PRODUCTION_SUPABASE_URL = `https://${MPEX_PRODUCTION_SUPABASE_HOST}`
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'

describe('mpexAppUrl production runtime signal', () => {
  it('treats the hosted eduflow Supabase host as production', () => {
    expect(isMpexProductionSupabaseUrl(PRODUCTION_SUPABASE_URL)).toBe(true)
    expect(isMpexProductionSupabaseUrl(`${PRODUCTION_SUPABASE_URL}/`)).toBe(true)
  })

  it('does not treat local Supabase or empty URL as production', () => {
    expect(isMpexProductionSupabaseUrl(LOCAL_SUPABASE_URL)).toBe(false)
    expect(isMpexProductionSupabaseUrl('http://localhost:54321')).toBe(false)
    expect(isMpexProductionSupabaseUrl('')).toBe(false)
    expect(isMpexProductionSupabaseUrl(undefined)).toBe(false)
    expect(isMpexProductionSupabaseUrl('not-a-url')).toBe(false)
  })

  it('does not infer production from APP_URL alone', () => {
    // Even if APP_URL is canonical, without production SUPABASE_URL this is not prod mode.
    expect(
      () =>
        resolveMpexAppOrigin({
          configuredAppUrl: MPEX_PRODUCTION_APP_ORIGIN,
          supabaseUrl: LOCAL_SUPABASE_URL,
        }),
    ).toThrow(/local development/i)
  })
})

describe('mpexAppUrl production APP_URL policy', () => {
  it('accepts exactly https://mpex.school', () => {
    expect(
      resolveMpexAppOrigin({
        configuredAppUrl: 'https://mpex.school',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toBe(MPEX_PRODUCTION_APP_ORIGIN)
    expect(
      resolveMpexAppOrigin({
        configuredAppUrl: 'https://mpex.school/',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toBe(MPEX_PRODUCTION_APP_ORIGIN)
  })

  it('rejects http://mpex.school', () => {
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: 'http://mpex.school',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toThrow(/production/i)
  })

  it('rejects localhost and loopback on production runtime', () => {
    for (const url of [
      'http://localhost:5173',
      'https://localhost',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
    ]) {
      expect(() =>
        resolveMpexAppOrigin({
          configuredAppUrl: url,
          supabaseUrl: PRODUCTION_SUPABASE_URL,
        }),
      ).toThrow(/production/i)
    }
  })

  it('rejects unexpected external HTTPS origins', () => {
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: 'https://evil.example',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toThrow(/production/i)
  })

  it('rejects deceptive mpex.school suffix/prefix hosts', () => {
    for (const url of [
      'https://mpex.school.evil.example',
      'https://evil.example/mpex.school',
      'https://evil-mpex.school',
      'https://www.mpex.school',
    ]) {
      expect(() =>
        resolveMpexAppOrigin({
          configuredAppUrl: url,
          supabaseUrl: PRODUCTION_SUPABASE_URL,
        }),
      ).toThrow(/production/i)
    }
  })

  it('rejects malformed and missing URLs', () => {
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: 'not a url',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toThrow(/absolute URL/i)
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: '',
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toThrow(/Missing env/i)
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: null,
        supabaseUrl: PRODUCTION_SUPABASE_URL,
      }),
    ).toThrow(/Missing env/i)
  })
})

describe('mpexAppUrl local development policy', () => {
  it('accepts authorized loopback origins when Supabase URL is local', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(
      resolveMpexAppOrigin({
        configuredAppUrl: 'http://localhost:5173',
        supabaseUrl: LOCAL_SUPABASE_URL,
      }),
    ).toBe('http://localhost:5173')
    expect(
      resolveMpexAppOrigin({
        configuredAppUrl: 'http://127.0.0.1:5173',
        supabaseUrl: 'http://localhost:54321',
      }),
    ).toBe('http://127.0.0.1:5173')
  })

  it('rejects non-loopback APP_URL even when not on production Supabase', () => {
    expect(() =>
      resolveMpexAppOrigin({
        configuredAppUrl: 'https://evil.example',
        supabaseUrl: LOCAL_SUPABASE_URL,
      }),
    ).toThrow(/local development/i)
  })
})

describe('clever-processor manager invite wiring', () => {
  const edge = readFileSync(
    resolve(process.cwd(), 'supabase/functions/clever-processor/index.ts'),
    'utf8',
  )

  it('uses shared resolveMpexAppOrigin for redirectTo and does not read browser origin', () => {
    expect(edge).toContain("from '../_shared/mpexAppUrl.ts'")
    expect(edge).toContain('resolveMpexAppOrigin')
    expect(edge).toContain('pickConfiguredAppUrl')
    expect(edge).toContain('resolveAppRedirectUrl()')
    expect(edge).toContain('redirectTo')
    expect(edge).not.toContain('window.location')
    expect(edge).not.toContain('request.headers.get(\'Origin\')')
    expect(edge).not.toContain('request.headers.get("Origin")')
  })

  it('keeps production fail-closed tied to SUPABASE_URL host constant', () => {
    const shared = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/mpexAppUrl.ts'),
      'utf8',
    )
    expect(shared).toContain(MPEX_PRODUCTION_SUPABASE_HOST)
    expect(shared).toContain(MPEX_PRODUCTION_APP_ORIGIN)
    expect(shared).toContain('isMpexProductionSupabaseUrl')
  })
})

describe('substitute-board APP_URL hardening', () => {
  it('validates APP_URL via resolveMpexAppOrigin before building CTA', () => {
    const dispatcher = readFileSync(
      resolve(process.cwd(), 'supabase/functions/substitute-board-email-dispatcher/index.ts'),
      'utf8',
    )
    expect(dispatcher).toContain('resolveMpexAppOrigin')
    expect(dispatcher).toContain('buildSubstituteBoardEmailCtaUrl(appOrigin)')
  })
})
