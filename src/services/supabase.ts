import { createClient } from '@supabase/supabase-js'

/** Project root URL only — strip accidental /rest/v1 suffix from env. */
function normalizeSupabaseUrl(url: string | undefined): string {
  if (!url) {
    return ''
  }

  return url.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '')
}

export const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const PENDING_PASSWORD_SETUP_KEY = 'eduflow_pending_password_setup'
export const PENDING_RECOVERY_KEY = 'eduflow_pending_password_recovery'

// Register immediately after createClient so PASSWORD_RECOVERY is not missed
// when initialize completes before React mounts.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    sessionStorage.setItem(PENDING_RECOVERY_KEY, 'true')
    sessionStorage.setItem(PENDING_PASSWORD_SETUP_KEY, 'true')
  }
})
