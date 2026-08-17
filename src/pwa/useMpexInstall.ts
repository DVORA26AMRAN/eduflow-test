import { useCallback, useEffect, useState } from 'react'
import { isIosLikeDevice, isStandaloneDisplayMode } from './displayMode'

/** Minimal shape of the Chromium install prompt event. */
export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type InstallMode =
  | 'unsupported'
  | 'browser_prompt'
  | 'ios_instructions'
  | 'installed'
  | 'manual_hint'

export type MpexInstallState = {
  mode: InstallMode
  canInstall: boolean
  isInstalled: boolean
  isIos: boolean
  showIosInstructions: boolean
  showManualHint: boolean
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable' | 'ios' | 'hint'>
  dismissIosInstructions: () => void
  dismissManualHint: () => void
}

let deferredPrompt: BeforeInstallPromptEventLike | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function captureBeforeInstallPrompt(event: Event) {
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEventLike
  notify()
}

function onAppInstalled() {
  deferredPrompt = null
  notify()
}

let listening = false

function ensureInstallListeners() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('beforeinstallprompt', captureBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
}

/**
 * Shared install capability hook for login + authenticated UI.
 * Install prompt is invoked only from explicit user action (`install`).
 */
export function useMpexInstall(): MpexInstallState {
  const [, setTick] = useState(0)
  const [showIosInstructions, setShowIosInstructions] = useState(false)
  const [showManualHint, setShowManualHint] = useState(false)
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplayMode())
  const isIos = isIosLikeDevice()

  useEffect(() => {
    ensureInstallListeners()
    const refresh = () => {
      setIsInstalled(isStandaloneDisplayMode())
      setTick((n) => n + 1)
    }
    listeners.add(refresh)
    refresh()
    return () => {
      listeners.delete(refresh)
    }
  }, [])

  const mode: InstallMode = isInstalled
    ? 'installed'
    : deferredPrompt
      ? 'browser_prompt'
      : isIos
        ? 'ios_instructions'
        : 'unsupported'

  const canInstall = mode === 'browser_prompt' || mode === 'ios_instructions'

  const install = useCallback(async () => {
    if (isStandaloneDisplayMode()) {
      setIsInstalled(true)
      return 'unavailable' as const
    }
    if (deferredPrompt) {
      const promptEvent = deferredPrompt
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      deferredPrompt = null
      notify()
      if (choice.outcome === 'accepted') {
        setIsInstalled(true)
      }
      return choice.outcome
    }
    if (isIosLikeDevice()) {
      setShowIosInstructions(true)
      return 'ios' as const
    }
    setShowManualHint(true)
    return 'hint' as const
  }, [])

  const dismissIosInstructions = useCallback(() => {
    setShowIosInstructions(false)
  }, [])

  const dismissManualHint = useCallback(() => {
    setShowManualHint(false)
  }, [])

  return {
    mode,
    canInstall,
    isInstalled,
    isIos,
    showIosInstructions,
    showManualHint,
    install,
    dismissIosInstructions,
    dismissManualHint,
  }
}
