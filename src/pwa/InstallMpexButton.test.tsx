import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallMpexButton, INSTALL_LABEL } from './InstallMpexButton'

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('appinstalled'))
  vi.unstubAllGlobals()
})

describe('InstallMpexButton', () => {
  it('renders the Hebrew install action', () => {
    render(<InstallMpexButton variant="login" />)
    expect(screen.getByRole('button', { name: INSTALL_LABEL })).toBeInTheDocument()
  })

  it('shows iOS Home Screen instructions on explicit click when iOS-like', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: false,
    })
    const user = userEvent.setup()
    render(<InstallMpexButton variant="login" />)
    await user.click(screen.getByRole('button', { name: INSTALL_LABEL }))
    expect(screen.getByTestId('install-mpex-ios-instructions')).toBeInTheDocument()
    expect(screen.getByText('הוספת MPEX למסך הבית')).toBeInTheDocument()
  })

  it('invokes deferred browser install prompt only from button click', async () => {
    const prompt = vi.fn(async () => undefined)
    const userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })

    render(<InstallMpexButton variant="header" />)

    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: typeof prompt
      userChoice: typeof userChoice
    }
    Object.defineProperty(event, 'prompt', { value: prompt })
    Object.defineProperty(event, 'userChoice', { value: userChoice })
    window.dispatchEvent(event)

    await waitFor(() => {
      expect(screen.getByTestId('install-mpex')).toHaveAttribute(
        'data-install-mode',
        'browser_prompt',
      )
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: INSTALL_LABEL }))
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})
