import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffDirectoryMember } from '../types/staffDirectory'
import { StaffDirectoryPage } from './StaffDirectoryPage'

const { loadDirectoryMock } = vi.hoisted(() => ({
  loadDirectoryMock: vi.fn(),
}))

vi.mock('../services/staffDirectory', () => ({
  loadStaffDirectory: loadDirectoryMock,
  loadStaffMemberDetails: vi.fn(),
  updateStaffMember: vi.fn(),
}))

const members: StaffDirectoryMember[] = [
  {
    id: 't1',
    fullName: 'דני כהן',
    email: 'danny@school.com',
    phone: '050-1111111',
    jobTitle: 'מחנך',
    weeklyHours: 30,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't2',
    fullName: 'יעל לוי',
    email: null,
    phone: '052-2222222',
    jobTitle: null,
    weeklyHours: 22,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
]

describe('StaffDirectoryPage loading', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadDirectoryMock.mockReset()
    loadDirectoryMock.mockResolvedValue({ ok: true, members })
  })

  it('mounts and calls loadStaffDirectory from its loading effect', async () => {
    loadDirectoryMock.mockResolvedValue({ ok: true, members: [] })

    render(<StaffDirectoryPage canEdit institutionName="בית ספר" />)

    await waitFor(() => {
      expect(loadDirectoryMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('לא נמצאו אנשי צוות.')).toBeInTheDocument()
  })

  it('loads the manager staff directory including null emails', async () => {
    render(<StaffDirectoryPage canEdit institutionName="בית ספר" />)

    expect(await screen.findByText('דני כהן')).toBeInTheDocument()
    expect(screen.getByText('יעל לוי')).toBeInTheDocument()
    expect(screen.getByText('danny@school.com')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('טעינת פרטי הצוות נכשלה.')).not.toBeInTheDocument()
  })

  it('loads the secretary staff directory with teacher onboarding and edit enabled', async () => {
    const onCreateUser = vi.fn()

    render(
      <StaffDirectoryPage
        canEdit
        institutionName="בית ספר"
        teacherOnboarding={{
          newUserName: '',
          newUserEmail: '',
          newUserRole: 'teacher',
          newUserPhone: '',
          newUserNationalId: '',
          newUserJobTitle: '',
          newUserWeeklyHours: '',
          createUserMessage: '',
          allowedRoles: ['teacher'],
          onNewUserNameChange: vi.fn(),
          onNewUserEmailChange: vi.fn(),
          onNewUserRoleChange: vi.fn(),
          onNewUserPhoneChange: vi.fn(),
          onNewUserNationalIdChange: vi.fn(),
          onNewUserJobTitleChange: vi.fn(),
          onNewUserWeeklyHoursChange: vi.fn(),
          onCreateUser,
        }}
      />,
    )

    expect(await screen.findByText('דני כהן')).toBeInTheDocument()
    expect(screen.getByTestId('create-user-form')).toBeInTheDocument()
    expect(screen.getByDisplayValue('מורה')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'מזכירה' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמירת משתמש' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /השבתה|מחיקה|הסרה/ })).not.toBeInTheDocument()
  })

  it('manager directory without onboarding slot has no create form', async () => {
    render(<StaffDirectoryPage canEdit institutionName="בית ספר" />)

    expect(await screen.findByText('דני כהן')).toBeInTheDocument()
    expect(screen.queryByTestId('create-user-form')).not.toBeInTheDocument()
  })

  it('still searches by name and phone when some emails are null', async () => {
    const user = userEvent.setup({ delay: null })
    render(<StaffDirectoryPage canEdit institutionName="בית ספר" />)

    await screen.findByText('דני כהן')
    await user.type(screen.getByPlaceholderText('חיפוש לפי שם, מייל או טלפון'), 'יעל')

    expect(screen.getByText('יעל לוי')).toBeInTheDocument()
    expect(screen.queryByText('דני כהן')).not.toBeInTheDocument()
  })
})
