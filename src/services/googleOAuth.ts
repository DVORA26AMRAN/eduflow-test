import { supabase, supabaseUrl } from './supabase'
import {
  canStartGoogleOAuth,
  resolveGoogleConnectionUiStatus,
} from '../utils/googleOAuthCrypto'

export const USER_SETTINGS_SECTION_ID = 'user-settings'
export const USER_SETTINGS_NAV_LABEL = 'הגדרות'

export const GOOGLE_OAUTH_START_FN = 'google-oauth-start'
export const GOOGLE_OAUTH_DISCONNECT_FN = 'google-oauth-disconnect'
export const GOOGLE_OAUTH_STATUS_FN = 'google-oauth-status'

export type GoogleConnectionStatus =
  | 'not_connected'
  | 'connected'
  | 'reauthorization_required'

export type GoogleConnectionStatusResult =
  | {
      ok: true
      connected: boolean
      connectionStatus: GoogleConnectionStatus
      email: string | null
    }
  | { ok: false; errorMessage: string }

export type GoogleOAuthStartResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; errorMessage: string }

export type GoogleOAuthDisconnectResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type GoogleIntegrationReturn =
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'error'; code: string | null }
  | null

function mapConnectionStatus(raw: unknown, connected: boolean): GoogleConnectionStatus {
  return resolveGoogleConnectionUiStatus({
    connectionStatus: typeof raw === 'string' ? raw : null,
    connected,
  })
}

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatusResult> {
  const { data, error } = await supabase.rpc('meeting_calendar_get_google_connection_status')

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  const connected = row.connected === true
  return {
    ok: true,
    connected,
    connectionStatus: mapConnectionStatus(row.connection_status, connected),
    email: typeof row.email === 'string' ? row.email : null,
  }
}

/** Optional Edge Function proxy — same payload as RPC, never includes tokens. */
export async function getGoogleConnectionStatusViaEdge(): Promise<GoogleConnectionStatusResult> {
  const { data, error } = await supabase.functions.invoke(GOOGLE_OAUTH_STATUS_FN, {
    method: 'POST',
  })

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  if (row.ok === false) {
    return { ok: false, errorMessage: 'forbidden' }
  }

  const connected = row.connected === true
  return {
    ok: true,
    connected,
    connectionStatus: mapConnectionStatus(row.connection_status, connected),
    email: typeof row.email === 'string' ? row.email : null,
  }
}

export async function startGoogleOAuth(): Promise<GoogleOAuthStartResult> {
  const { data, error } = await supabase.functions.invoke(GOOGLE_OAUTH_START_FN, {
    method: 'POST',
  })

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  if (row.ok !== true || typeof row.authorizationUrl !== 'string') {
    return {
      ok: false,
      errorMessage:
        typeof row.error === 'string' ? row.error : 'Failed to start Google connection.',
    }
  }

  return { ok: true, authorizationUrl: row.authorizationUrl }
}

export async function disconnectGoogleOAuth(): Promise<GoogleOAuthDisconnectResult> {
  const { data, error } = await supabase.functions.invoke(GOOGLE_OAUTH_DISCONNECT_FN, {
    method: 'POST',
  })

  if (error) {
    return { ok: false, errorMessage: error.message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  if (row.ok !== true) {
    return {
      ok: false,
      errorMessage: typeof row.error === 'string' ? row.error : 'Disconnect failed.',
    }
  }

  return { ok: true }
}

export function detectGoogleIntegrationReturn(): GoogleIntegrationReturn {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  const status =
    hashParams.get('google-integration') ?? queryParams.get('google-integration')
  if (!status) {
    return null
  }
  const errorCode =
    hashParams.get('google-integration-error') ??
    queryParams.get('google-integration-error')

  if (status === 'connected') return { kind: 'connected' }
  if (status === 'disconnected') return { kind: 'disconnected' }
  if (status === 'error') return { kind: 'error', code: errorCode }
  return { kind: 'error', code: status }
}

export function clearGoogleIntegrationReturnFromUrl(): void {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const queryParams = new URLSearchParams(window.location.search)
  if (
    !hashParams.has('google-integration') &&
    !queryParams.has('google-integration')
  ) {
    return
  }
  window.history.replaceState(null, '', window.location.pathname)
}

export function assertClientCanConnectGoogle(profile: {
  role: string
  status?: string
  school?: { id?: string } | null
}): boolean {
  return canStartGoogleOAuth({
    role: profile.role,
    status: profile.status ?? 'active',
    institutionId: profile.school?.id ?? null,
  })
}

/** Sanity: functions are never invoked via VITE secrets. */
export function googleOAuthUsesViteSecrets(): boolean {
  const viteKeys = Object.keys(import.meta.env).filter((k) =>
    /GOOGLE|TOKEN|CLIENT_SECRET/i.test(k),
  )
  return viteKeys.some((k) => k.startsWith('VITE_') && /GOOGLE|TOKEN|SECRET/i.test(k))
}

export function googleOAuthFunctionsBaseUrl(): string {
  return `${supabaseUrl}/functions/v1`
}
