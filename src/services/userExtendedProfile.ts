import { supabase } from './supabase'

export type SetUserExtendedProfileInput = {
  email: string
  phone: string | null
  nationalId: string | null
  jobTitle: string | null
  weeklyHours: number | null
}

export type SetUserExtendedProfileResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export async function setTeacherExtendedProfile(
  input: SetUserExtendedProfileInput,
): Promise<SetUserExtendedProfileResult> {
  const { data, error } = await supabase.rpc('manager_set_user_extended_profile', {
    p_email: input.email,
    p_phone: input.phone,
    p_national_id: input.nationalId,
    p_job_title: input.jobTitle,
    p_weekly_hours: input.weeklyHours,
  })

  if (error) {
    console.error('[userExtendedProfile] failed to set extended profile', error)
    return {
      ok: false,
      errorMessage: 'המשתמש נוצר, אך שמירת פרטי הפרופיל הנוספים נכשלה.',
    }
  }

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    return {
      ok: false,
      errorMessage: 'המשתמש נוצר, אך שמירת פרטי הפרופיל הנוספים נכשלה.',
    }
  }

  return { ok: true }
}
