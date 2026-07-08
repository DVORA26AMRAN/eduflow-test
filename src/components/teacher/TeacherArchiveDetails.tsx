import type { ArchivedTeacherRequest } from '../../types/request'
import {
  formatRequestDate,
  formatRequestDateTime,
  translateRequestStatus,
  translateRequestType,
} from '../../utils/requests'

type TeacherArchiveDetailsProps = {
  request: ArchivedTeacherRequest | null
}

export function TeacherArchiveDetails({ request }: TeacherArchiveDetailsProps) {
  if (!request) {
    return (
      <div className="ds-state teacher-dashboard__archive-details-empty">
        <span className="ds-state__icon" aria-hidden="true">
          📄
        </span>
        <p className="ds-state__title">בחרי בקשה מהרשימה כדי לצפות בפרטים.</p>
      </div>
    )
  }

  return (
    <article
      className="ds-card teacher-dashboard__archive-details"
      aria-label="פרטי בקשה בארכיון"
    >
      <h3 className="teacher-dashboard__subsection-title">פרטי בקשה בארכיון</h3>

      <dl className="teacher-dashboard__archive-details-list">
        <div className="teacher-dashboard__archive-details-row">
          <dt>סוג בקשה</dt>
          <dd>{translateRequestType(request.request_type)}</dd>
        </div>
        <div className="teacher-dashboard__archive-details-row">
          <dt>סטטוס</dt>
          <dd>
            <span className={`ds-table__status ds-table__status--${request.status}`}>
              {translateRequestStatus(request.status)}
            </span>
          </dd>
        </div>
        <div className="teacher-dashboard__archive-details-row">
          <dt>תאריך יצירה</dt>
          <dd>{formatRequestDate(request.created_at)}</dd>
        </div>
        <div className="teacher-dashboard__archive-details-row">
          <dt>תאריך ארכוב</dt>
          <dd>{formatRequestDateTime(request.archived_at)}</dd>
        </div>
        <div className="teacher-dashboard__archive-details-row teacher-dashboard__archive-details-row--block">
          <dt>תיאור</dt>
          <dd>{request.description}</dd>
        </div>
      </dl>
    </article>
  )
}
