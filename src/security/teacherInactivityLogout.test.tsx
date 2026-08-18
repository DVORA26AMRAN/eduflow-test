import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeacherInactivityLogout } from '../hooks/useTeacherInactivityLogout'
import { TeacherInactivityWarningDialog } from '../components/security/TeacherInactivityWarningDialog'
import {
  TEACHER_INACTIVITY_CONTINUE_LABEL,
  TEACHER_INACTIVITY_STORAGE_KEY,
  TEACHER_INACTIVITY_WARNING_TEXT,
} from './teacherInactivityPolicy'
import { clearSharedTeacherInactivityState } from './teacherInactivitySync'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function Harness({
  enabled,
  onLogout,
  warningMs = 400,
  logoutMs = 500,
  tickMs = 20,
  now,
}: {
  enabled: boolean
  onLogout: () => void
  warningMs?: number
  logoutMs?: number
  tickMs?: number
  now: () => number
}) {
  const state = useTeacherInactivityLogout({
    enabled,
    onLogout,
    warningMs,
    logoutMs,
    tickMs,
    activityThrottleMs: 0,
    now,
  })

  return (
    <div>
      <span data-testid="warning-flag">{String(state.warningVisible)}</span>
      <TeacherInactivityWarningDialog
        isOpen={state.warningVisible}
        remainingMs={state.remainingMs}
        onContinueWorking={state.continueWorking}
      />
    </div>
  )
}

