import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TEACHER_INACTIVITY_ACTIVITY_THROTTLE_MS,
  TEACHER_INACTIVITY_LOGOUT_MS,
  TEACHER_INACTIVITY_STORAGE_KEY,
  TEACHER_INACTIVITY_TICK_MS,
  TEACHER_INACTIVITY_WARNING_MS,
  TEACHER_INACTIVITY_WARNING_ROOT_ATTR,
  mergeTeacherActivityTimestamp,
  remainingWarningMs,
  shouldLogoutForTeacherInactivity,
  shouldOpenTeacherInactivityWarning,
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

/** Stable default — must not be recreated per render (would re-register the effect). */
const defaultNow = () => Date.now()

function isEventFromWarningDialog(event: Event): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  return target.closest(`[${TEACHER_INACTIVITY_WARNING_ROOT_ATTR}]`) != null
}

/**
 * Teacher-only inactivity warning (4m) and canonical logout (5m).
 * Cross-tab last-activity + force-logout via localStorage + BroadcastChannel.
 *
 * Warning is latched open until continue, qualifying outside activity, or logout.
 */
export function useTeacherInactivityLogout({
  enabled,
  onLogout,
  warningMs = TEACHER_INACTIVITY_WARNING_MS,
  logoutMs = TEACHER_INACTIVITY_LOGOUT_MS,
  tickMs = TEACHER_INACTIVITY_TICK_MS,
  activityThrottleMs = TEACHER_INACTIVITY_ACTIVITY_THROTTLE_MS,
  now = defaultNow,
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
  const nowRef = useRef(now)
  const warningMsRef = useRef(warningMs)
  const logoutMsRef = useRef(logoutMs)
  const activityThrottleMsRef = useRef(activityThrottleMs)

  useEffect(() => {
    onLogoutRef.current = onLogout
  }, [onLogout])

  useEffect(() => {
    nowRef.current = now
  }, [now])

  useEffect(() => {
    warningMsRef.current = warningMs
    logoutMsRef.current = logoutMs
    activityThrottleMsRef.current = activityThrottleMs
  }, [activityThrottleMs, logoutMs, warningMs])

  const dismissWarningAndReset = useCallback((at: number) => {
    lastActivityAtRef.current = at
    warningVisibleRef.current = false
    setWarningVisible(false)
    setRemainingMs(logoutMsRef.current - warningMsRef.current)
    recordSharedTeacherActivity(at)
  }, [])

  const continueWorking = useCallback(() => {
    if (logoutStartedRef.current) return
    const at = nowRef.current()
    const shared = loadSharedTeacherInactivityState()
    lastActivityAtRef.current = mergeTeacherActivityTimestamp(
      lastActivityAtRef.current,
      shared,
    )
    if (
      shouldLogoutForTeacherInactivity({
        now: at,
        lastActivityAt: lastActivityAtRef.current,
        logoutMs: logoutMsRef.current,
        forceLogoutAt: shared?.forceLogoutAt ?? null,
      })
    ) {
      logoutStartedRef.current = true
      warningVisibleRef.current = false
      setWarningVisible(false)
      markSharedTeacherForceLogout(at)
      void onLogoutRef.current()
      return
    }
    dismissWarningAndReset(at)
  }, [dismissWarningAndReset])

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

    const startedAt = nowRef.current()
    lastActivityAtRef.current = bootstrapTeacherInactivitySharedClock(startedAt)
    logoutStartedRef.current = false
    lastPersistAtRef.current = 0
    // Do not clear a latched warning here — effect must not toggle open/closed on re-entry.

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

    const updateCountdown = (current: number, lastActivityAt: number) => {
      const next = remainingWarningMs({
        now: current,
        lastActivityAt,
        logoutMs: logoutMsRef.current,
      })
      setRemainingMs((prev) =>
        Math.ceil(prev / 1000) === Math.ceil(next / 1000) ? prev : next,
      )
    }

    /**
     * Evaluate idle / force-logout.
     * Warning is latched: once open, ticks only refresh countdown until dismiss or logout.
     */
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
      const logoutMs = logoutMsRef.current
      const warningMs = warningMsRef.current

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

      if (warningVisibleRef.current) {
        updateCountdown(current, lastActivityAt)
        return
      }

      if (
        shouldOpenTeacherInactivityWarning({
          now: current,
          lastActivityAt,
          warningMs,
          logoutMs,
        })
      ) {
        warningVisibleRef.current = true
        setWarningVisible(true)
        updateCountdown(current, lastActivityAt)
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
        setRemainingMs(logoutMsRef.current - warningMsRef.current)
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
      setRemainingMs(logoutMsRef.current - warningMsRef.current)

      if (at - lastPersistAtRef.current >= activityThrottleMsRef.current) {
        lastPersistAtRef.current = at
        recordSharedTeacherActivity(at)
        broadcast.post({ type: 'activity', at })
      }
    }

    const onDomActivity = (event: Event) => {
      // Dialog owns Continue — ignore capture-phase activity inside the warning UI
      // so the button stays clickable and we do not close/reopen from dialog chrome.
      if (isEventFromWarningDialog(event)) return
      noteActivity(nowRef.current(), false)
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
      const shared = loadSharedTeacherInactivityState()
      if (!shared) return
      if (shared.forceLogoutAt != null) {
        void beginLogout(shared.forceLogoutAt)
        return
      }
      const previous = lastActivityAtRef.current
      lastActivityAtRef.current = mergeTeacherActivityTimestamp(previous, shared)
      // Remote activity via storage (BroadcastChannel may be unavailable): dismiss once, no reopen loop.
      if (shared.lastActivityAt > previous) {
        if (warningVisibleRef.current) {
          warningVisibleRef.current = false
          setWarningVisible(false)
        }
        setRemainingMs(logoutMsRef.current - warningMsRef.current)
        return
      }
      evaluateInactivity(nowRef.current())
    }
    window.addEventListener('storage', onStorage)

    /** Background/suspend: timers may pause — re-check elapsed idle before continued use. */
    const onResumeSurface = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      evaluateInactivity(nowRef.current())
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
      evaluateInactivity(nowRef.current())
    }, tickMs)

    return () => {
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
    // `now` intentionally omitted — read via nowRef so identity churn cannot re-latch/clear warning.
  }, [activityThrottleMs, enabled, logoutMs, tickMs, warningMs])

  return {
    warningVisible: enabled ? warningVisible : false,
    remainingMs,
    continueWorking,
  }
}
