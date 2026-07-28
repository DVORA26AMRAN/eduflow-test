import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleIntegrationSection } from './GoogleIntegrationSection'

const getGoogleConnectionStatus = vi.fn()
const startGoogleOAuth = vi.fn()
const disconnectGoogleOAuth = vi.fn()

vi.mock('../../services/googleOAuth', async () => {
  const actual = await vi.importActual<typeof import('../../services/googleOAuth')>(
    '../../services/googleOAuth',
  )
  return {
    ...actual,
    getGoogleConnectionStatus: (...args: unknown[]) => getGoogleConnectionStatus(...args),
    startGoogleOAuth: (...args: unknown[]) => startGoogleOAuth(...args),
    disconnectGoogleOAuth: (...args: unknown[]) => disconnectGoogleOAuth(...args),
    detectGoogleIntegrationReturn: () => null,
    clearGoogleIntegrationReturnFromUrl: () => undefined,
  }
})

describe('GoogleIntegrationSection UI states', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    getGoogleConnectionStatus.mockReset()
    startGoogleOAuth.mockReset()
    disconnectGoogleOAuth.mockReset()
  })

  it('shows not connected CTA', async () => {
    getGoogleConnectionStatus.mockResolvedValue({
      ok: true,
      connected: false,
      connectionStatus: 'not_connected',
      email: null,
    })
    render(<GoogleIntegrationSection />)
    expect(await screen.findByText('חשבון Google אינו מחובר.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'חבר חשבון Google' })).toBeInTheDocument()
  })

  it('shows connected email and disconnect', async () => {
    getGoogleConnectionStatus.mockResolvedValue({
      ok: true,
      connected: true,
      connectionStatus: 'connected',
      email: 'mgr@school.example',
    })
    render(<GoogleIntegrationSection />)
    expect(await screen.findByText(/mgr@school.example/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'נתק חשבון Google' })).toBeInTheDocument()
  })

  it('shows reauthorization required', async () => {
    getGoogleConnectionStatus.mockResolvedValue({
      ok: true,
      connected: false,
      connectionStatus: 'reauthorization_required',
      email: 'mgr@school.example',
    })
    render(<GoogleIntegrationSection />)
    expect(await screen.findByText(/נדרש אישור מחדש/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר מחדש חשבון Google' })).toBeInTheDocument()
  })

  it('enters connecting state when starting OAuth', async () => {
    getGoogleConnectionStatus.mockResolvedValue({
      ok: true,
      connected: false,
      connectionStatus: 'not_connected',
      email: null,
    })
    startGoogleOAuth.mockImplementation(
      () => new Promise(() => undefined), // leave pending
    )
    const user = userEvent.setup()
    render(<GoogleIntegrationSection />)
    await screen.findByRole('button', { name: 'חבר חשבון Google' })
    await user.click(screen.getByRole('button', { name: 'חבר חשבון Google' }))
    expect(await screen.findByText('החיבור בתהליך...')).toBeInTheDocument()
  })

  it('shows failed state when start fails', async () => {
    getGoogleConnectionStatus.mockResolvedValue({
      ok: true,
      connected: false,
      connectionStatus: 'not_connected',
      email: null,
    })
    startGoogleOAuth.mockResolvedValue({ ok: false, errorMessage: 'forbidden' })
    const user = userEvent.setup()
    render(<GoogleIntegrationSection />)
    await screen.findByRole('button', { name: 'חבר חשבון Google' })
    await user.click(screen.getByRole('button', { name: 'חבר חשבון Google' }))
    expect(await screen.findByText('אין הרשאה לחבר חשבון Google.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'נסה שוב' })).toBeInTheDocument()
  })
})
