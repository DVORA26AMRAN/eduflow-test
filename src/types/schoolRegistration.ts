export const SCHOOL_REGISTRATION_PATH = '/register-school'

export type SchoolRegistrationApplicantRole = 'principal' | 'vice_principal'

export type SchoolRegistrationStatus =
  | 'new'
  | 'contacted'
  | 'in_review'
  | 'converted'
  | 'rejected'

export type SchoolRegistrationFormFields = {
  schoolName: string
  institutionSymbol: string
  city: string
  applicantRole: SchoolRegistrationApplicantRole | ''
  contactFullName: string
  email: string
  phone: string
}

export type SchoolRegistrationRecord = {
  id: string
  schoolName: string
  institutionSymbol: string
  city: string
  applicantRole: SchoolRegistrationApplicantRole
  contactFullName: string
  email: string
  phone: string
  status: SchoolRegistrationStatus
  createdAt: string
  updatedAt: string
  convertedInstitutionId?: string | null
  convertedAt?: string | null
}

export const PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID = 'registrations'
export const PLATFORM_ADMIN_REGISTRATIONS_NAV_LABEL = 'הרשמות'

export const SCHOOL_REGISTRATION_SUCCESS_MESSAGE =
  'ההרשמה התקבלה בהצלחה. ניצור איתך קשר בהקדם.'

export const APPLICANT_ROLE_LABELS: Record<SchoolRegistrationApplicantRole, string> = {
  principal: 'מנהל/ת',
  vice_principal: 'סגן/ית מנהל/ת',
}

export const REGISTRATION_STATUS_LABELS: Record<SchoolRegistrationStatus, string> = {
  new: 'חדש',
  contacted: 'נוצר קשר',
  in_review: 'בבדיקה',
  converted: 'הומר לבית ספר',
  rejected: 'נדחה',
}
