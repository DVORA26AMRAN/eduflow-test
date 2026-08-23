import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAdminRegistrationsSection } from './PlatformAdminRegistrationsSection'

const {
  listMock,
  getMock,
  notesMock,
  activityMock,
  statusMock,
  noteAddMock,
  followUpMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  notesMock: vi.fn(),
  activityMock: vi.fn(),
  statusMock: vi.fn(),
  noteAddMock: vi.fn(),
  followUpMock: vi.fn(),
}))

vi.mock('../../services/schoolRegistration', () => ({
  loadSchoolRegistrationsForPlatformAdmin: listMock,
  loadSchoolRegistrationForPlatformAdmin: getMock,
  loadSchoolRegistrationNotesForPlatformAdmin: notesMock,
  loadSchoolRegistrationActivityForPlatformAdmin: activityMock,
  updateSchoolRegistrationStatusForPlatformAdmin: statusMock,
  addSchoolRegistrationNoteForPlatformAdmin: noteAddMock,
  setSchoolRegistrationFollowUpForPlatformAdmin: followUpMock,
}))

const baseRegistration = {
  id: 'reg-1',
  schoolName: 'בית ספר אלון',
  institutionSymbol: '112233',
  city: 'חיפה',
  applicantRole: 'principal' as const,
  contactFullName: 'נועה כהן',
  email: 'noea@example.com',
  phone: '04-1111111',
  status: 'new' as const,
  followUpAt: null,
  marketingConsent: false,
  marketingConsentAt: null,
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
}

describe('PlatformAdminRegistrationsSection', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({
      ok: true,
      registrations: [baseRegistration],
    })
    getMock.mockResolvedValue({
      ok: true,
      registration: baseRegistration,
    })
    notesMock.mockResolvedValue({ ok: true, notes: [] })
    activityMock.mockResolvedValue({
      ok: true,
      activities: [
        {
          id: 'act-1',
          registrationId: 'reg-1',
          eventType: 'registration_created',
          actorUserId: null,
          payload: {},
          createdAt: '2026-08-16T10:00:00.000Z',
        },
      ],
    })
    statusMock.mockResolvedValue({ ok: true })
    noteAddMock.mockResolvedValue({ ok: true })
    followUpMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    listMock.mockReset()
    getMock.mockReset()
    notesMock.mockReset()
    activityMock.mockReset()
    statusMock.mockReset()
    noteAddMock.mockReset()
    followUpMock.mockReset()
  })

  it('shows registration list for Platform Admin and public link actions', async () => {
    const user = userEvent.setup()
    render(<PlatformAdminRegistrationsSection />)

    expect(await screen.findByText('בית ספר אלון')).toBeInTheDocument()
    expect(screen.getByText('112233')).toBeInTheDocument()
    expect(screen.getByText('חדש')).toBeInTheDocument()

    const urlEl = document.querySelector('.platform-admin-registrations__url')
    expect(urlEl?.textContent?.endsWith('/register-school')).toBe(true)
    expect(urlEl?.textContent?.startsWith('http')).toBe(true)

    expect(screen.getByRole('button', { name: 'העתקת קישור' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'תצוגה מקדימה' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'העתקת קישור' }))
  })

  it('shows marketing consent column in the registration table', async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      registrations: [
        { ...baseRegistration, marketingConsent: true, marketingConsentAt: '2026-08-16T10:00:00.000Z' },
        {
          ...baseRegistration,
          id: 'reg-2',
          schoolName: 'בית ספר שקד',
          marketingConsent: false,
          marketingConsentAt: null,
        },
      ],
    })
    render(<PlatformAdminRegistrationsSection />)

    expect(await screen.findByRole('columnheader', { name: 'הסכמה לדיוור' })).toBeInTheDocument()
    expect(screen.getByText('כן')).toBeInTheDocument()
    expect(screen.getByText('לא')).toBeInTheDocument()
  })

  it('opens registration details with sales controls and timeline', async () => {
    const user = userEvent.setup()
    render(<PlatformAdminRegistrationsSection />)
    await user.click(await screen.findByRole('button', { name: 'בית ספר אלון' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('פרטי הרשמה')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /חייג/ })).toHaveAttribute(
      'href',
      'tel:04-1111111',
    )
    expect(screen.getByText('ציר פעילות')).toBeInTheDocument()
    expect(screen.getByText('ההרשמה נוצרה')).toBeInTheDocument()
    expect(getMock).toHaveBeenCalledWith('reg-1')
    expect(notesMock).toHaveBeenCalledWith('reg-1')
    expect(activityMock).toHaveBeenCalledWith('reg-1')
  })

  it('allows Platform Admin to add a note from details', async () => {
    const user = userEvent.setup()
    render(<PlatformAdminRegistrationsSection />)
    await user.click(await screen.findByRole('button', { name: 'בית ספר אלון' }))
    await screen.findByRole('dialog')
    await user.type(screen.getByPlaceholderText('הוספת הערה פנימית…'), 'שיחה ראשונה')
    await user.click(screen.getByRole('button', { name: 'הוספת הערה' }))
    expect(noteAddMock).toHaveBeenCalledWith('reg-1', 'שיחה ראשונה')
  })
})
