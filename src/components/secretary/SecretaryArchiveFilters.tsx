import type { RequestStatus, RequestType, SecretaryArchiveFilters } from '../../types/request'
import { REQUEST_STATUS_OPTIONS, REQUEST_TYPE_OPTIONS } from '../../utils/requests'

type SecretaryArchiveFiltersProps = {
  filters: SecretaryArchiveFilters
  onFiltersChange: (filters: SecretaryArchiveFilters) => void
}

export function SecretaryArchiveFilters({
  filters,
  onFiltersChange,
}: SecretaryArchiveFiltersProps) {
  function updateFilter<K extends keyof SecretaryArchiveFilters>(
    key: K,
    value: SecretaryArchiveFilters[K],
  ) {
    onFiltersChange({
      ...filters,
      [key]: value,
    })
  }

  return (
    <div className="secretary-dashboard__archive-filters">
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
          {REQUEST_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">מתאריך ארכוב</span>
        <input
          type="date"
          className="secretary-dashboard__input"
          value={filters.dateFrom}
          onChange={(event) => updateFilter('dateFrom', event.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">עד תאריך ארכוב</span>
        <input
          type="date"
          className="secretary-dashboard__input"
          value={filters.dateTo}
          onChange={(event) => updateFilter('dateTo', event.target.value)}
        />
      </label>
    </div>
  )
}
