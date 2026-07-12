import type { DashboardDateRangePreset } from '../../../types/dashboardAnalytics'

type DashboardDateRangeSelectorProps = {
  value: DashboardDateRangePreset
  onChange: (preset: DashboardDateRangePreset) => void
  disabled?: boolean
}

const OPTIONS: { value: DashboardDateRangePreset; label: string }[] = [
  { value: '7d', label: '7 ימים' },
  { value: '30d', label: '30 ימים' },
  { value: '90d', label: '90 ימים' },
  { value: 'school_year', label: 'שנת לימודים נוכחית' },
]

export function DashboardDateRangeSelector({
  value,
  onChange,
  disabled = false,
}: DashboardDateRangeSelectorProps) {
  return (
    <div
      className="dashboard-analytics__date-range"
      role="group"
      aria-label="טווח תאריכים לסקירה"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ds-btn ds-btn--secondary dashboard-analytics__date-range-button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
