import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMemberDetails } from '../../types/staffDirectory'
import { StaffMemberDetailsModal } from './StaffMemberDetailsModal'

const { loadDetailsMock, updateMemberMock } = vi.hoisted(() => ({
  loadDetailsMock: vi.fn(),
  updateMemberMock: vi.fn(),
}))

vi.mock('../../services/staffDirectory', () => ({
  loadStaffMemberDetails: loadDetailsMock,
  updateStaffMember: updateMemberMock,
}))

const member: StaffMemberDetails = {
  id: 'teacher-1',
  fullName: 'יעל כהן',
  email: 'yael@school.com',
  phone: '050-1234567',
  jobTitle: 'מחנכת',
  weeklyHours: 24,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  nationalId: '123456789',
}

describe('StaffMemberDetailsModal', () => {
  beforeEach(() => {
    loadDetailsMock.mockReset()
    updateMemberMock.mockReset()
    loadDetailsMock.mockResolvedValue({ ok: true, member })
    updateMemberMock.mockResolvedValue({ ok: true })
  })

  it('keeps secretary details read-only and trusts server national ID redaction', async () => {
    loadDetailsMock.mockResolvedValue({
      ok: true,
      member: { ...member, nationalId: null },
    })

    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="teacher-1"
        canEdit={false}
        institutionName="בית ספר"
        onUpdated={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('יעל כהן')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'עריכת פרטים' })).not.toBeInTheDocument()
    expect(screen.queryByText('תעודת זהות')).not.toBeInTheDocument()
  })

  it('lets managers edit, saves through the service, and refreshes data', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn().mockResolvedValue(undefined)

    render(
      <StaffMemberDetailsModal
        isOpen
        memberId="teacher-1"
        canEdit
        institutionName="בית ספר"
        onUpdated={onUpdated}
        onClose={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'עריכת פרטים' }))
    const fullNameInput = screen.getByLabelText('שם מלא')
    await user.clear(fullNameInput)
    await user.type(fullNameInput, 'יעל לוי')
    await user.click(screen.getByRole('button', { name: 'שמירת שינויים' }))

    expect(updateMemberMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'teacher-1',
        fullName: 'יעל לוי',
        nationalId: '123456789',
      }),
    )
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('פרטי העובד עודכנו.')).toBeInTheDocument()
    expect(loadDetailsMock).toHaveBeenCalledTimes(2)
  })
})
