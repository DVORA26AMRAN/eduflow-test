import type { SubstituteBoardPendingApproval } from '../../types/substituteBoard'
import {
  formatSubstituteBoardDate,
  formatSubstituteBoardTime,
} from '../../utils/substituteBoard'

type SecretarySubstituteApprovalsTableProps = {
  approvals: SubstituteBoardPendingApproval[]
  emptyMessage: string
  approvingPostId: string | null
  onApprove: (postId: string) => void
}

export function SecretarySubstituteApprovalsTable({
  approvals,
  emptyMessage,
  approvingPostId,
  onApprove,
}: SecretarySubstituteApprovalsTableProps) {
  if (approvals.length === 0) {
    return (
      <div className="ds-state secretary-dashboard__empty-state">
        <span className="ds-state__icon" aria-hidden="true">
          🗂️
        </span>
        <p className="ds-state__title">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="ds-table-wrapper secretary-dashboard__table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th>מורה מפרסמת</th>
            <th>מורה מחליפה</th>
            <th>תאריך</th>
            <th>שעת התחלה</th>
            <th>שעת סיום</th>
            <th>כיתה</th>
            <th>מקצוע</th>
            <th>תיאור</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {approvals.map((approval) => (
            <tr key={approval.id}>
              <td>{approval.created_by_full_name}</td>
              <td>{approval.selected_teacher_full_name}</td>
              <td>{formatSubstituteBoardDate(approval.date)}</td>
              <td>{formatSubstituteBoardTime(approval.start_time)}</td>
              <td>{formatSubstituteBoardTime(approval.end_time)}</td>
              <td>{approval.class_name ?? '—'}</td>
              <td>{approval.subject ?? '—'}</td>
              <td>{approval.description ?? '—'}</td>
              <td>
                <div className="ds-table__row-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary secretary-dashboard__substitute-approve-button"
                    onClick={() => onApprove(approval.id)}
                    disabled={approvingPostId === approval.id}
                  >
                    {approvingPostId === approval.id ? 'מאשרת...' : 'אישור'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
