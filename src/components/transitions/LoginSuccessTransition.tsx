import { useCallback, useEffect, useRef } from 'react'
import transitionLogo from '../../assets/branding/m-transition-logo.png.png'
import './LoginSuccessTransition.css'

const STANDARD_TRANSITION_DURATION_MS = 1550
const REDUCED_MOTION_DURATION_MS = 450

type LoginSuccessTransitionProps = {
  onComplete: () => void
}

export function LoginSuccessTransition({ onComplete }: LoginSuccessTransitionProps) {
  const hasCompletedRef = useRef(false)

  const complete = useCallback(() => {
    if (hasCompletedRef.current) {
      return
    }

    hasCompletedRef.current = true
    onComplete()
  }, [onComplete])

  useEffect(() => {
    try {
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const duration = prefersReducedMotion
        ? REDUCED_MOTION_DURATION_MS
        : STANDARD_TRANSITION_DURATION_MS
      const timerId = window.setTimeout(complete, duration)

      return () => {
        window.clearTimeout(timerId)
      }
    } catch (error) {
      console.error('[LoginSuccessTransition] animation setup failed', error)
      complete()
      return
    }
  }, [complete])

  return (
    <div className="login-success-transition" aria-hidden="true">
      <div className="login-success-transition__logo-frame" aria-hidden="true">
        <img
          className="login-success-transition__logo"
          src={transitionLogo}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={complete}
        />
      </div>
    </div>
  )
}