describe('useTeacherInactivityLogout', () => {
  let clock = 0

  beforeEach(() => {
    clock = 0
    clearSharedTeacherInactivityState()
    logoutStarted = false
  })

  afterEach(() => {
    cleanup()
    clearSharedTeacherInactivityState()
    vi.useRealTimers()
  })

  let logoutStarted = false

  it('does not activate when enabled is false (non-teacher / login)', async () => {
    vi.useFakeTimers()
    const onLogout = vi.fn()
    render(
      <Harness
        enabled={false}
        onLogout={onLogout}
        now={() => {
          clock += 50
          return clock
        }}
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByTestId('warning-flag')).toHaveTextContent('false')
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('warns after warningMs then logs out after logoutMs', async () => {
    vi.useFakeTimers()
    clock = 1_000
    const onLogout = vi.fn(async () => {
      logoutStarted = true
    })
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 1_000 + 410
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()
    expect(screen.getByText(TEACHER_INACTIVITY_WARNING_TEXT)).toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()

    await act(async () => {
      clock = 1_000 + 520
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(logoutStarted).toBe(true)
  })

  it('continue-work resets timeout and closes warning', async () => {
    vi.useFakeTimers()
    clock = 5_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 5_420
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()

    await act(async () => {
      clock = 5_430
      fireEvent.click(screen.getByRole('button', { name: TEACHER_INACTIVITY_CONTINUE_LABEL }))
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()

    await act(async () => {
      clock = 5_700
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('pointer activity resets idle before warning', async () => {
    vi.useFakeTimers()
    clock = 10_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 10_300
      await vi.advanceTimersByTimeAsync(30)
      window.dispatchEvent(new Event('pointerdown'))
    })

    await act(async () => {
      // 350ms after activity — still under 400ms warning threshold
      clock = 10_650
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('force-logout shared via storage ends session in this context', async () => {
    vi.useFakeTimers()
    clock = 20_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={10_000}
        logoutMs={20_000}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      localStorage.setItem(
        TEACHER_INACTIVITY_STORAGE_KEY,
        JSON.stringify({ lastActivityAt: 20_000, forceLogoutAt: 20_100 }),
      )
      window.dispatchEvent(
        new StorageEvent('storage', { key: TEACHER_INACTIVITY_STORAGE_KEY }),
      )
      await vi.advanceTimersByTimeAsync(30)
    })

    expect(onLogout).toHaveBeenCalled()
  })

  it('on visibility resume after logoutMs idle, logs out immediately without waiting for tick', async () => {
    vi.useFakeTimers()
    clock = 40_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={60_000}
        now={now}
      />,
    )

    await act(async () => {
      // Suspend past logout threshold; long tick would not fire yet.
      clock = 40_000 + 600
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('on window focus after logoutMs idle, logs out immediately', async () => {
    vi.useFakeTimers()
    clock = 50_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={60_000}
        now={now}
      />,
    )

    await act(async () => {
      clock = 50_000 + 600
      window.dispatchEvent(new Event('focus'))
    })

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('first pointerdown after expiry logs out instead of extending the session', async () => {
    vi.useFakeTimers()
    clock = 60_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={60_000}
        now={now}
      />,
    )

    await act(async () => {
      clock = 60_000 + 600
      window.dispatchEvent(new Event('pointerdown'))
    })

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('visibility/focus resume does not count as activity when still under logoutMs', async () => {
    vi.useFakeTimers()
    clock = 70_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={60_000}
        now={now}
      />,
    )

    await act(async () => {
      clock = 70_000 + 410
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()

    await act(async () => {
      // Still past original lastActivity + logout if resume had wrongly reset activity.
      clock = 70_000 + 520
      window.dispatchEvent(new Event('focus'))
    })

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('warning opens once and does not flicker across subsequent ticks', async () => {
    vi.useFakeTimers()
    clock = 80_000
    const onLogout = vi.fn()
    const now = () => clock
    const { rerender } = render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 80_000 + 410
      await vi.advanceTimersByTimeAsync(30)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()
    expect(screen.getByTestId('warning-flag')).toHaveTextContent('true')

    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        clock = 80_000 + 420 + i * 10
        // Recreate default now identity the way App does when parent re-renders.
        rerender(
          <Harness
            enabled
            onLogout={onLogout}
            warningMs={400}
            logoutMs={500}
            tickMs={25}
            now={now}
          />,
        )
        await vi.advanceTimersByTimeAsync(25)
      })
      expect(screen.getByTestId('warning-flag')).toHaveTextContent('true')
      expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()
    }
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('Continue stays actionable despite pointerdown on the dialog (no capture dismiss)', async () => {
    vi.useFakeTimers()
    clock = 90_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 90_000 + 410
      await vi.advanceTimersByTimeAsync(30)
    })
    const button = screen.getByRole('button', { name: TEACHER_INACTIVITY_CONTINUE_LABEL })

    await act(async () => {
      clock = 90_000 + 420
      fireEvent.pointerDown(button)
    })
    // Dialog must remain open so Continue can receive the click.
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()

    await act(async () => {
      clock = 90_000 + 430
      fireEvent.click(button)
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('Continue resets inactivity and does not reopen immediately', async () => {
    vi.useFakeTimers()
    clock = 100_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 100_000 + 410
      await vi.advanceTimersByTimeAsync(30)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()

    await act(async () => {
      clock = 100_000 + 420
      fireEvent.click(screen.getByRole('button', { name: TEACHER_INACTIVITY_CONTINUE_LABEL }))
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()

    await act(async () => {
      // Well under warningMs after continue timestamp 100_420
      clock = 100_000 + 700
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('ignored warning still logs out at logoutMs', async () => {
    vi.useFakeTimers()
    clock = 110_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 110_000 + 410
      await vi.advanceTimersByTimeAsync(30)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()

    await act(async () => {
      clock = 110_000 + 520
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('multi-tab storage activity dismisses warning once without oscillation', async () => {
    vi.useFakeTimers()
    clock = 120_000
    const onLogout = vi.fn()
    const now = () => clock

    render(
      <Harness
        enabled
        onLogout={onLogout}
        warningMs={400}
        logoutMs={500}
        tickMs={25}
        now={now}
      />,
    )

    await act(async () => {
      clock = 120_000 + 410
      await vi.advanceTimersByTimeAsync(30)
    })
    expect(screen.getByTestId('teacher-inactivity-warning')).toBeInTheDocument()

    await act(async () => {
      clock = 120_000 + 430
      localStorage.setItem(
        TEACHER_INACTIVITY_STORAGE_KEY,
        JSON.stringify({ lastActivityAt: 120_000 + 430, forceLogoutAt: null }),
      )
      window.dispatchEvent(
        new StorageEvent('storage', { key: TEACHER_INACTIVITY_STORAGE_KEY }),
      )
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()

    await act(async () => {
      clock = 120_000 + 450
      localStorage.setItem(
        TEACHER_INACTIVITY_STORAGE_KEY,
        JSON.stringify({ lastActivityAt: 120_000 + 430, forceLogoutAt: null }),
      )
      window.dispatchEvent(
        new StorageEvent('storage', { key: TEACHER_INACTIVITY_STORAGE_KEY }),
      )
      await vi.advanceTimersByTimeAsync(80)
    })
    expect(screen.queryByTestId('teacher-inactivity-warning')).not.toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })
})

describe('teacher inactivity architecture wiring', () => {
  it('App enables policy from authoritative profile.role teacher only and uses canonical logout', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toContain('isTeacherInactivityRole(currentProfile?.role)')
    expect(app).toContain('logoutFromTeacherInactivity')
    expect(app).toContain('useTeacherInactivityLogout')
    expect(app).toContain('TeacherInactivityWarningDialog')
    expect(app).toMatch(/async function logoutFromTeacherInactivity[\s\S]*setPassword\(''\)/)
    expect(app).toMatch(/async function logoutFromTeacherInactivity[\s\S]*await logout\(\)/)
  })

  it('does not treat network/realtime as activity sources in the hook', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'src/hooks/useTeacherInactivityLogout.ts'),
      'utf8',
    )
    expect(hook).toContain("['pointerdown', 'keydown']")
    expect(hook).not.toContain("'click'")
    expect(hook).not.toContain("'touchstart'")
    expect(hook).not.toContain("'mousemove'")
    expect(hook).toContain('visibilitychange')
    expect(hook).toContain('pageshow')
    expect(hook).toContain('nowRef')
    expect(hook).toContain('isEventFromWarningDialog')
    expect(hook).toContain('shouldOpenTeacherInactivityWarning')
    expect(hook).not.toContain('fetch(')
    expect(hook).not.toContain('supabase')
    expect(hook).not.toContain('websocket')
  })

  it('warning dialog marks root so capture-phase activity ignores Continue chrome', () => {
    const dialog = readFileSync(
      resolve(process.cwd(), 'src/components/security/TeacherInactivityWarningDialog.tsx'),
      'utf8',
    )
    expect(dialog).toContain('data-teacher-inactivity-warning')
  })

  it('installed app and website share App-level teacher policy (no separate PWA timer)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const pwaInstall = readFileSync(
      resolve(process.cwd(), 'src/pwa/useMpexInstall.ts'),
      'utf8',
    )
    expect(app).toContain('useTeacherInactivityLogout')
    expect(pwaInstall).not.toContain('Inactivity')
    expect(pwaInstall).not.toContain('signOut')
  })
})
