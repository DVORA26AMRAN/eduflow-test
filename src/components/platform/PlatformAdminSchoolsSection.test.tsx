import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAdminSchoolsSection } from './PlatformAdminSchoolsSection'

const {
  loadListMock,
  loadOneMock,
  createMock,
  updateMock,
  loadManagerMock,
  inviteManagerMock,
  uploadLogoMock,
  removeLogoMock,
} = vi.hoisted(() => ({
  loadListMock: vi.fn(),
  loadOneMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  loadManagerMock: vi.fn(),
  inviteManagerMock: vi.fn(),
  uploadLogoMock: vi.fn(),
  removeLogoMock: vi.fn(),
}))

vi.mock('../../services/institutionAdmin', () => ({
  loadInstitutionsForPlatformAdmin: loadListMock,
  loadInstitutionForPlatformAdmin: loadOneMock,
  createInstitutionAsPlatformAdmin: createMock,
  updateInstitutionAsPlatformAdmin: updateMock,
  loadInstitutionManagerForPlatformAdmin: loadManagerMock,
  inviteInstitutionManagerAsPlatformAdmin: inviteManagerMock,
}))

vi.mock('../../services/institutionLogo', () => ({
  uploadInstitutionLogo: uploadLogoMock,
  removeInstitutionLogo: removeLogoMock,
}))

const institution = {
  id: 'inst-1',
  name: 'בית ספר א',
  institutionCode: '1001',
  address: 'רחוב 1',
  city: 'חיפה',
  phone: '04-1111111',
  email: 'a@school.com',
  logoUrl: null,
  logoUpdatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('PlatformAdminSchoolsSection', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadListMock.mockReset()
    loadOneMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
    loadManagerMock.mockReset()
    inviteManagerMock.mockReset()
    uploadLogoMock.mockReset()
    removeLogoMock.mockReset()
    loadListMock.mockResolvedValue({ ok: true, institutions: [institution] })
    loadOneMock.mockResolvedValue({ ok: true, institution })
    loadManagerMock.mockResolvedValue({ ok: true, manager: null })
  })

  it('lists institutions and opens details for edit', async () => {
    const user = userEvent.setup({ delay: null })
    render(<PlatformAdminSchoolsSection />)

    expect(await screen.findByText('בית ספר א')).toBeInTheDocument()
    expect(screen.getByText(/סמל: 1001/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /בית ספר א/ }))

    await waitFor(() => {
      expect(loadOneMock).toHaveBeenCalledWith('inst-1')
    })
    expect(screen.getByDisplayValue('בית ספר א')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמירת שינויים' })).toBeInTheDocument()
    expect(screen.getByText('לוגו בית הספר')).toBeInTheDocument()
    expect(screen.getByText('מנהלת בית הספר')).toBeInTheDocument()
    expect(screen.getByText('אין מנהלת משויכת')).toBeInTheDocument()
    expect(loadManagerMock).toHaveBeenCalledWith('inst-1')
  })

  it('creates a school through the shared form and reloads', async () => {
    const user = userEvent.setup({ delay: null })
    createMock.mockResolvedValue({ ok: true, institutionId: 'inst-2' })
    loadOneMock.mockResolvedValue({
      ok: true,
      institution: { ...institution, id: 'inst-2', name: 'בית ספר חדש', institutionCode: '2002' },
    })

    render(<PlatformAdminSchoolsSection />)
    await screen.findByText('בית ספר א')

    await user.click(screen.getByRole('button', { name: 'הוספת בית ספר' }))
    await user.type(screen.getByLabelText('שם בית הספר'), 'בית ספר חדש')
    await user.type(screen.getByLabelText('סמל מוסד'), '2002')
    await user.type(screen.getByLabelText('כתובת מלאה'), 'רחוב חדש 2')
    await user.type(screen.getByLabelText('עיר'), 'תל אביב')
    await user.type(screen.getByLabelText('טלפון'), '03-1234567')
    await user.type(screen.getByLabelText('אימייל'), 'new@school.com')
    await user.click(screen.getByRole('button', { name: 'שמירת בית ספר' }))

    await waitFor(() => {
      expect(createMock).toHaveBeenCalled()
    })
    expect(loadListMock.mock.calls.length).toBeGreaterThan(1)
  })
})
