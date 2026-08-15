import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchoolRegistrationPage } from './SchoolRegistrationPage'
import { SCHOOL_REGISTRATION_SUCCESS_MESSAGE } from '../types/schoolRegistration'

const submitMock = vi.hoisted(() => vi.fn())

vi.mock('../services/schoolRegistration', () => ({
  submitSchoolRegistration: submitMock,
}))

describe('SchoolRegistrationPage', () => {
  afterEach(() => {
    cleanup()
    submitMock.mockReset()
  })

  it('renders standalone intake without dashboard chrome', () => {
    render(<SchoolRegistrationPage />)
    expect(screen.getByLabelText('טופס הרשמת בית ספר')).toBeInTheDocument()
    expect(screen.queryByText('תפריט')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /התנתק/i })).not.toBeInTheDocument()
  })

  it('validates required fields before submit', async () => {
    const user = userEvent.setup()
    render(<SchoolRegistrationPage />)
    await user.click(screen.getByRole('button', { name: 'שליחת הרשמה' }))
    expect(submitMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('shows confirmation after successful submit and does not navigate away', async () => {
    submitMock.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<SchoolRegistrationPage />)

    await user.type(screen.getByLabelText('שם בית הספר'), 'בית ספר בדיקה')
    await user.type(screen.getByLabelText('סמל מוסד'), '998877')
    await user.type(screen.getByLabelText('עיר'), 'תל אביב')
    await user.selectOptions(screen.getByLabelText('תפקיד הפונה'), 'principal')
    await user.type(screen.getByLabelText('שם מלא'), 'תמר בדיקה')
    await user.type(screen.getByLabelText('אימייל'), 'tamar@example.com')
    await user.type(screen.getByLabelText('טלפון'), '050-1112233')
    await user.click(screen.getByRole('button', { name: 'שליחת הרשמה' }))

    expect(submitMock).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText(SCHOOL_REGISTRATION_SUCCESS_MESSAGE),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'שליחת הרשמה' })).not.toBeInTheDocument()
  })
})
