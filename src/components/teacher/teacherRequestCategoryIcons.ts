import type { ComponentType } from 'react'
import type { TeacherNewRequestCategoryType } from '../../utils/requests'
import {
  NavCalendarIcon,
  NavEnvelopeIcon,
  NavPackageIcon,
} from '../dashboard/dashboardNav'

export const TEACHER_REQUEST_CATEGORY_ICON_COMPONENTS: Record<
  TeacherNewRequestCategoryType,
  ComponentType
> = {
  absence: NavCalendarIcon,
  budget_or_equipment: NavPackageIcon,
  general_request: NavEnvelopeIcon,
}
