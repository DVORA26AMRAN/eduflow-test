import type { Session } from '@supabase/supabase-js'
import type {
  AuthenticatedUserProfile,
  PrimaryRole,
  ProfileLoadDebugInfo,
  ProfileLoadResult,
} from '../types/user'
import type { School } from '../types/school'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'

function isPrimaryRole(value: unknown): value is PrimaryRole {
  return (
    value === 'institution_manager' ||
    value === 'secretary' ||
    value === 'teacher' ||
    value === 'platform_admin'
  )
}

function logProfileDebug(label: string, payload: unknown) {
  console.log(`[profile] ${label}`, payload)
}

function parseInstitutionRow(value: unknown): School | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') {
    return null
  }

  const institution = row as {
    id?: unknown
    name?: unknown
    logo_url?: unknown
    logo_updated_at?: unknown
  }

  if (typeof institution.id !== 'string' || typeof institution.name !== 'string') {
    return null
  }

  return {
    id: institution.id,
    name: institution.name,
    logoUrl: typeof institution.logo_url === 'string' ? institution.logo_url : null,
    logoUpdatedAt:
      typeof institution.logo_updated_at === 'string' ? institution.logo_updated_at : null,
  }
}

export async function logAuthState(source: string) {
  const sessionResult = await supabase.auth.getSession()
  const userResult = await supabase.auth.getUser()

  logProfileDebug('auth.getSession()', {
    source,
    error: sessionResult.error,
    hasSession: !!sessionResult.data.session,
    sessionUserId: sessionResult.data.session?.user.id ?? null,
    hasAccessToken: !!sessionResult.data.session?.access_token,
    accessTokenPrefix:
      sessionResult.data.session?.access_token?.slice(0, 12) ?? null,
  })

  logProfileDebug('auth.getUser()', {
    source,
    error: userResult.error,
    userId: userResult.data.user?.id ?? null,
    userEmail: userResult.data.user?.email ?? null,
  })
}

export async function loadCurrentUserProfile(
  session: Session,
  source: string,
): Promise<ProfileLoadResult> {
  const sessionUserId = session.user.id
  const sessionEmail = session.user.email ?? null
  const queryUserId = sessionUserId
  const accessToken = session.access_token

  const baseDebug: ProfileLoadDebugInfo = {
    sessionUserId,
    sessionEmail,
    queryUserId,
    errorMessage: null,
    errorCode: null,
    dataWasNull: false,
  }

  logProfileDebug('loadCurrentUserProfile start', {
    source,
    userId: queryUserId,
    hasAccessToken: !!accessToken,
    query:
      "from('users').select('id, full_name, primary_role, institution_id, institutions(id, name, logo_url, logo_updated_at)')",
  })

  if (!accessToken) {
    console.error('[profile] missing access_token on session', {
      source,
      userId: queryUserId,
    })
    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage: 'חסר access token בהפעלה',
        errorCode: null,
        dataWasNull: true,
      },
    }
  }

  const queryUrl =
    `${supabaseUrl}/rest/v1/users` +
    `?select=id,full_name,primary_role,institution_id,institutions(id,name,logo_url,logo_updated_at)` +
    `&id=eq.${encodeURIComponent(queryUserId)}`

  const response = await fetch(queryUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const responseText = await response.text()
  let responseBody: unknown

  try {
    responseBody = responseText ? JSON.parse(responseText) : null
  } catch {
    responseBody = responseText
  }

  logProfileDebug('users query response', {
    source,
    status: response.status,
    ok: response.ok,
    body: responseBody,
  })

  if (!response.ok) {
    const postgrestError = responseBody as {
      message?: string
      code?: string
    } | null

    console.error('[profile] users query HTTP error', {
      source,
      status: response.status,
      body: responseBody,
    })

    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage:
          postgrestError?.message ??
          (typeof responseBody === 'string' ? responseBody : 'שגיאת HTTP בשאילתת users'),
        errorCode: postgrestError?.code ?? String(response.status),
        dataWasNull: responseBody === null,
      },
    }
  }

  const rows = Array.isArray(responseBody) ? responseBody : []
  const row = rows[0] as
    | {
        id?: unknown
        full_name?: unknown
        primary_role?: unknown
        institution_id?: unknown
        institutions?: unknown
      }
    | undefined

  if (rows.length === 0 || row === undefined) {
    console.error('[profile] no users row returned for authenticated user', {
      source,
      userId: queryUserId,
    })
    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage: 'לא התקבלה שורה מטבלת users',
        errorCode: null,
        dataWasNull: true,
      },
    }
  }

  if (
    typeof row.id !== 'string' ||
    typeof row.full_name !== 'string' ||
    !isPrimaryRole(row.primary_role)
  ) {
    console.error('[profile] invalid user profile row', {
      source,
      userId: queryUserId,
      row,
    })
    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage: 'נתוני פרופיל המשתמש אינם תקינים',
        errorCode: null,
        dataWasNull: true,
      },
    }
  }

  const school = parseInstitutionRow(row.institutions)

  if (row.primary_role !== 'platform_admin' && school === null) {
    console.error('[profile] institution missing for non-platform user', {
      source,
      userId: queryUserId,
      institutionId: row.institution_id,
    })
    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage: 'לא נמצא מוסד משויך למשתמש',
        errorCode: null,
        dataWasNull: true,
      },
    }
  }

  const profile: AuthenticatedUserProfile = {
    id: row.id,
    fullName: row.full_name,
    role: row.primary_role,
    school,
  }

  return { ok: true, profile }
}

/** @deprecated Use loadCurrentUserProfile */
export async function loadCurrentUserRole(
  session: Session,
  source: string,
): Promise<
  | { ok: true; role: PrimaryRole }
  | { ok: false; debug: ProfileLoadDebugInfo }
> {
  const result = await loadCurrentUserProfile(session, source)
  if (!result.ok) {
    return result
  }

  return { ok: true, role: result.profile.role }
}

export { logProfileDebug }
