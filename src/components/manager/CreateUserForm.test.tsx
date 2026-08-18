import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateUserForm } from './CreateUserForm'

const baseProps = {
  newUserName: '',
  newUserEmail: '',
  newUserRole: 'teacher' as const,
  newUserPhone: '',
  newUserNationalId: '',
  newUserJobTitle: '',
  newUserWeeklyHours: '',
  message: '',
  onNewUserNameChange: vi.fn(),
  onNewUserEmailChange: vi.fn(),
  onNewUserRoleChange: vi.fn(),
  onNewUserPhoneChange: vi.fn(),
  onNewUserNationalIdChange: vi.fn(),
  onNewUserJobTitleChange: vi.fn(),
  onNewUserWeeklyHoursChange: vi.fn(),
  onCreateUser: vi.fn(),
}

describe('CreateUserForm role allow-list', () => {
  afterEach(() => {
    cleanup()
  })

  it('manager mode keeps teacher, secretary, and deputy role options', () => {
    render(<CreateUserForm {...baseProps} />)

    expect(screen.getByRole('combobox', { name: 'תפקיד במערכת' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מורה' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מזכירה' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'סגנית' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'מנהלת' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'מנהל/ת מערכת' })).not.toBeInTheDocument()
  })

  it('deputy mode keeps teacher and secretary only', () => {
    render(<CreateUserForm {...baseProps} allowedRoles={['teacher', 'secretary']} />)

    expect(screen.getByRole('combobox', { name: 'תפקיד במערכת' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מורה' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'מזכירה' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'סגנית' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'מנהלת' })).not.toBeInTheDocument()
  })

  it('secretary teacher-only mode locks role and keeps teacher profile fields', async () => {
    const user = userEvent.setup({ delay: null })

    render(<CreateUserForm {...baseProps} allowedRoles={['teacher']} />)

    expect(screen.queryByRole('combobox', { name: 'תפקיד במערכת' })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('מורה')).toBeInTheDocument()
    expect(screen.getByLabelText('טלפון')).toBeInTheDocument()
    expect(screen.getByLabelText('תעודת זהות')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמירת משתמש' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('שם מלא'), 'יעל')
    expect(baseProps.onNewUserNameChange).toHaveBeenCalled()
  })
})
