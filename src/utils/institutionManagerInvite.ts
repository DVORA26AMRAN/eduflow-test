import type {
  InstitutionManagerInviteFields,
  InstitutionManagerPanelState,
  InstitutionManagerRecord,
} from '../types/institutionAdmin'

export type ValidateManagerInviteResult =
  | { ok: true; values: { fullName: string; email: string } }
  | { ok: false; errorMessage: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateInstitutionManagerInvite(
  fields: InstitutionManagerInviteFields,
): ValidateManagerInviteResult {
  const fullName = fields.fullName.trim()
  const email = fields.email.trim().toLowerCase()

  if (!fullName) {
    return { ok: false, errorMessage: 'נא למלא שם מלא.' }
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, errorMessage: 'כתובת האימייל אינה תקינה.' }
  }

  return { ok: true, values: { fullName, email } }
}

export function projectInstitutionManagerPanelState(
  manager: InstitutionManagerRecord | null,
): InstitutionManagerPanelState {
  if (!manager || manager.status !== 'active') {
    return { kind: 'none' }
  }

  if (manager.onboardingCompletedAt === null) {
    return { kind: 'invited', manager }
  }

  return { kind: 'joined', manager }
}
