/**
 * Meeting Details Google Meet provision UX helpers (Phase 4).
 * Never expose provider internals (event ids, tokens, raw error payloads).
 */

import type { MeetProvisionStatus } from './meetingMeetProvision'
import { isMeetProvisionReauthErrorCode } from './googleCalendarErrors'

export const OWNER_GOOGLE_CONNECTION_STATUSES = [
  'connected',
  'not_connected',
  'reauthorization_required',
] as const

export type OwnerGoogleConnectionStatus = (typeof OWNER_GOOGLE_CONNECTION_STATUSES)[number]

export const MEET_PROVISION_UI_KINDS = [
  'hidden',
  'not_connected',
  'reauthorization_required',
  'creating',
  'ready',
  'failed',
  'create_available',
] as const

export type MeetProvisionUiKind = (typeof MEET_PROVISION_UI_KINDS)[number]

export type MeetProvisionUiModel = {
  kind: MeetProvisionUiKind
  statusLabel: string
  helpText: string
  showConnectGoogle: boolean
  showCreateMeet: boolean
  showRetry: boolean
  showStartMeeting: boolean
}

export type MeetProvisionUiInput = {
  meetingFormat: 'online' | 'phone' | 'in_person'
  meetUrl: string | null
  meetProvisionStatus: MeetProvisionStatus | null
  meetProvisionError: string | null
  ownerGoogleConnected: boolean
  ownerGoogleConnectionStatus: OwnerGoogleConnectionStatus
  canRequestMeetProvision: boolean
  isCalendarOwner: boolean
  primaryActionAvailable: boolean
}

function isReauthError(error: string | null): boolean {
  return isMeetProvisionReauthErrorCode(error)
}

/**
 * Reauth CTA only when the live owner connection still needs reconnect.
 * Stale meeting-level REAUTHORIZATION_REQUIRED / GOOGLE_NOT_CONNECTED must not
 * hide an already-active Google connection.
 */
export function shouldShowGoogleReauthorization(input: {
  meetUrl: string | null
  meetProvisionStatus: MeetProvisionStatus | null
  meetProvisionError: string | null
  ownerGoogleConnected: boolean
  ownerGoogleConnectionStatus: OwnerGoogleConnectionStatus
}): boolean {
  if (input.meetUrl && input.meetUrl.trim()) {
    return false
  }

  // Active connection wins over stale meeting provision failure rows.
  if (
    input.ownerGoogleConnectionStatus === 'connected' ||
    input.ownerGoogleConnected
  ) {
    return false
  }

  if (input.ownerGoogleConnectionStatus === 'reauthorization_required') {
    return true
  }

  const status = input.meetProvisionStatus
  if (status === 'google_not_connected' && isReauthError(input.meetProvisionError)) {
    return true
  }

  return status === 'failed' && isMeetProvisionReauthErrorCode(input.meetProvisionError)
}

