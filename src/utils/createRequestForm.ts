import type { AbsenceFormFields } from './absence'
import type { BudgetFormFields } from './budget'

export type CreateRequestFormSnapshot = {
  description: string
  absenceFields: AbsenceFormFields
  budgetFields: BudgetFormFields
  attachmentFile: File | null
}

export function isCreateRequestFormDirty(snapshot: CreateRequestFormSnapshot): boolean {
  if (snapshot.description.trim()) {
    return true
  }

  if (snapshot.attachmentFile) {
    return true
  }

  if (snapshot.absenceFields.absenceDate.trim()) {
    return true
  }

  if (snapshot.absenceFields.absenceReason) {
    return true
  }

  if (snapshot.absenceFields.absenceReasonOther.trim()) {
    return true
  }

  if (snapshot.absenceFields.replacedBy.trim()) {
    return true
  }

  if (snapshot.budgetFields.budgetDetails.trim()) {
    return true
  }

  if (snapshot.budgetFields.requestedAmount.trim()) {
    return true
  }

  if (snapshot.budgetFields.bankAccountDetails.trim()) {
    return true
  }

  return false
}
