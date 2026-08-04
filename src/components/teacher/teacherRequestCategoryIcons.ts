import type { ComponentType } from 'react'
import type { TeacherRequestCategoryValue } from '../../utils/requests'
import {
  NavCalendarIcon,
  NavEnvelopeIcon,
  NavPackageIcon,
  NavPrintIcon,
} from '../dashboard/dashboardNav'

export const TEACHER_REQUEST_CATEGORY_ICON_COMPONENTS: Record<
  TeacherRequestCategoryValue,
  ComponentType
> = {
  absence: NavCalendarIcon,
  budget_or_equipment: NavPackageIcon,
  printing: NavPrintIcon,
  general_request: NavEnvelopeIcon,
}
