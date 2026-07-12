import { describe, expect, it } from 'vitest'
import { isCreateRequestFormDirty } from './createRequestForm'

const emptySnapshot = {
  description: '',
  absenceFields: {
    absenceDate: '',
    absenceReason: '' as const,
    absenceReasonOther: '',
    replacedBy: '',
  },
  budgetFields: {
    budgetDetails: '',
    requestedAmount: '',
    bankAccountDetails: '',
  },
  attachmentFile: null,
}

describe('isCreateRequestFormDirty', () => {
  it('returns false for an empty form snapshot', () => {
    expect(isCreateRequestFormDirty(emptySnapshot)).toBe(false)
  })

  it('detects description input as dirty', () => {
    expect(
      isCreateRequestFormDirty({
        ...emptySnapshot,
        description: 'פרטים',
      }),
    ).toBe(true)
  })

  it('detects absence field input as dirty', () => {
    expect(
      isCreateRequestFormDirty({
        ...emptySnapshot,
        absenceFields: {
          ...emptySnapshot.absenceFields,
          absenceDate: '2026-07-12',
        },
      }),
    ).toBe(true)
  })
})
