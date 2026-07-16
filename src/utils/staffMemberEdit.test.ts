import { describe, expect, it } from 'vitest'
import { validateStaffMemberEdit } from './staffMemberEdit'

const validFields = {
  fullName: 'יעל כהן',
  phone: '',
  jobTitle: '',
  weeklyHours: '',
  nationalId: '',
}

describe('validateStaffMemberEdit', () => {
  it('requires a full name', () => {
    const result = validateStaffMemberEdit({ ...validFields, fullName: '   ' })
    expect(result).toEqual({ ok: false, errorMessage: 'שם מלא הוא שדה חובה.' })
  })

  it('allows empty optional fields', () => {
    const result = validateStaffMemberEdit(validFields)
    expect(result).toEqual({
      ok: true,
      values: {
        fullName: 'יעל כהן',
        phone: null,
        jobTitle: null,
        weeklyHours: null,
        nationalId: null,
      },
    })
  })

  it('requires positive weekly hours', () => {
    expect(validateStaffMemberEdit({ ...validFields, weeklyHours: '0' }).ok).toBe(false)
    expect(validateStaffMemberEdit({ ...validFields, weeklyHours: '-1' }).ok).toBe(false)
    expect(validateStaffMemberEdit({ ...validFields, weeklyHours: 'abc' }).ok).toBe(false)
  })

  it('normalizes optional text and decimal weekly hours', () => {
    const result = validateStaffMemberEdit({
      fullName: ' יעל כהן ',
      phone: ' 050-1234567 ',
      jobTitle: ' מחנכת ',
      weeklyHours: '22,5',
      nationalId: ' 123456789 ',
    })

    expect(result).toEqual({
      ok: true,
      values: {
        fullName: 'יעל כהן',
        phone: '050-1234567',
        jobTitle: 'מחנכת',
        weeklyHours: 22.5,
        nationalId: '123456789',
      },
    })
  })
})
