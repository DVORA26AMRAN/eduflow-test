/**
 * Supabase signInWithPassword accepts only email and password.
 * Login credentials do not include remembered-email prefill preferences.
 */
export function buildSignInCredentials(email: string, password: string) {
  return {
    email,
    password,
  }
}
