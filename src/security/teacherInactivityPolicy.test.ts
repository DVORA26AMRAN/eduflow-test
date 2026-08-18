import { describe, expect, it } from 'vitest'
import {
  TEACHER_INACTIVITY_CONTINUE_LABEL,
  TEACHER_INACTIVITY_LOGOUT_MS,
  TEACHER_INACTIVITY_WARNING_MS,
  TEACHER_INACTIVITY_WARNING_TEXT,
  isTeacherInactivityRole,
  mergeTeacherActivityTimestamp,
  remainingWarningMs,
  shouldLogoutForTeacherInactivity,
  shouldOpenTeacherInactivityWarning,
  shouldWarnForTeacherInactivity,
} from './teacherInactivityPolicy'

describe('teacherInactivityPolicy', () => {
  it('uses production 4m warning and 5m logout thresholds', () => {
    expect(TEACHER_INACTIVITY_WARNING_MS).toBe(4 * 60 * 1000)
    expect(TEACHER_INACTIVITY_LOGOUT_MS).toBe(5 * 60 * 1000)
    expect(TEACHER_INACTIVITY_WARNING_TEXT).toBe(
      'המערכת תתנתק בעוד דקה עקב חוסר פעילות',
    )
    expect(TEACHER_INACTIVITY_CONTINUE_LABEL).toBe('המשך עבודה')
  })

  it('activates only for authoritative teacher PrimaryRole', () => {
    expect(isTeacherInactivityRole('teacher')).toBe(true)
    expect(isTeacherInactivityRole('secretary')).toBe(false)
    expect(isTeacherInactivityRole('institution_manager')).toBe(false)
    expect(isTeacherInactivityRole('platform_admin')).toBe(false)
    expect(isTeacherInactivityRole(null)).toBe(false)
    expect(isTeacherInactivityRole(undefined)).toBe(false)
  })

  it('keeps teacher logged in before 4 minutes', () => {
    const lastActivityAt = 1_000_000
    expect(
      shouldOpenTeacherInactivityWarning({
        now: lastActivityAt + TEACHER_INACTIVITY_WARNING_MS - 1,
        lastActivityAt,
        warningMs: TEACHER_INACTIVITY_WARNING_MS,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
      }),
    ).toBe(false)
    expect(
      shouldLogoutForTeacherInactivity({
        now: lastActivityAt + TEACHER_INACTIVITY_WARNING_MS - 1,
        lastActivityAt,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
        forceLogoutAt: null,
      }),
    ).toBe(false)
  })

  it('opens warning after 4 minutes and before 5 minutes', () => {
    const lastActivityAt = 1_000_000
    expect(
      shouldOpenTeacherInactivityWarning({
        now: lastActivityAt + TEACHER_INACTIVITY_WARNING_MS,
        lastActivityAt,
        warningMs: TEACHER_INACTIVITY_WARNING_MS,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
      }),
    ).toBe(true)
    expect(
      shouldLogoutForTeacherInactivity({
        now: lastActivityAt + TEACHER_INACTIVITY_WARNING_MS,
        lastActivityAt,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
        forceLogoutAt: null,
      }),
    ).toBe(false)
  })

  it('latched warning stays logically open even if idle briefly recomputed', () => {
    expect(
      shouldWarnForTeacherInactivity({
        now: 0,
        lastActivityAt: 0,
        warningMs: 100,
        logoutMs: 200,
        warningVisible: true,
      }),
    ).toBe(true)
  })

  it('logs out after 5 minutes or when force logout is shared', () => {
    const lastActivityAt = 1_000_000
    expect(
      shouldLogoutForTeacherInactivity({
        now: lastActivityAt + TEACHER_INACTIVITY_LOGOUT_MS,
        lastActivityAt,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
        forceLogoutAt: null,
      }),
    ).toBe(true)
    expect(
      shouldLogoutForTeacherInactivity({
        now: lastActivityAt + 10,
        lastActivityAt,
        logoutMs: TEACHER_INACTIVITY_LOGOUT_MS,
        forceLogoutAt: lastActivityAt + 5,
      }),
    ).toBe(true)
  })

  it('merges shared activity so another tab can reset idle time', () => {
    expect(
      mergeTeacherActivityTimestamp(100, {
        lastActivityAt: 250,
        forceLogoutAt: null,
      }),
    ).toBe(250)
    expect(remainingWarningMs({ now: 100, lastActivityAt: 0, logoutMs: 1000 })).toBe(900)
  })
})