export function resolveMeetProvisionUi(input: MeetProvisionUiInput): MeetProvisionUiModel {
  if (input.meetingFormat !== 'online') {
    return {
      kind: 'hidden',
      statusLabel: '',
      helpText: '',
      showConnectGoogle: false,
      showCreateMeet: false,
      showRetry: false,
      showStartMeeting: false,
    }
  }

  const isOwner = input.isCalendarOwner
  const hasUrl = Boolean(input.meetUrl && input.meetUrl.trim())
  const status = input.meetProvisionStatus
  const connection = input.ownerGoogleConnectionStatus

  if (shouldShowGoogleReauthorization(input)) {
    return {
      kind: 'reauthorization_required',
      statusLabel: 'נדרש חיבור מחדש לחשבון Google',
      helpText: isOwner
        ? 'יש לחבר מחדש את חשבון Google כדי ליצור קישור לפגישה.'
        : 'בעל היומן צריך לחבר מחדש את חשבון Google.',
      showConnectGoogle: isOwner,
      showCreateMeet: false,
      showRetry: false,
      showStartMeeting: false,
    }
  }

  if (hasUrl || status === 'ready') {
    return {
      kind: 'ready',
      statusLabel: 'Google Meet מוכן',
      helpText: hasUrl
        ? 'ניתן להתחיל את הפגישה בחלון הזמן המותר.'
        : 'קישור הפגישה מוכן.',
      showConnectGoogle: false,
      showCreateMeet: false,
      showRetry: false,
      showStartMeeting: hasUrl && input.primaryActionAvailable,
    }
  }

  if (status === 'pending') {
    return {
      kind: 'creating',
      statusLabel: 'יוצרים Google Meet',
      helpText: 'קישור הפגישה נוצר ברקע. ניתן להישאר במסך זה.',
      showConnectGoogle: false,
      showCreateMeet: false,
      showRetry: false,
      showStartMeeting: false,
    }
  }

  if (status === 'failed') {
    return {
      kind: 'failed',
      statusLabel: 'יצירת Google Meet נכשלה',
      helpText: isOwner
        ? 'אפשר לנסות שוב. הפגישה נשארת מאושרת.'
        : 'בעל היומן יכול לנסות ליצור את הקישור שוב.',
      showConnectGoogle: false,
      showCreateMeet: false,
      showRetry: isOwner && input.canRequestMeetProvision,
      showStartMeeting: false,
    }
  }

  // Connected owner with no Meet URL yet (including post-connect google_not_connected).
  if (isOwner && input.canRequestMeetProvision && input.ownerGoogleConnected) {
    return {
      kind: 'create_available',
      statusLabel: 'מוכן ליצירת Google Meet',
      helpText: 'לחצו ליצירת קישור לפגישה המאושרת.',
      showConnectGoogle: false,
      showCreateMeet: true,
      showRetry: false,
      showStartMeeting: false,
    }
  }

  if (
    status === 'google_not_connected' ||
    connection === 'not_connected' ||
    (!input.ownerGoogleConnected && !hasUrl)
  ) {
    return {
      kind: 'not_connected',
      statusLabel: 'Google לא מחובר',
      helpText: isOwner
        ? 'כדי ליצור Google Meet יש לחבר חשבון Google.'
        : 'ממתינים לחיבור Google של בעל היומן.',
      showConnectGoogle: isOwner,
      showCreateMeet: false,
      showRetry: false,
      showStartMeeting: false,
    }
  }

  return {
    kind: 'creating',
    statusLabel: 'יוצרים Google Meet',
    helpText: 'קישור הפגישה נוצר ברקע.',
    showConnectGoogle: false,
    showCreateMeet: false,
    showRetry: false,
    showStartMeeting: false,
  }
}

export const GOOGLE_MEET_CONNECT_REQUIRED_MESSAGE =
  'יש לחבר חשבון Google לפני יצירת הקישור.'

/**
 * Merge a fresher Google connection snapshot over possibly-stale liveContext fields.
 * Used when the open Meeting Details dialog still holds a connected snapshot after
 * the owner connection flipped to reauthorization_required / not_connected.
 */
export function mergeOwnerGoogleConnectionForMeetUi(args: {
  ownerGoogleConnected: boolean
  ownerGoogleConnectionStatus: OwnerGoogleConnectionStatus
  freshConnected?: boolean | null
  freshConnectionStatus?: OwnerGoogleConnectionStatus | null
}): {
  ownerGoogleConnected: boolean
  ownerGoogleConnectionStatus: OwnerGoogleConnectionStatus
} {
  const freshStatus = args.freshConnectionStatus
  if (
    freshStatus === 'reauthorization_required' ||
    freshStatus === 'not_connected' ||
    freshStatus === 'connected'
  ) {
    return {
      ownerGoogleConnected:
        typeof args.freshConnected === 'boolean'
          ? args.freshConnected
          : freshStatus === 'connected',
      ownerGoogleConnectionStatus: freshStatus,
    }
  }

  return {
    ownerGoogleConnected: args.ownerGoogleConnected,
    ownerGoogleConnectionStatus: args.ownerGoogleConnectionStatus,
  }
}

export function mapMeetProvisionUserError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('permission') || normalized.includes('forbidden')) {
    return 'אין הרשאה לפעולה זו.'
  }
  if (normalized.includes('google meet can only') || normalized.includes('confirmed')) {
    return 'ניתן ליצור Google Meet רק לפגישה מאושרת.'
  }
  if (normalized.includes('online')) {
    return 'Google Meet זמין לפגישות מקוונות בלבד.'
  }
  return 'לא ניתן להשלים את הפעולה. נסו שוב.'
}
