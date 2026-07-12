import { describe, expect, it } from 'vitest'
import {
  GENERAL_REQUEST_MESSAGE_MAX_LENGTH,
  GENERAL_REQUEST_SUBJECT_MAX_LENGTH,
  validateGeneralRequestForm,
} from './generalRequest'

const emptyFields = {
  recipientRole: '' as const,
  subject: '',
  message: '',
}

describe('validateGeneralRequestForm', () => {
  it('requires recipient selection', () => {
    const result = validateGeneralRequestForm({
      ...emptyFields,
      subject: 'נושא',
      message: 'הודעה',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('נמען')
    }
  })

  it('requires subject after trimming', () => {
    const result = validateGeneralRequestForm({
      recipientRole: 'secretary',
      subject: '   ',
      message: 'הודעה',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('נושא')
    }
  })

  it('requires message after trimming', () => {
    const result = validateGeneralRequestForm({
      recipientRole: 'institution_manager',
      subject: 'נושא',
      message: '\n  \n',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('הודעה')
    }
  })

  it('rejects subject longer than the maximum', () => {
    const result = validateGeneralRequestForm({
      recipientRole: 'secretary',
      subject: 'א'.repeat(GENERAL_REQUEST_SUBJECT_MAX_LENGTH + 1),
      message: 'הודעה',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects message longer than the maximum', () => {
    const result = validateGeneralRequestForm({
      recipientRole: 'secretary',
      subject: 'נושא',
      message: 'א'.repeat(GENERAL_REQUEST_MESSAGE_MAX_LENGTH + 1),
    })

    expect(result.ok).toBe(false)
  })

  it('returns trimmed subject and message payload when valid', () => {
    const result = validateGeneralRequestForm({
      recipientRole: 'secretary',
      subject: '  נושא  ',
      message: '  שורה ראשונה\nשורה שנייה  ',
    })

    expect(result).toEqual({
      ok: true,
      subject: 'נושא',
      payload: { message: 'שורה ראשונה\nשורה שנייה' },
    })
  })
})
