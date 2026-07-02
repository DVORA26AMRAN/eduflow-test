import type { RequestStatus, RequestType, SecretaryInboxFilters } from '../../types/request'

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
    <div className="secretary-dashboard__filters">
      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">חיפוש לפי שם מורה</span>
        <input
          className="secretary-dashboard__input secretary-dashboard__search"
          placeholder="הקלידי שם מורה"
          value={filters.teacherNameQuery}
          onChange={(e) => updateFilter('teacherNameQuery', e.target.value)}
        />
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">סוג בקשה</span>
        <select
          className="secretary-dashboard__input"
          value={filters.requestType}
          onChange={(e) =>
            updateFilter('requestType', e.target.value as RequestType | 'all')
          }
        >
          <option value="all">כל הסוגים</option>
          <option value="equipment">ציוד</option>
          <option value="maintenance">תחזוקה</option>
          <option value="pedagogical">פדגוגי</option>
          <option value="other">אחר</option>
        </select>
      </label>

      <label className="secretary-dashboard__filter-field">
        <span className="secretary-dashboard__filter-label">סטטוס</span>
        <select
          className="secretary-dashboard__input"
          value={filters.requestStatus}
          onChange={(e) =>
            updateFilter('requestStatus', e.target.value as RequestStatus | 'all')
          }
        >
          <option value="all">כל הסטטוסים</option>
          <option value="new">חדש</option>
          <option value="in_progress">בטיפול</option>
          <option value="completed">הושלם</option>
          <option value="rejected">נדחה</option>
        </select>
      </label>
    </div>
  )
}
