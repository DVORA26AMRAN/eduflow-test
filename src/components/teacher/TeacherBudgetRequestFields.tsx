type TeacherBudgetRequestFieldsProps = {
  budgetDetails: string
  requestedAmount: string
  bankAccountDetails: string
  isDisabled: boolean
  onBudgetDetailsChange: (value: string) => void
  onRequestedAmountChange: (value: string) => void
  onBankAccountDetailsChange: (value: string) => void
}

export function TeacherBudgetRequestFields({
  budgetDetails,
  requestedAmount,
  bankAccountDetails,
  isDisabled,
  onBudgetDetailsChange,
  onRequestedAmountChange,
  onBankAccountDetailsChange,
}: TeacherBudgetRequestFieldsProps) {
  return (
    <div className="teacher-dashboard__budget-form">
      <label className="ds-field" htmlFor="budget-details">
        <span className="ds-label">פירוט הבקשה</span>
        <textarea
          id="budget-details"
          className="ds-textarea"
          rows={4}
          value={budgetDetails}
          onChange={(event) => onBudgetDetailsChange(event.target.value)}
          disabled={isDisabled}
          placeholder="פרטי הבקשה"
        />
      </label>

      <label className="ds-field" htmlFor="requested-amount">
        <span className="ds-label">סכום מבוקש</span>
        <input
          id="requested-amount"
          type="number"
          min="0"
          step="1"
          className="ds-input teacher-dashboard__amount-input"
          value={requestedAmount}
          onChange={(event) => onRequestedAmountChange(event.target.value)}
          disabled={isDisabled}
          placeholder="סכום בש״ח (אופציונלי)"
        />
      </label>

      <label className="ds-field" htmlFor="bank-account-details">
        <span className="ds-label">פרטי חשבון בנק</span>
        <textarea
          id="bank-account-details"
          className="ds-textarea"
          rows={3}
          value={bankAccountDetails}
          onChange={(event) => onBankAccountDetailsChange(event.target.value)}
          disabled={isDisabled}
          placeholder="פרטי חשבון (אופציונלי)"
        />
      </label>
    </div>
  )
}
