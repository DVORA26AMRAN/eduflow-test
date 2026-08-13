import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAuthCallbackFromUrl,
  detectAuthCallback,
  hasCompletedPasswordSetup,
} from './auth'

describe('detectAuthCallback', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('detects recovery from hash type', () => {
    window.history.replaceState(
      null,
      '',
      '/#access_token=tok&type=recovery&expires_in=3600',
    )

    expect(detectAuthCallback()).toEqual({
      isAuthCallback: true,
      isInviteFlow: true,
      isRecoveryFlow: true,
      code: null,
    })
  })

  it('detects invite from hash type', () => {
    window.history.replaceState(
      null,
      '',
      '/#access_token=tok&type=invite&expires_in=3600',
    )

    expect(detectAuthCallback()).toEqual({
      isAuthCallback: true,
      isInviteFlow: true,
      isRecoveryFlow: false,
      code: null,
    })
  })

  it('detects PKCE code in query without type', () => {
    window.history.replaceState(null, '', '/?code=abc123')

    expect(detectAuthCallback()).toEqual({
      isAuthCallback: true,
      isInviteFlow: false,
      isRecoveryFlow: false,
      code: 'abc123',
    })
  })

  it('detects recovery type in query string', () => {
    window.history.replaceState(null, '', '/?type=recovery&code=abc123')

    expect(detectAuthCallback()).toEqual({
      isAuthCallback: true,
      isInviteFlow: true,
      isRecoveryFlow: true,
      code: 'abc123',
    })
  })
})

describe('clearAuthCallbackFromUrl', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('clears recovery hash from the URL', () => {
    window.history.replaceState(
      null,
      '',
      '/#access_token=tok&type=recovery',
    )

    clearAuthCallbackFromUrl()

    expect(window.location.pathname).toBe('/')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
  })
})

describe('hasCompletedPasswordSetup', () => {
  it('returns true only when metadata flag is true', () => {
    expect(hasCompletedPasswordSetup({ user_metadata: { password_setup_complete: true } })).toBe(
      true,
    )
    expect(
      hasCompletedPasswordSetup({ user_metadata: { password_setup_complete: false } }),
    ).toBe(false)
    expect(hasCompletedPasswordSetup({ user_metadata: {} })).toBe(false)
    expect(hasCompletedPasswordSetup(null)).toBe(false)
  })
})

describe('supabase URL normalization', () => {
  it('strips accidental /rest/v1 from the env URL helper behavior', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/rest/v1/')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

    const { supabaseUrl } = await import('./supabase')

    expect(supabaseUrl).toBe('https://example.supabase.co')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
