import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TEACHER_INACTIVITY_ACTIVITY_THROTTLE_MS,
  TEACHER_INACTIVITY_LOGOUT_MS,
  TEACHER_INACTIVITY_STORAGE_KEY,
  TEACHER_INACTIVITY_TICK_MS,
  TEACHER_INACTIVITY_WARNING_MS,
  mergeTeacherActivityTimestamp,
  shouldLogoutForTeacherInactivity,
  shouldWarnForTeacherInactivity,
} from '../security/teacherInactivityPolicy'
import {
  bootstrapTeacherInactivitySharedClock,
  createTeacherInactivityBroadcast,
  loadSharedTeacherInactivityState,
  markSharedTeacherForceLogout,
  recordSharedTeacherActivity,
} from '../security/teacherInactivitySync'

export type UseTeacherInactivityLogoutOptions = {
  /** Must be derived from AuthenticatedUserProfile.role === 'teacher'. */
  enabled: boolean
  onLogout: () => void | Promise<void>
  warningMs?: number
  logoutMs?: number
  tickMs?: number
  activityThrottleMs?: number
  now?: () => number
}

/**
 * Intentional user activity only.
 * - pointerdown: mouse / pen / touch (Pointer Events) — supersedes click + touchstart
 * - keydown: keyboard
 * click duplicates pointerdown; touchstart duplicates pointerdown on Pointer Event engines.
 */
export const TEACHER_INACTIVITY_ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const

/**
 * Teacher-only inactivity warning (4m) and canonical logout (5m).
 * Cross-tab last-activity + force-logout via localStorage + BroadcastChannel.
 */
