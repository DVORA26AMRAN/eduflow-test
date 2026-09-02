import { afterEach, describe, expect, it, vi } from 'vitest'

const resetPasswordForEmail = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  },
}))

import {
  MPEX_PRODUCTION_ORIGIN,
  PASSWORD_RECOVERY_CONFIRMATION_MESSAGE,
  PASSWORD_RECOVERY_INVALID_EMAIL_MESSAGE,
  isValidPasswordRecoveryEmail,
  normalizePasswordRecoveryEmail,
  requestPasswordRecoveryEmail,
  resolvePasswordRecoveryRedirectTo,
} from './passwordRecovery'

describe('passwordRecovery redirect', () => {
  it('uses production origin on mpex.school hosts', () => {
    expect(
      resolvePasswordRecoveryRedirectTo({
        origin: 'https://mpex.school',
        hostname: 'mpex.school',
      }),
    ).toBe(MPEX_PRODUCTION_ORIGIN)
    expect(
      resolvePasswordRecoveryRedirectTo({
        origin: 'https://www.mpex.school',
        hostname: 'www.mpex.school',
      }),
    ).toBe(MPEX_PRODUCTION_ORIGIN)
  })

  it('uses the Vite local origin for development hosts', () => {
    expect(
      resolvePasswordRecoveryRedirectTo({
        origin: 'http://127.0.0.1:5173',
        hostname: '127.0.0.1',
      }),
    ).toBe('http://127.0.0.1:5173')
    expect(
      resolvePasswordRecoveryRedirectTo({
        origin: 'http://localhost:5173',
        hostname: 'localhost',
      }),
    ).toBe('http://localhost:5173')
  })

  it('never derives redirect from query-like untrusted input', () => {
    // Location shape has no search/hash fields by design; callers cannot inject redirectTo.
    const redirect = resolvePasswordRecoveryRedirectTo({
      origin: 'http://localhost:5173',
      hostname: 'localhost',
    })
    expect(redirect).toBe('http://localhost:5173')
    expect(redirect).not.toContain('evil')
  })
})

describe('passwordRecovery email validation', () => {
  it('normalizes and validates email syntax', () => {
    expect(normalizePasswordRecoveryEmail('  User@School.EDU ')).toBe('user@school.edu')
    expect(isValidPasswordRecoveryEmail('user@school.edu')).toBe(true)
    expect(isValidPasswordRecoveryEmail('not-an-email')).toBe(false)
    expect(isValidPasswordRecoveryEmail('')).toBe(false)
  })
})

describe('requestPasswordRecoveryEmail', () => {
  afterEach(() => {
    resetPasswordForEmail.mockReset()
  })

  it('rejects invalid email without calling Auth', async () => {
    const result = await requestPasswordRecoveryEmail('bad')

    expect(result).toEqual({
      ok: false,
      message: PASSWORD_RECOVERY_INVALID_EMAIL_MESSAGE,
    })
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('calls resetPasswordForEmail with controlled local redirect', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    const result = await requestPasswordRecoveryEmail('  Teacher@School.edu ', {
      locationLike: { origin: 'http://localhost:5173', hostname: 'localhost' },
    })

    expect(resetPasswordForEmail).toHaveBeenCalledWith('teacher@school.edu', {
      redirectTo: 'http://localhost:5173',
    })
    expect(result).toEqual({
      ok: true,
      message: PASSWORD_RECOVERY_CONFIRMATION_MESSAGE,
    })
  })

  it('calls resetPasswordForEmail with production redirect on mpex.school', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    await requestPasswordRecoveryEmail('teacher@school.edu', {
      locationLike: { origin: 'https://mpex.school', hostname: 'mpex.school' },
    })

    expect(resetPasswordForEmail).toHaveBeenCalledWith('teacher@school.edu', {
      redirectTo: MPEX_PRODUCTION_ORIGIN,
    })
  })

  it('returns the same generic confirmation when Auth reports an error (anti-enumeration)', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: 'User not found', status: 404, code: 'user_not_found' },
    })

    const result = await requestPasswordRecoveryEmail('missing@school.edu', {
      locationLike: { origin: 'http://localhost:5173', hostname: 'localhost' },
    })

    expect(result).toEqual({
      ok: true,
      message: PASSWORD_RECOVERY_CONFIRMATION_MESSAGE,
    })
    expect(result.ok && result.message).not.toMatch(/not found|לא נמצא|לא קיימ/i)
  })
})
