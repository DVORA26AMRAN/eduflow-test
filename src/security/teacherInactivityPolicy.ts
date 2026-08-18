import type { PrimaryRole } from '../types/user'

/** Production warning threshold: 4 minutes of inactivity. */
export const TEACHER_INACTIVITY_WARNING_MS = 4 * 60 * 1000

/** Production logout threshold: 5 minutes of inactivity. */
export const TEACHER_INACTIVITY_LOGOUT_MS = 5 * 60 * 1000

/** Throttle for writing last-activity to shared storage / listeners. */
export const TEACHER_INACTIVITY_ACTIVITY_THROTTLE_MS = 1000

/** Tick interval for evaluating warning/logout (keeps React updates low). */
export const TEACHER_INACTIVITY_TICK_MS = 1000

export const TEACHER_INACTIVITY_STORAGE_KEY = 'mpex.teacher.inactivity.v1'
export const TEACHER_INACTIVITY_BROADCAST_CHANNEL = 'mpex.teacher.inactivity'

/** Marker on the warning root so capture-phase activity ignores dialog chrome. */
export const TEACHER_INACTIVITY_WARNING_ROOT_ATTR = 'data-teacher-inactivity-warning'

export const TEACHER_INACTIVITY_WARNING_TEXT =
  'המערכת תתנתק בעוד דקה עקב חוסר פעילות'

export const TEACHER_INACTIVITY_CONTINUE_LABEL = 'המשך עבודה'

export type TeacherInactivitySharedState = {
  lastActivityAt: number
  /** When set, all same-origin contexts must end the teacher session. */
  forceLogoutAt: number | null
}

export type TeacherInactivityBroadcastMessage =
  | { type: 'activity'; at: number }
  | { type: 'force_logout'; at: number }

/** Authoritative PrimaryRole check — do not infer from URL/UI. */
export function isTeacherInactivityRole(
  role: PrimaryRole | null | undefined,
): boolean {
  return role === 'teacher'
}

export function createTeacherInactivitySharedState(
  now: number,
): TeacherInactivitySharedState {
  return { lastActivityAt: now, forceLogoutAt: null }
}

export function readTeacherInactivitySharedState(
  raw: string | null,
): TeacherInactivitySharedState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TeacherInactivitySharedState>
    if (typeof parsed.lastActivityAt !== 'number' || !Number.isFinite(parsed.lastActivityAt)) {
      return null
    }
    const forceLogoutAt =
      typeof parsed.forceLogoutAt === 'number' && Number.isFinite(parsed.forceLogoutAt)
        ? parsed.forceLogoutAt
        : null
    return { lastActivityAt: parsed.lastActivityAt, forceLogoutAt }
  } catch {
    return null
  }
}

export function writeTeacherInactivitySharedState(
  state: TeacherInactivitySharedState,
): string {
  return JSON.stringify(state)
}

export function mergeTeacherActivityTimestamp(
  localLastActivityAt: number,
  shared: TeacherInactivitySharedState | null,
): number {
  if (!shared) return localLastActivityAt
  return Math.max(localLastActivityAt, shared.lastActivityAt)
}

/**
 * Whether the warning should open for the first time.
 * Does not encode latch/dismiss — once open, the hook keeps it latched until
 * continue, qualifying activity, or logout (never toggled off by tick recompute).
 */
export function shouldOpenTeacherInactivityWarning(input: {
  now: number
  lastActivityAt: number
  warningMs: number
  logoutMs: number
}): boolean {
  const idle = input.now - input.lastActivityAt
  return idle >= input.warningMs && idle < input.logoutMs
}

/** @deprecated Prefer shouldOpen + explicit latch in the hook. Kept for clarity in tests. */
export function shouldWarnForTeacherInactivity(input: {
  now: number
  lastActivityAt: number
  warningMs: number
  logoutMs: number
  warningVisible: boolean
}): boolean {
  if (input.warningVisible) return true
  return shouldOpenTeacherInactivityWarning(input)
}

export function shouldLogoutForTeacherInactivity(input: {
  now: number
  lastActivityAt: number
  logoutMs: number
  forceLogoutAt: number | null
}): boolean {
  if (input.forceLogoutAt != null) return true
  return input.now - input.lastActivityAt >= input.logoutMs
}

export function remainingWarningMs(input: {
  now: number
  lastActivityAt: number
  logoutMs: number
}): number {
  return Math.max(0, input.lastActivityAt + input.logoutMs - input.now)
}
