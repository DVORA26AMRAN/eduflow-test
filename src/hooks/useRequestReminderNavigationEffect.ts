import { useEffect, useRef } from 'react'
import type { ReminderNavigationIntent, ReminderRequestLocation } from '../types/reminderNavigation'
import { focusRequestRow } from '../utils/requestRowNavigation'

type UseRequestReminderNavigationEffectOptions = {
  intent: ReminderNavigationIntent | null
  expectedLocationKind: ReminderRequestLocation['kind']
  isReady: boolean
  isRequestInDataset: (requestId: string) => boolean
  isRequestVisible: (requestId: string) => boolean
  revealRequest: (requestId: string) => void
  onComplete: (token: number, found: boolean) => void
}

export function useRequestReminderNavigationEffect({
  intent,
  expectedLocationKind,
  isReady,
  isRequestInDataset,
  isRequestVisible,
  revealRequest,
  onComplete,
}: UseRequestReminderNavigationEffectOptions) {
  const lastHandledToken = useRef(0)

  useEffect(() => {
    if (!intent || intent.location.kind !== expectedLocationKind) {
      return
    }

    if (intent.token === lastHandledToken.current) {
      return
    }

    if (!isReady) {
      return
    }

    const { requestId, token } = intent

    if (!isRequestInDataset(requestId)) {
      lastHandledToken.current = token
      onComplete(token, false)
      return
    }

    if (!isRequestVisible(requestId)) {
      revealRequest(requestId)
      return
    }

    const focused = focusRequestRow(requestId)
    lastHandledToken.current = token
    onComplete(token, focused)
  }, [
    intent,
    expectedLocationKind,
    isReady,
    isRequestInDataset,
    isRequestVisible,
    revealRequest,
    onComplete,
  ])
}
