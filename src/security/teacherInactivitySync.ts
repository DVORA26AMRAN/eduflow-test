import {
  TEACHER_INACTIVITY_BROADCAST_CHANNEL,
  TEACHER_INACTIVITY_STORAGE_KEY,
  createTeacherInactivitySharedState,
  readTeacherInactivitySharedState,
  writeTeacherInactivitySharedState,
  type TeacherInactivityBroadcastMessage,
  type TeacherInactivitySharedState,
} from './teacherInactivityPolicy'

export function loadSharedTeacherInactivityState(): TeacherInactivitySharedState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return readTeacherInactivitySharedState(
      localStorage.getItem(TEACHER_INACTIVITY_STORAGE_KEY),
    )
  } catch {
    return null
  }
}

export function persistSharedTeacherInactivityState(
  state: TeacherInactivitySharedState,
): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      TEACHER_INACTIVITY_STORAGE_KEY,
      writeTeacherInactivitySharedState(state),
    )
  } catch {
    // Ignore quota / private-mode failures; in-tab timer still works.
  }
}

export function clearSharedTeacherInactivityState(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(TEACHER_INACTIVITY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function recordSharedTeacherActivity(at: number): TeacherInactivitySharedState {
  const existing = loadSharedTeacherInactivityState()
  const next: TeacherInactivitySharedState = {
    lastActivityAt: Math.max(at, existing?.lastActivityAt ?? at),
    forceLogoutAt: existing?.forceLogoutAt ?? null,
  }
  // Activity after a forced logout must not clear forceLogoutAt — logout wins.
  if (existing?.forceLogoutAt != null) {
    return existing
  }
  persistSharedTeacherInactivityState(next)
  return next
}

export function markSharedTeacherForceLogout(at: number): TeacherInactivitySharedState {
  const existing = loadSharedTeacherInactivityState()
  const next: TeacherInactivitySharedState = {
    lastActivityAt: existing?.lastActivityAt ?? at,
    forceLogoutAt: at,
  }
  persistSharedTeacherInactivityState(next)
  return next
}

export function createTeacherInactivityBroadcast(): {
  post: (message: TeacherInactivityBroadcastMessage) => void
  subscribe: (handler: (message: TeacherInactivityBroadcastMessage) => void) => () => void
  close: () => void
} {
  let channel: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(TEACHER_INACTIVITY_BROADCAST_CHANNEL)
    } catch {
      channel = null
    }
  }

  return {
    post(message) {
      channel?.postMessage(message)
    },
    subscribe(handler) {
      if (!channel) return () => undefined
      const listener = (event: MessageEvent<TeacherInactivityBroadcastMessage>) => {
        if (!event.data || typeof event.data !== 'object') return
        handler(event.data)
      }
      channel.addEventListener('message', listener)
      return () => channel?.removeEventListener('message', listener)
    },
    close() {
      channel?.close()
      channel = null
    },
  }
}

export function bootstrapTeacherInactivitySharedClock(now: number): number {
  const shared = loadSharedTeacherInactivityState()
  if (!shared || shared.forceLogoutAt != null) {
    const fresh = createTeacherInactivitySharedState(now)
    persistSharedTeacherInactivityState(fresh)
    return fresh.lastActivityAt
  }
  return shared.lastActivityAt
}
