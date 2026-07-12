import type { GeneralRequestRecipientRole } from '../types/request'

const recipientRoleLabels: Record<GeneralRequestRecipientRole, string> = {
  secretary: 'מזכירה',
  institution_manager: 'מנהלת',
}

export function translateRecipientRole(role: GeneralRequestRecipientRole): string {
  return recipientRoleLabels[role]
}

export const GENERAL_REQUEST_RECIPIENT_OPTIONS: {
  value: GeneralRequestRecipientRole
  label: string
}[] = [
  { value: 'secretary', label: recipientRoleLabels.secretary },
  { value: 'institution_manager', label: recipientRoleLabels.institution_manager },
]

export function isGeneralRequestRecipientRole(value: string): value is GeneralRequestRecipientRole {
  return value === 'secretary' || value === 'institution_manager'
}

export function extractGeneralRequestMessage(
  requestPayload: unknown,
): string | null {
  if (!requestPayload || typeof requestPayload !== 'object' || Array.isArray(requestPayload)) {
    return null
  }

  const message = (requestPayload as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}
