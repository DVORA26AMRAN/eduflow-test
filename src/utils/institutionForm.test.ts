import { describe, expect, it } from 'vitest'
import {
  isValidInstitutionEmail,
  isValidInstitutionPhone,
  validateInstitutionForm,
} from './institutionForm'

describe('validateInstitutionForm', () => {
  const valid = {
    name: ' בית ספר הדוגמה ',
    institutionCode: ' 123456 ',
    address: ' רחוב הרצל 1 ',
    city: ' תל אביב ',
    phone: '03-1234567',
    email: ' School@Example.com ',
  }

  it('requires all fields after trimming', () => {
    expect(validateInstitutionForm({ ...valid, name: '   ' }).ok).toBe(false)
    expect(validateInstitutionForm({ ...valid, institutionCode: '' }).ok).toBe(false)
    expect(validateInstitutionForm({ ...valid, address: ' ' }).ok).toBe(false)
    expect(validateInstitutionForm({ ...valid, city: '' }).ok).toBe(false)
    expect(validateInstitutionForm({ ...valid, phone: '' }).ok).toBe(false)
    expect(validateInstitutionForm({ ...valid, email: '' }).ok).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(validateInstitutionForm({ ...valid, email: 'not-an-email' }).ok).toBe(false)
    expect(isValidInstitutionEmail('a@b.c')).toBe(true)
    expect(isValidInstitutionEmail('bad')).toBe(false)
  })

  it('accepts common Israeli phone formatting', () => {
    expect(isValidInstitutionPhone('050-1234567')).toBe(true)
    expect(isValidInstitutionPhone('+972 3 1234567')).toBe(true)
    expect(isValidInstitutionPhone('abc')).toBe(false)
  })

  it('returns trimmed normalized values on success', () => {
    const result = validateInstitutionForm(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).toEqual({
        name: 'בית ספר הדוגמה',
        institutionCode: '123456',
        address: 'רחוב הרצל 1',
        city: 'תל אביב',
        phone: '03-1234567',
        email: 'school@example.com',
      })
    }
  })
})
