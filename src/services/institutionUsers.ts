import type { InstitutionUser } from '../types/user'
import { supabase } from './supabase'

export type InstitutionUsersLoadResult =
  | { ok: true; users: InstitutionUser[] }
  | { ok: false; errorMessage: string }

export async function loadInstitutionUsers(): Promise<InstitutionUsersLoadResult> {
  const { data, error } = await supabase
    .from('users')
    .select('full_name, email, primary_role')
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[institutionUsers] failed to load users', error)
    return {
      ok: false,
      errorMessage: 'לא ניתן לטעון את רשימת המשתמשים.',
    }
  }

  const users = (data ?? []).filter(
    (user): user is InstitutionUser =>
      typeof user.full_name === 'string' &&
      typeof user.email === 'string' &&
      (user.primary_role === 'teacher' ||
        user.primary_role === 'secretary' ||
        user.primary_role === 'institution_manager'),
  )

  return { ok: true, users }
}

export function countUsersByRole(
  users: InstitutionUser[],
  role: InstitutionUser['primary_role'],
): number {
  return users.filter((user) => user.primary_role === role).length
}
