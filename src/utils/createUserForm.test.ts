import { describe, expect, it } from 'vitest'
import { validateCreateUserForm } from './createUserForm'

describe('validateCreateUserForm', () => {
  it('requires full name and email', () => {
    expect(
      validateCreateUserForm({
        fullName: '',
        email: 'a@b.com',
        role: 'teacher',
        phone: '',
        nationalId: '',
        jobTitle: '',
        weeklyHours: '',
      }).ok,
    ).toBe(false)

    expect(
      validateCreateUserForm({
        fullName: 'יעל',
        email: '',
        role: 'teacher',
        phone: '',
        nationalId: '',
        jobTitle: '',
        weeklyHours: '',
      }).ok,
    ).toBe(false)
  })

  it('allows optional phone, national id, job title, and weekly hours', () => {
    const result = validateCreateUserForm({
      fullName: ' יעל כהן ',
      email: ' yael@school.com ',
      role: 'teacher',
      phone: '',
      nationalId: '',
      jobTitle: '',
      weeklyHours: '',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).toEqual({
        fullName: 'יעל כהן',
        email: 'yael@school.com',
        role: 'teacher',
        phone: null,
        nationalId: null,
        jobTitle: null,
        weeklyHours: null,
      })
    }
  })

  it('rejects non-positive weekly hours when provided', () => {
    expect(
      validateCreateUserForm({
        fullName: 'יעל',
        email: 'yael@school.com',
        role: 'teacher',
        phone: '050',
        nationalId: '1',
        jobTitle: 'מחנכת',
        weeklyHours: '0',
      }).ok,
    ).toBe(false)

    expect(
      validateCreateUserForm({
        fullName: 'יעל',
        email: 'yael@school.com',
        role: 'teacher',
        phone: '',
        nationalId: '',
        jobTitle: '',
        weeklyHours: '-3',
      }).ok,
    ).toBe(false)

    expect(
      validateCreateUserForm({
        fullName: 'יעל',
        email: 'yael@school.com',
        role: 'teacher',
        phone: '',
        nationalId: '',
        jobTitle: '',
        weeklyHours: 'abc',
      }).ok,
    ).toBe(false)
  })

  it('accepts positive weekly hours including decimals', () => {
    const result = validateCreateUserForm({
      fullName: 'יעל',
      email: 'yael@school.com',
      role: 'teacher',
      phone: '050-1234567',
      nationalId: '123456789',
      jobTitle: 'מחנכת',
      weeklyHours: '22,5',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.weeklyHours).toBe(22.5)
      expect(result.values.phone).toBe('050-1234567')
      expect(result.values.nationalId).toBe('123456789')
      expect(result.values.jobTitle).toBe('מחנכת')
    }
  })
})