export function useTeacherInactivityLogout({
  enabled,
  onLogout,
  warningMs = TEACHER_INACTIVITY_WARNING_MS,
  logoutMs = TEACHER_INACTIVITY_LOGOUT_MS,
  tickMs = TEACHER_INACTIVITY_TICK_MS,
  activityThrottleMs = TEACHER_INACTIVITY_ACTIVITY_THROTTLE_MS,
  now = () => Date.now(),
}: UseTeacherInactivityLogoutOptions): {
  warningVisible: boolean
  remainingMs: number
  continueWorking: () => void
} {
  const [warningVisible, setWarningVisible] = useState(false)
  const [remainingMs, setRemainingMs] = useState(logoutMs - warningMs)

  const lastActivityAtRef = useRef(now())
  const warningVisibleRef = useRef(false)
  const logoutStartedRef = useRef(false)
  const lastPersistAtRef = useRef(0)
  const onLogoutRef = useRef(onLogout)

  useEffect(() => {
    onLogoutRef.current = onLogout
  }, [onLogout])

  const continueWorking = useCallback(() => {
    if (logoutStartedRef.current) return
    const at = now()
    const shared = loadSharedTeacherInactivityState()
    lastActivityAtRef.current = mergeTeacherActivityTimestamp(
      lastActivityAtRef.current,
      shared,
    )
    if (
      shouldLogoutForTeacherInactivity({
        now: at,
        lastActivityAt: lastActivityAtRef.current,
        logoutMs,
        forceLogoutAt: shared?.forceLogoutAt ?? null,
      })
    ) {
      // Expired: do not revive — canonical logout wins.
      logoutStartedRef.current = true
      warningVisibleRef.current = false
      setWarningVisible(false)
      markSharedTeacherForceLogout(at)
      void onLogoutRef.current()
      return
    }
    lastActivityAtRef.current = at
    warningVisibleRef.current = false
    setWarningVisible(false)
    setRemainingMs(logoutMs - warningMs)
    recordSharedTeacherActivity(at)
  }, [logoutMs, now, warningMs])

  useEffect(() => {
    warningVisibleRef.current = warningVisible
  }, [warningVisible])

  useEffect(() => {
    if (!enabled) {
      // Keep shared forceLogoutAt so sibling tabs can observe expiry.
      // UI is gated via `enabled ? warningVisible : false` — avoid setState here.
      warningVisibleRef.current = false
      logoutStartedRef.current = false
      return
    }

    const startedAt = now()
    lastActivityAtRef.current = bootstrapTeacherInactivitySharedClock(startedAt)
    logoutStartedRef.current = false
    lastPersistAtRef.current = 0
    warningVisibleRef.current = false

    // Defer UI reset so we do not sync-setState in the effect body.
    const resetUiTimer = window.setTimeout(() => {
      setWarningVisible(false)
      setRemainingMs(logoutMs - warningMs)
    }, 0)

    const broadcast = createTeacherInactivityBroadcast()

    const beginLogout = async (at: number) => {
      if (logoutStartedRef.current) return
      logoutStartedRef.current = true
      warningVisibleRef.current = false
      setWarningVisible(false)
      markSharedTeacherForceLogout(at)
      broadcast.post({ type: 'force_logout', at })
      await onLogoutRef.current()
    }

    /** Immediate idle/force evaluation — used by tick and resume; never counts as activity. */
    const evaluateInactivity = (current: number) => {
      if (logoutStartedRef.current) return
      const shared = loadSharedTeacherInactivityState()
      if (shared?.forceLogoutAt != null) {
        void beginLogout(shared.forceLogoutAt)
        return
      }
      lastActivityAtRef.current = mergeTeacherActivityTimestamp(
        lastActivityAtRef.current,
        shared,
      )
      const lastActivityAt = lastActivityAtRef.current

      if (
        shouldLogoutForTeacherInactivity({
          now: current,
          lastActivityAt,
          logoutMs,
          forceLogoutAt: null,
        })
      ) {
        void beginLogout(current)
        return
      }

      const showWarning = shouldWarnForTeacherInactivity({
        now: current,
        lastActivityAt,
        warningMs,
        logoutMs,
        warningVisible: warningVisibleRef.current,
      })
      if (showWarning) {
        if (!warningVisibleRef.current) {
          warningVisibleRef.current = true
          setWarningVisible(true)
        }
        setRemainingMs(Math.max(0, lastActivityAt + logoutMs - current))
      } else if (warningVisibleRef.current) {
        warningVisibleRef.current = false
        setWarningVisible(false)
      }
    }

    const noteActivity = (at: number, fromRemote: boolean) => {
      if (logoutStartedRef.current) return

      if (fromRemote) {
        const shared = loadSharedTeacherInactivityState()
        if (shared?.forceLogoutAt != null) {
          void beginLogout(shared.forceLogoutAt)
          return
        }
        lastActivityAtRef.current = Math.max(lastActivityAtRef.current, at)
        if (warningVisibleRef.current) {
          warningVisibleRef.current = false
          setWarningVisible(false)
        }
        setRemainingMs(logoutMs - warningMs)
        return
      }

      // Local input: logout wins if already past logoutMs (e.g. after suspend).
      evaluateInactivity(at)
      if (logoutStartedRef.current) return

      lastActivityAtRef.current = Math.max(lastActivityAtRef.current, at)
      if (warningVisibleRef.current) {
        warningVisibleRef.current = false
        setWarningVisible(false)
      }
      setRemainingMs(logoutMs - warningMs)

      if (at - lastPersistAtRef.current >= activityThrottleMs) {
        lastPersistAtRef.current = at
        recordSharedTeacherActivity(at)
        broadcast.post({ type: 'activity', at })
      }
    }

    const onDomActivity = () => {
      noteActivity(now(), false)
    }

    for (const eventName of TEACHER_INACTIVITY_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onDomActivity, { passive: true, capture: true })
    }

    const unsubscribeBroadcast = broadcast.subscribe((message) => {
      if (message.type === 'activity') {
        noteActivity(message.at, true)
        return
      }
      if (message.type === 'force_logout') {
        void beginLogout(message.at)
      }
    })

    const onStorage = (event: StorageEvent) => {
      if (event.key !== TEACHER_INACTIVITY_STORAGE_KEY) return
      evaluateInactivity(now())
    }
    window.addEventListener('storage', onStorage)

    /** Background/suspend: timers may pause — re-check elapsed idle before continued use. */
    const onResumeSurface = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      evaluateInactivity(now())
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onResumeSurface()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onResumeSurface)
    window.addEventListener('pageshow', onResumeSurface)

    const tickId = window.setInterval(() => {
      evaluateInactivity(now())
    }, tickMs)

    return () => {
      window.clearTimeout(resetUiTimer)
      window.clearInterval(tickId)
      for (const eventName of TEACHER_INACTIVITY_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onDomActivity, true)
      }
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onResumeSurface)
      window.removeEventListener('pageshow', onResumeSurface)
      unsubscribeBroadcast()
      broadcast.close()
    }
  }, [activityThrottleMs, enabled, logoutMs, now, tickMs, warningMs])

  return {
    warningVisible: enabled ? warningVisible : false,
    remainingMs,
    continueWorking,
  }
}
