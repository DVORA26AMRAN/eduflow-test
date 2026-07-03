import type { RequestType } from '../../types/request'
import { TEACHER_REQUEST_CATEGORIES } from '../../utils/requests'

type TeacherRequestCategorySelectorProps = {
  selectedType: RequestType | ''
  isDisabled: boolean
  onSelect: (requestType: RequestType) => void
}

export function TeacherRequestCategorySelector({
  selectedType,
  isDisabled,
  onSelect,
}: TeacherRequestCategorySelectorProps) {
  return (
    <fieldset className="teacher-dashboard__category-fieldset" disabled={isDisabled}>
      <legend className="ds-label teacher-dashboard__category-legend">קטגוריית בקשה</legend>
      <div className="teacher-dashboard__category-grid" role="radiogroup" aria-label="קטגוריית בקשה">
        {TEACHER_REQUEST_CATEGORIES.map((category) => {
          const isSelected = selectedType === category.value

          return (
            <button
              key={category.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={
                isSelected
                  ? 'teacher-dashboard__category-card teacher-dashboard__category-card--selected'
                  : 'teacher-dashboard__category-card'
              }
              onClick={() => onSelect(category.value)}
              disabled={isDisabled}
            >
              <span className="teacher-dashboard__category-icon" aria-hidden="true">
                {category.icon}
              </span>
              <span className="teacher-dashboard__category-title">{category.title}</span>
              <span className="teacher-dashboard__category-description">
                {category.description}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
