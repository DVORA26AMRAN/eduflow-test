/**
 * Remembered email storage for login prefill only.
 * Does not control Supabase authentication session persistence.
 */
export const REMEMBERED_EMAIL_STORAGE_KEY = 'adoflow.auth.rememberedEmail'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getRememberedEmail(): string | null {
  try {
    const value = localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY)
    if (!value) {
      return null
    }

    const normalized = normalizeEmail(value)
    return normalized || null
  } catch {
    return null
  }
}

export function saveRememberedEmail(email: string): void {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    return
  }

  try {
    localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, normalized)
  } catch {
    // Ignore storage failures (private browsing, quota, etc.).
  }
}

export function clearRememberedEmail(): void {
  try {
    localStorage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

export function getInitialLoginFormState(): { email: string; rememberMe: boolean } {
  const rememberedEmail = getRememberedEmail()
  return {
    email: rememberedEmail ?? '',
    rememberMe: rememberedEmail !== null,
  }
}

export function handleRememberMeAfterLogin(rememberMe: boolean, email: string): void {
  if (rememberMe) {
    saveRememberedEmail(email)
    return
  }

  clearRememberedEmail()
}
