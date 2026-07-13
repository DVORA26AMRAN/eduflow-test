import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const REMEMBER_EMAIL_LABEL = 'זכור את כתובת המייל'

afterEach(() => {
  cleanup()
})

function renderLoginPage(overrides: Partial<Parameters<typeof LoginPage>[0]> = {}) {
  const props = {
    email: '',
    password: '',
    rememberMe: false,
    message: '',
    onEmailChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onRememberMeChange: vi.fn(),
    onLogin: vi.fn(),
    ...overrides,
  }

  render(<LoginPage {...props} />)
  return props
}

describe('LoginPage remembered email', () => {
  it('displays the remembered-email checkbox below the password field', () => {
    renderLoginPage()

    const passwordField = screen.getByLabelText('סיסמה')
    const rememberCheckbox = screen.getByRole('checkbox', { name: REMEMBER_EMAIL_LABEL })

    expect(rememberCheckbox).toBeInTheDocument()
    expect(passwordField.compareDocumentPosition(rememberCheckbox)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('uses the exact remembered-email label', () => {
    renderLoginPage()

    expect(screen.getByRole('checkbox', { name: REMEMBER_EMAIL_LABEL })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'זכור אותי' })).not.toBeInTheDocument()
    expect(screen.queryByText('זכור אותי')).not.toBeInTheDocument()
  })

  it('prefills the email field from props on load', () => {
    renderLoginPage({ email: 'manager@school.edu', rememberMe: true })

    expect(screen.getByRole('textbox', { name: 'שם משתמש' })).toHaveValue('manager@school.edu')
    expect(screen.getByRole('checkbox', { name: REMEMBER_EMAIL_LABEL })).toBeChecked()
  })

  it('uses password manager friendly autocomplete attributes', () => {
    renderLoginPage()

    expect(screen.getByRole('textbox', { name: 'שם משתמש' })).toHaveAttribute(
      'autocomplete',
      'username',
    )
    expect(screen.getByLabelText('סיסמה')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('keeps right-to-left layout on the login screen', () => {
    renderLoginPage()

    expect(screen.getByLabelText('מסך התחברות').closest('main')).toHaveAttribute('dir', 'rtl')
  })

  it('renders the organization logo on the login screen', () => {
    renderLoginPage()

    expect(screen.getByRole('img', { name: 'לוגו הארגון' })).toBeInTheDocument()
  })

  it('supports keyboard and screen-reader interaction for the checkbox', async () => {
    const user = userEvent.setup()
    const props = renderLoginPage()

    const rememberCheckbox = screen.getByRole('checkbox', { name: REMEMBER_EMAIL_LABEL })
    rememberCheckbox.focus()
    await user.keyboard('[Space]')

    expect(props.onRememberMeChange).toHaveBeenCalledWith(true)
  })
})
