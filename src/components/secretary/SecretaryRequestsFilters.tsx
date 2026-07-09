import type { RequestStatus, RequestType, SecretaryInboxFilters } from '../../types/request'
import { REQUEST_TYPE_OPTIONS } from '../../utils/requests'

type SecretaryRequestsFiltersProps = {
  filters: SecretaryInboxFilters
  onFiltersChange: (filters: SecretaryInboxFilters) => void
}

export function SecretaryRequestsFilters({
  filters,
  onFiltersChange,
}: SecretaryRequestsFiltersProps) {
  function updateFilter<K extends keyof SecretaryInboxFilters>(
    key: K,
    value: SecretaryInboxFilters[K],
  ) {
    onFiltersChange({
      ...filters,
      [key]: value,
    })
  }

  return (
    <div className="secretary-dashboard__filters secretary-dashboard__inbox-filters">
      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">חיפוש לפי שם מורה</span>
        <input
          className="secretary-dashboard__input secretary-dashboard__search"
          placeholder="הקלידי שם מורה"
          value={filters.teacherNameQuery}
          onChange={(event) => updateFilter('teacherNameQuery', event.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">חיפוש בתיאור</span>
        <input
          className="secretary-dashboard__input secretary-dashboard__search"
          placeholder="הקלידי טקסט מתוך התיאור"
          value={filters.descriptionQuery}
          onChange={(event) => updateFilter('descriptionQuery', event.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">סוג בקשה</span>
        <select
          className="secretary-dashboard__input"
          value={filters.requestType}
          onChange={(event) =>
            updateFilter('requestType', event.target.value as RequestType | 'all')
          }
        >
          <option value="all">כל הסוגים</option>
          {REQUEST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">סטטוס</span>
        <select
          className="secretary-dashboard__input"
          value={filters.requestStatus}
          onChange={(event) =>
            updateFilter('requestStatus', event.target.value as RequestStatus | 'all')
          }
        >
          <option value="all">כל הסטטוסים</option>
          <option value="new">חדש</option>
          <option value="in_progress">בטיפול</option>
          <option value="completed">הושלם</option>
          <option value="rejected">נדחה</option>
        </select>
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">מתאריך יצירה</span>
        <input
          type="date"
          className="secretary-dashboard__input"
          value={filters.dateFrom}
          onChange={(event) => updateFilter('dateFrom', event.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">עד תאריך יצירה</span>
        <input
          type="date"
          className="secretary-dashboard__input"
          value={filters.dateTo}
          onChange={(event) => updateFilter('dateTo', event.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field secretary-dashboard__filter-field--checkbox">
        <span className="secretary-dashboard__filter-checkbox">
          <input
            type="checkbox"
            checked={filters.attachmentsOnly}
            onChange={(event) => updateFilter('attachmentsOnly', event.target.checked)}
          />
          <span>רק בקשות עם קובץ מצורף</span>
        </span>
      </label>
    </div>
  )
}
