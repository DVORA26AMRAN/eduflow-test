import type { InstitutionSummary } from './school'

/** Full institution record for Platform Admin Phase 1 management. */
export type InstitutionAdminRecord = InstitutionSummary & {
  institutionCode: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type InstitutionFormFields = {
  name: string
  institutionCode: string
  address: string
  city: string
  phone: string
  email: string
}

export type InstitutionManagerInviteFields = {
  fullName: string
  email: string
}

/** Active Institution Manager projection for Platform Admin (application-owned). */
export type InstitutionManagerRecord = {
  userId: string
  fullName: string
  email: string
  status: string
  onboardingCompletedAt: string | null
}

export type InstitutionManagerPanelState =
  | { kind: 'none' }
  | { kind: 'invited'; manager: InstitutionManagerRecord }
  | { kind: 'joined'; manager: InstitutionManagerRecord }

export const PLATFORM_ADMIN_SCHOOLS_SECTION_ID = 'schools'
export const PLATFORM_ADMIN_SCHOOLS_NAV_LABEL = 'בתי ספר'

export const INSTITUTION_MANAGER_NONE_LABEL = 'אין מנהלת משויכת'
export const INSTITUTION_MANAGER_NONE_DETAIL = 'טרם הוגדרה מנהלת לבית הספר'
export const INSTITUTION_MANAGER_INVITED_LABEL = 'הוזמנה — ממתינה להצטרפות'
export const INSTITUTION_MANAGER_JOINED_LABEL = 'מנהלת פעילה'
export const INSTITUTION_MANAGER_INVITE_ACTION_LABEL = 'הזמנת מנהלת'
