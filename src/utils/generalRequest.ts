import type { GeneralRequestFormFields, GeneralRequestPayload } from '../types/request'

export const GENERAL_REQUEST_SUBJECT_MAX_LENGTH = 200
export const GENERAL_REQUEST_MESSAGE_MAX_LENGTH = 2000

export type GeneralRequestValidationResult =
  | { ok: true; payload: GeneralRequestPayload; subject: string }
  | { ok: false; errorMessage: string }

export function validateGeneralRequestForm(
  fields: GeneralRequestFormFields,
): GeneralRequestValidationResult {
  if (!fields.recipientRole) {
    return {
      ok: false,
      errorMessage: 'נא לבחור נמען לבקשה.',
    }
  }

  const subject = fields.subject.trim()
  if (!subject) {
    return {
      ok: false,
      errorMessage: 'נא להזין נושא לבקשה.',
    }
  }

  if (subject.length > GENERAL_REQUEST_SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `הנושא ארוך מדי (עד ${GENERAL_REQUEST_SUBJECT_MAX_LENGTH} תווים).`,
    }
  }

  const message = fields.message.trim()
  if (!message) {
    return {
      ok: false,
      errorMessage: 'נא להזין הודעה לבקשה.',
    }
  }

  if (message.length > GENERAL_REQUEST_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      errorMessage: `ההודעה ארוכה מדי (עד ${GENERAL_REQUEST_MESSAGE_MAX_LENGTH} תווים).`,
    }
  }

  return {
    ok: true,
    subject,
    payload: { message },
  }
}

export function buildGeneralRequestDescription(subject: string): string {
  return subject
}
