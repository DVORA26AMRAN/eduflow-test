export function detectAuthCallback() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)

  const type = hashParams.get('type') ?? queryParams.get('type')
  const accessToken =
    hashParams.get('access_token') ?? queryParams.get('access_token')
  const code = hashParams.get('code') ?? queryParams.get('code')

  const isAuthCallback =
    type === 'invite' ||
    type === 'recovery' ||
    type === 'signup' ||
    !!accessToken ||
    !!code

  const isInviteFlow = type === 'invite' || type === 'recovery' || type === 'signup'

  return { isAuthCallback, isInviteFlow }
}

export function clearAuthCallbackFromUrl() {
  if (
    window.location.hash.includes('access_token') ||
    window.location.search.includes('code=')
  ) {
    window.history.replaceState(null, '', window.location.pathname)
  }
}

export function hasCompletedPasswordSetup(
  user: { user_metadata?: Record<string, unknown> } | null | undefined,
) {
  return user?.user_metadata?.password_setup_complete === true
}
