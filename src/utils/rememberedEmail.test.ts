import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REMEMBERED_EMAIL_STORAGE_KEY,
  clearRememberedEmail,
  getInitialLoginFormState,
  getRememberedEmail,
  handleRememberMeAfterLogin,
  saveRememberedEmail,
} from './rememberedEmail'

describe('rememberedEmail', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when no remembered email exists', () => {
    expect(getRememberedEmail()).toBeNull()
  })

  it('populates initial login state from remembered email', () => {
    localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, 'teacher@school.edu')

    expect(getInitialLoginFormState()).toEqual({
      email: 'teacher@school.edu',
      rememberMe: true,
    })
  })

  it('stores normalized email only after successful login when checked', () => {
    handleRememberMeAfterLogin(true, '  Manager@School.EDU ')

    expect(getRememberedEmail()).toBe('manager@school.edu')
    expect(localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY)).toBe('manager@school.edu')
  })

  it('removes stored email after successful login when unchecked', () => {
    localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, 'teacher@school.edu')

    handleRememberMeAfterLogin(false, 'teacher@school.edu')

    expect(getRememberedEmail()).toBeNull()
  })

  it('does not write password to browser storage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    saveRememberedEmail('user@school.edu')

    for (const call of setItemSpy.mock.calls) {
      const [key, value] = call
      expect(key).toBe(REMEMBERED_EMAIL_STORAGE_KEY)
      expect(value).not.toContain('password')
      expect(value).not.toMatch(/secret|token|auth/i)
    }

    expect(localStorage.getItem('password')).toBeNull()
    expect(localStorage.getItem('adoflow.auth.password')).toBeNull()

    setItemSpy.mockRestore()
  })

  it('leaves remembered email unchanged when login handling is not invoked', () => {
    localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, 'teacher@school.edu')

    expect(getRememberedEmail()).toBe('teacher@school.edu')
  })

  it('clears remembered email via clearRememberedEmail', () => {
    saveRememberedEmail('user@school.edu')
    clearRememberedEmail()
    expect(getRememberedEmail()).toBeNull()
  })
})
