import type { BudgetOrEquipmentRequestPayload } from '../types/request'

export type BudgetFormFields = {
  budgetDetails: string
  requestedAmount: string
  bankAccountDetails: string
}

export type ValidateBudgetFormResult =
  | { ok: true; payload: BudgetOrEquipmentRequestPayload }
  | { ok: false; errorMessage: string }

export function buildBudgetRequestPayload(
  fields: BudgetFormFields,
): BudgetOrEquipmentRequestPayload {
  const bankAccountDetails = fields.bankAccountDetails.trim()
  const requestedAmount = fields.requestedAmount.trim()

  return {
    budget_details: fields.budgetDetails.trim(),
    requested_amount: requestedAmount.length > 0 ? Number(requestedAmount) : null,
    bank_account_details: bankAccountDetails.length > 0 ? bankAccountDetails : null,
  }
}

export function buildBudgetDescription(payload: BudgetOrEquipmentRequestPayload): string {
  const lines = ['בקשת תקציב / ציוד', `פירוט: ${payload.budget_details}`]

  if (payload.requested_amount !== null) {
    lines.push(`סכום מבוקש: ${payload.requested_amount} ש"ח`)
  }

  if (payload.bank_account_details) {
    lines.push(`פרטי חשבון בנק: ${payload.bank_account_details}`)
  }

  return lines.join('\n')
}

export function validateBudgetForm(fields: BudgetFormFields): ValidateBudgetFormResult {
  if (!fields.budgetDetails.trim()) {
    return {
      ok: false,
      errorMessage: 'נא להזין פירוט הבקשה.',
    }
  }

  const requestedAmount = fields.requestedAmount.trim()
  if (requestedAmount.length > 0) {
    const amount = Number(requestedAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        errorMessage: 'נא להזין סכום מבוקש תקין.',
      }
    }
  }

  return {
    ok: true,
    payload: buildBudgetRequestPayload(fields),
  }
}
