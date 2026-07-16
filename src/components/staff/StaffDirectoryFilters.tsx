type StaffDirectoryFiltersProps = {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
}

export function StaffDirectoryFilters({
  searchQuery,
  onSearchQueryChange,
}: StaffDirectoryFiltersProps) {
  return (
    <label className="ds-field staff-directory__search-field" htmlFor="staff-directory-search">
      <span className="ds-label">חיפוש</span>
      <input
        id="staff-directory-search"
        className="ds-input staff-directory__search"
        type="search"
        placeholder="חיפוש לפי שם, מייל או טלפון"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
    </label>
  )
}
