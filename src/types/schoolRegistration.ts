export const SCHOOL_REGISTRATION_PATH = '/register-school'

export type SchoolRegistrationApplicantRole = 'principal' | 'vice_principal'

/** Phase 2 sales lifecycle statuses. */
export type SchoolRegistrationStatus =
  | 'new'
  | 'contacted'
  | 'awaiting_response'
  | 'interested'
  | 'closed'
  | 'not_relevant'

export const SCHOOL_REGISTRATION_STATUSES: SchoolRegistrationStatus[] = [
  'new',
  'contacted',
  'awaiting_response',
  'interested',
  'closed',
  'not_relevant',
]

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
  followUpAt: string | null
  createdAt: string
  updatedAt: string
  convertedInstitutionId?: string | null
  convertedAt?: string | null
}

export type SchoolRegistrationNote = {
  id: string
  registrationId: string
  authorUserId: string
  noteText: string
  createdAt: string
}

export type SchoolRegistrationActivityEventType =
  | 'registration_created'
  | 'note_added'
  | 'status_changed'
  | 'follow_up_set'
  | 'follow_up_rescheduled'
  | 'follow_up_cleared'

export type SchoolRegistrationActivity = {
  id: string
  registrationId: string
  eventType: SchoolRegistrationActivityEventType
  actorUserId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export type FollowUpUrgency = 'none' | 'future' | 'due_today' | 'overdue'

export const PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID = 'registrations'
export const PLATFORM_ADMIN_REGISTRATIONS_NAV_LABEL = 'הרשמות'

export const SCHOOL_REGISTRATION_SUCCESS_MESSAGE =
  'ההרשמה התקבלה בהצלחה. ניצור איתך קשר בהקדם.'

export const SCHOOL_REGISTRATION_NOTE_MAX_LENGTH = 2000

export const APPLICANT_ROLE_LABELS: Record<SchoolRegistrationApplicantRole, string> = {
  principal: 'מנהל/ת',
  vice_principal: 'סגן/ית מנהל/ת',
}

export const REGISTRATION_STATUS_LABELS: Record<SchoolRegistrationStatus, string> = {
  new: 'חדש',
  contacted: 'יצרתי קשר',
  awaiting_response: 'ממתינה לתשובה',
  interested: 'מעוניינת',
  closed: 'נסגר',
  not_relevant: 'לא רלוונטי',
}

export const REGISTRATION_ACTIVITY_LABELS: Record<
  SchoolRegistrationActivityEventType,
  string
> = {
  registration_created: 'ההרשמה נוצרה',
  note_added: 'נוספה הערה פנימית',
  status_changed: 'סטטוס עודכן',
  follow_up_set: 'נקבע מעקב',
  follow_up_rescheduled: 'מעקב תוזמן מחדש',
  follow_up_cleared: 'מעקב בוטל',
}
