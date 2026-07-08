import type { ArchiveFilters, RequestStatus, RequestType } from '../../types/request'
import { REQUEST_STATUS_OPTIONS, REQUEST_TYPE_OPTIONS } from '../../utils/requests'

type TeacherArchiveFiltersProps = {
  filters: ArchiveFilters
  onFiltersChange: (filters: ArchiveFilters) => void
}

export function TeacherArchiveFilters({
  filters,
  onFiltersChange,
}: TeacherArchiveFiltersProps) {
  function updateFilter<K extends keyof ArchiveFilters>(key: K, value: ArchiveFilters[K]) {
    onFiltersChange({
      ...filters,
      [key]: value,
    })
  }

  return (
    <div className="teacher-dashboard__archive-filters">
      <label className="ds-field teacher-dashboard__archive-filter-field" htmlFor="archive-type">
        <span className="ds-label">סוג בקשה</span>
        <select
          id="archive-type"
          className="ds-select"
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

      <label className="ds-field teacher-dashboard__archive-filter-field" htmlFor="archive-status">
        <span className="ds-label">סטטוס</span>
        <select
          id="archive-status"
          className="ds-select"
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

      <label className="ds-field teacher-dashboard__archive-filter-field" htmlFor="archive-from">
        <span className="ds-label">מתאריך ארכוב</span>
        <input
          id="archive-from"
          type="date"
          className="ds-input"
          value={filters.dateFrom}
          onChange={(event) => updateFilter('dateFrom', event.target.value)}
        />
      </label>

      <label className="ds-field teacher-dashboard__archive-filter-field" htmlFor="archive-to">
        <span className="ds-label">עד תאריך ארכוב</span>
        <input
          id="archive-to"
          type="date"
          className="ds-input"
          value={filters.dateTo}
          onChange={(event) => updateFilter('dateTo', event.target.value)}
        />
      </label>
    </div>
  )
}
