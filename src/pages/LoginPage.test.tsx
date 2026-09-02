import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

let standaloneMode = false

vi.mock('../pwa/displayMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pwa/displayMode')>()
  return {
    ...actual,
    isStandaloneDisplayMode: () => standaloneMode,
  }
})

const REMEMBER_EMAIL_LABEL = 'זכור את כתובת המייל'

afterEach(() => {
  cleanup()
  standaloneMode = false
})

function renderLoginPage(overrides: Partial<Parameters<typeof LoginPage>[0]> = {}) {
  const props = {
    email: '',
    password: '',
    rememberMe: false,
    message: '',
    isRequestingPasswordReset: false,
    onEmailChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onRememberMeChange: vi.fn(),
    onLogin: vi.fn(),
    onRequestPasswordReset: vi.fn(),
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

  it('shows the shared-computer password warning only in installed standalone mode', () => {
    standaloneMode = true
    renderLoginPage()

    expect(screen.getByTestId('installed-app-security-warning')).toBeInTheDocument()
    expect(screen.getByText('שימוש במחשב משותף')).toBeInTheDocument()
    expect(
      screen.getByText(/אם מחשב זה משמש כמה אנשי צוות, אין לשמור את סיסמת MPEX בדפדפן\./),
    ).toBeInTheDocument()
  })

  it('does not show the shared-computer warning on the normal browser login page', () => {
    standaloneMode = false
    renderLoginPage()

    expect(screen.queryByTestId('installed-app-security-warning')).not.toBeInTheDocument()
    expect(screen.queryByText('שימוש במחשב משותף')).not.toBeInTheDocument()
  })

  it('dismisses the installed warning with הבנתי and keeps it dismissed for that login experience', async () => {
    standaloneMode = true
    const user = userEvent.setup()
    renderLoginPage()

    await user.click(screen.getByRole('button', { name: 'הבנתי' }))

    expect(screen.queryByTestId('installed-app-security-warning')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'התחברות' })).toBeInTheDocument()
  })

  it('shows the installed warning again on a new login mount', async () => {
    standaloneMode = true
    const user = userEvent.setup()
    renderLoginPage()

    await user.click(screen.getByRole('button', { name: 'הבנתי' }))
    expect(screen.queryByTestId('installed-app-security-warning')).not.toBeInTheDocument()

    cleanup()
    renderLoginPage()

    expect(screen.getByTestId('installed-app-security-warning')).toBeInTheDocument()
  })

  it('does not interfere with normal login submit behavior after acknowledgement', async () => {
    standaloneMode = true
    const user = userEvent.setup()
    const props = renderLoginPage()

    await user.click(screen.getByRole('button', { name: 'הבנתי' }))
    await user.click(screen.getByRole('button', { name: 'התחברות' }))

    expect(props.onLogin).toHaveBeenCalledTimes(1)
  })

  it('keeps password setup and recovery flows outside the installed-login warning scope', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const passwordSetup = readFileSync(
      resolve(process.cwd(), 'src/pages/PasswordSetupPage.tsx'),
      'utf8',
    )

    expect(app).toContain('<PasswordSetupPage')
    expect(app).toContain('<LoginPage')
    expect(passwordSetup).not.toContain('שימוש במחשב משותף')
    expect(passwordSetup).not.toContain('הבנתי')
  })
})

describe('LoginPage forgot password', () => {
  it('exposes the Hebrew forgot-password action on the login form', () => {
    renderLoginPage()

    expect(screen.getByTestId('forgot-password-link')).toHaveTextContent('שכחת סיסמה?')
    expect(screen.getByRole('button', { name: 'שכחת סיסמה?' })).toBeInTheDocument()
  })

  it('opens the email-only recovery request form', async () => {
    const user = userEvent.setup()
    renderLoginPage({ email: 'teacher@school.edu' })

    await user.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }))

    expect(screen.getByTestId('forgot-password-form')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'שחזור סיסמה' })).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toHaveValue('teacher@school.edu')
    expect(screen.queryByLabelText('סיסמה')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שליחת קישור' })).toBeInTheDocument()
  })

  it('requests password reset from the forgot form', async () => {
    const user = userEvent.setup()
    const props = renderLoginPage({ email: 'teacher@school.edu' })

    await user.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }))
    await user.click(screen.getByRole('button', { name: 'שליחת קישור' }))

    expect(props.onRequestPasswordReset).toHaveBeenCalledTimes(1)
    expect(props.onLogin).not.toHaveBeenCalled()
  })

  it('returns to the login form from forgot mode', async () => {
    const user = userEvent.setup()
    renderLoginPage()

    await user.click(screen.getByRole('button', { name: 'שכחת סיסמה?' }))
    await user.click(screen.getByTestId('forgot-password-back'))

    expect(screen.queryByTestId('forgot-password-form')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'התחברות' })).toBeInTheDocument()
  })

  it('shows the generic recovery confirmation without account-existence wording', () => {
    renderLoginPage({
      message: 'אם קיימת כתובת אימייל זו במערכת, נשלח אליה קישור להגדרת סיסמה חדשה.',
    })

    expect(
      screen.getByText('אם קיימת כתובת אימייל זו במערכת, נשלח אליה קישור להגדרת סיסמה חדשה.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/לא נמצא|לא קיים|user not found/i)).not.toBeInTheDocument()
  })
})

describe('password recovery architecture contracts', () => {
  it('reuses existing PasswordSetupPage and recovery session flags in App', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

    expect(app).toContain('requestPasswordRecoveryEmail')
    expect(app).toContain('PENDING_RECOVERY_KEY')
    expect(app).toContain('PASSWORD_RECOVERY')
    expect(app).toContain('<PasswordSetupPage')
    expect(app).toContain('isRecovery={isRecovery}')
    expect(app).toContain("newPassword.length < 8")
    expect(app).toContain("currentProfile.status !== 'active'")
    expect(app).not.toContain('force re-login')
  })

  it('keeps recovery completion on the existing updateUser password path', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

    expect(app).toContain('supabase.auth.updateUser')
    expect(app).toContain("password: newPassword")
    expect(app).toContain("await syncAuthenticatedSession(data.session, 'savePassword')")
  })
})
