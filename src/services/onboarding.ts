import { supabase } from './supabase'

export type CompleteOwnOnboardingResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

/** Marks the current user's onboarding complete after password setup. */
export async function completeOwnUserOnboarding(): Promise<CompleteOwnOnboardingResult> {
  const { data, error } = await supabase.rpc('complete_own_user_onboarding')

  if (error) {
    console.error('[onboarding] complete_own_user_onboarding failed', error)
    return { ok: false, errorMessage: 'שמירת סיום ההצטרפות נכשלה.' }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return { ok: false, errorMessage: 'שמירת סיום ההצטרפות נכשלה.' }
  }

  return { ok: true }
}
