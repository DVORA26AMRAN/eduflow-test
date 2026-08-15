import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAdminRegistrationsSection } from './PlatformAdminRegistrationsSection'

const { listMock, getMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../../services/schoolRegistration', () => ({
  loadSchoolRegistrationsForPlatformAdmin: listMock,
  loadSchoolRegistrationForPlatformAdmin: getMock,
}))

describe('PlatformAdminRegistrationsSection', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({
      ok: true,
      registrations: [
        {
          id: 'reg-1',
          schoolName: 'בית ספר אלון',
          institutionSymbol: '112233',
          city: 'חיפה',
          applicantRole: 'principal',
          contactFullName: 'נועה כהן',
          email: 'noea@example.com',
          phone: '04-1111111',
          status: 'new',
          createdAt: '2026-08-16T10:00:00.000Z',
          updatedAt: '2026-08-16T10:00:00.000Z',
        },
      ],
    })
    getMock.mockResolvedValue({
      ok: true,
      registration: {
        id: 'reg-1',
        schoolName: 'בית ספר אלון',
        institutionSymbol: '112233',
        city: 'חיפה',
        applicantRole: 'principal',
        contactFullName: 'נועה כהן',
        email: 'noea@example.com',
        phone: '04-1111111',
        status: 'new',
        createdAt: '2026-08-16T10:00:00.000Z',
        updatedAt: '2026-08-16T10:00:00.000Z',
      },
    })
  })

  afterEach(() => {
    cleanup()
    listMock.mockReset()
    getMock.mockReset()
  })

  it('shows registration list for Platform Admin and public link actions', async () => {
    const user = userEvent.setup()
    render(<PlatformAdminRegistrationsSection />)

    expect(await screen.findByText('בית ספר אלון')).toBeInTheDocument()
    expect(screen.getByText('112233')).toBeInTheDocument()

    const urlEl = document.querySelector('.platform-admin-registrations__url')
    expect(urlEl?.textContent?.endsWith('/register-school')).toBe(true)
    expect(urlEl?.textContent?.startsWith('http')).toBe(true)

    expect(screen.getByRole('button', { name: 'העתקת קישור' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'תצוגה מקדימה' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'העתקת קישור' }))
  })

  it('opens registration details', async () => {
    const user = userEvent.setup()
    render(<PlatformAdminRegistrationsSection />)
    await user.click(await screen.findByRole('button', { name: 'בית ספר אלון' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('פרטי הרשמה')).toBeInTheDocument()
    expect(getMock).toHaveBeenCalledWith('reg-1')
  })
})
