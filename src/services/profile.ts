import type { Session } from '@supabase/supabase-js'
import type { PrimaryRole, ProfileLoadDebugInfo, ProfileLoadResult } from '../types/user'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'

function isPrimaryRole(value: unknown): value is PrimaryRole {
  return (
    value === 'institution_manager' ||
    value === 'secretary' ||
    value === 'teacher'
  )
}

function logProfileDebug(label: string, payload: unknown) {
  console.log(`[profile] ${label}`, payload)
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

export async function loadCurrentUserRole(
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

  logProfileDebug('loadCurrentUserRole start', {
    source,
    userId: queryUserId,
    hasAccessToken: !!accessToken,
    accessTokenPrefix: accessToken?.slice(0, 12) ?? null,
    query: "from('users').select('primary_role').eq('id', userId).maybeSingle()",
    filterColumn: 'id',
    filterValue: queryUserId,
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
    `?select=primary_role` +
    `&id=eq.${encodeURIComponent(queryUserId)}`

  logProfileDebug('users query request', {
    source,
    method: 'GET',
    url: queryUrl,
    authorizationUsesUserJwt: true,
  })

  const response = await fetch(queryUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const responseText = await response.text()
  let responseBody: unknown = null

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
  const row = rows[0] as { primary_role?: unknown } | undefined
  const primaryRole = row?.primary_role

  logProfileDebug('users query parsed row', {
    source,
    rowCount: rows.length,
    primaryRole,
    primaryRoleType: typeof primaryRole,
  })

  if (rows.length === 0 || row === undefined) {
    console.error('[profile] no users row returned for authenticated user', {
      source,
      userId: queryUserId,
      authUserId: sessionUserId,
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

  if (!isPrimaryRole(primaryRole)) {
    console.error('[profile] invalid or missing primary_role', {
      source,
      userId: queryUserId,
      primaryRole,
      row,
      rows,
    })
    return {
      ok: false,
      debug: {
        ...baseDebug,
        errorMessage: `primary_role לא תקין: ${String(primaryRole)}`,
        errorCode: null,
        dataWasNull: primaryRole == null,
      },
    }
  }

  return { ok: true, role: primaryRole }
}

export { logProfileDebug }
