import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  pickConfiguredAppUrl,
  resolveMpexAppOrigin,
} from '../_shared/mpexAppUrl.ts'

/**
 * clever-processor — privileged Auth invite + public.users provisioning.
 *
 * Authorization (server-side):
 * - institution_manager may invite role=teacher|secretary|deputy for their own institution.
 * - deputy may invite role=teacher|secretary for their own institution (D3B).
 * - secretary may invite role=teacher only for their own institution.
 * - For tenant callers, institution is taken from the caller row — never from the body.
 * - platform_admin (active, institution_id NULL) may invite role=institution_manager
 *   for a verified body.institution_id when no active manager occupies the slot.
 * - Existing emails are rejected; tenant invites never UPDATE primary_role.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type TenantInviteRole = 'teacher' | 'secretary' | 'deputy'
type InviteRole = TenantInviteRole | 'institution_manager'

type InviteBody = {
  full_name?: unknown
  email?: unknown
  role?: unknown
  institution_id?: unknown
  capabilities?: unknown
  phone?: unknown
  national_id?: unknown
  job_title?: unknown
  weekly_hours?: unknown
}

type CallerRow = {
  id: string
  institution_id: string | null
  primary_role: string
  status: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) {
    throw new Error(`Missing env: ${name}`)
  }
  return value
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function parseTenantInviteRole(value: unknown): TenantInviteRole | null {
  return value === 'teacher' || value === 'secretary' || value === 'deputy' ? value : null
}

function canTenantInviteRole(callerRole: string, requestedRole: TenantInviteRole): boolean {
  if (callerRole === 'institution_manager') {
    return (
      requestedRole === 'teacher' ||
      requestedRole === 'secretary' ||
      requestedRole === 'deputy'
    )
  }
  if (callerRole === 'deputy') {
    return requestedRole === 'teacher' || requestedRole === 'secretary'
  }
  if (callerRole === 'secretary') {
    return requestedRole === 'teacher'
  }
  return false
}

function isActiveGlobalPlatformAdmin(caller: CallerRow): boolean {
  return (
    caller.status === 'active' &&
    caller.primary_role === 'platform_admin' &&
    caller.institution_id === null
  )
}

function isActiveTenantInviter(caller: CallerRow): boolean {
  return (
    caller.status === 'active' &&
    !!caller.institution_id &&
    (caller.primary_role === 'institution_manager' ||
      caller.primary_role === 'deputy' ||
      caller.primary_role === 'secretary')
  )
}

function parseOptionalPositiveNumber(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim().replace(',', '.'))
        : Number.NaN

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'invalid'
  }

  return parsed
}

/**
 * Public app origin for Auth email redirects.
 * Source (Edge secrets, first match): APP_URL | EDUFLOW_APP_URL | SITE_URL
 * Production vs local is decided from SUPABASE_URL host (not from APP_URL).
 * Production must be exactly https://mpex.school — fail closed otherwise.
 */
function resolveAppRedirectUrl(): string {
  return resolveMpexAppOrigin({
    configuredAppUrl: pickConfiguredAppUrl((name) => Deno.env.get(name) ?? undefined),
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller, error: callerError } = await service
      .from('users')
      .select('id, institution_id, primary_role, status')
      .eq('id', user.id)
      .maybeSingle()

    if (callerError || !caller) {
      console.error('[clever-processor] caller lookup failed', callerError)
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const callerRow = caller as CallerRow

    let body: InviteBody
    try {
      body = (await request.json()) as InviteBody
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
    }

    const fullName = asNonEmptyString(body.full_name)
    const email = asNonEmptyString(body.email)?.toLowerCase() ?? null
    const requestedRoleRaw = asNonEmptyString(body.role)

    if (!fullName || !email || !requestedRoleRaw) {
      return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
    }

    // -------------------------------------------------------------------------
    // Platform Admin → Institution Manager
    // -------------------------------------------------------------------------
    if (requestedRoleRaw === 'institution_manager') {
      if (!isActiveGlobalPlatformAdmin(callerRow)) {
        return jsonResponse({ ok: false, error: 'forbidden' }, 403)
      }

      const institutionId = asNonEmptyString(body.institution_id)
      if (!institutionId || !isUuid(institutionId)) {
        return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
      }

      const { data: institution, error: institutionError } = await service
        .from('institutions')
        .select('id')
        .eq('id', institutionId)
        .maybeSingle()

      if (institutionError) {
        console.error('[clever-processor] institution lookup failed', institutionError)
        return jsonResponse({ ok: false, error: 'internal_error' }, 500)
      }

      if (!institution) {
        return jsonResponse({ ok: false, error: 'institution_not_found' }, 404)
      }

      const { data: existingByEmail, error: emailLookupError } = await service
        .from('users')
        .select('id, email, primary_role, status, institution_id, onboarding_completed_at')
        .ilike('email', email)
        .maybeSingle()

      if (emailLookupError) {
        console.error('[clever-processor] email lookup failed', emailLookupError)
        return jsonResponse({ ok: false, error: 'internal_error' }, 500)
      }

      if (existingByEmail) {
        const sameInstitutionManager =
          existingByEmail.primary_role === 'institution_manager' &&
          existingByEmail.institution_id === institutionId &&
          existingByEmail.status === 'active'

        // Phase 2: no invite resend. Slot remains occupied; resend/replace is Phase 2B.
        if (sameInstitutionManager && existingByEmail.onboarding_completed_at === null) {
          return jsonResponse(
            {
              ok: false,
              error: 'manager_invite_pending',
              message: 'manager invite already awaiting onboarding',
            },
            409,
          )
        }

        if (sameInstitutionManager && existingByEmail.onboarding_completed_at !== null) {
          return jsonResponse(
            { ok: false, error: 'manager_already_joined', message: 'manager exists' },
            409,
          )
        }

        return jsonResponse(
          {
            ok: false,
            error: 'conflict',
            message: 'email already belongs to an existing user',
          },
          409,
        )
      }

      const { data: activeManager, error: managerLookupError } = await service
        .from('users')
        .select('id')
        .eq('institution_id', institutionId)
        .eq('primary_role', 'institution_manager')
        .eq('status', 'active')
        .maybeSingle()

      if (managerLookupError) {
        console.error('[clever-processor] active manager lookup failed', managerLookupError)
        return jsonResponse({ ok: false, error: 'internal_error' }, 500)
      }

      if (activeManager) {
        return jsonResponse(
          { ok: false, error: 'manager_slot_occupied', message: 'active manager exists' },
          409,
        )
      }

      let redirectTo: string
      try {
        redirectTo = resolveAppRedirectUrl()
      } catch (configError) {
        console.error('[clever-processor] APP_URL configuration error', configError)
        return jsonResponse(
          {
            ok: false,
            error: 'misconfigured',
            message: configError instanceof Error ? configError.message : 'APP_URL missing',
          },
          500,
        )
      }

      const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo,
          data: {
            full_name: fullName,
            password_setup_complete: false,
          },
        },
      )

      if (inviteError || !invited.user) {
        const message = inviteError?.message ?? 'invite_failed'
        if (/already|registered|exists/i.test(message)) {
          return jsonResponse({ ok: false, error: 'repair_required', message }, 409)
        }
        console.error('[clever-processor] manager invite failed', inviteError)
        return jsonResponse({ ok: false, error: 'invite_failed', message }, 500)
      }

      const { error: insertError } = await service.from('users').insert({
        id: invited.user.id,
        email,
        full_name: fullName,
        primary_role: 'institution_manager',
        status: 'active',
        institution_id: institutionId,
        onboarding_completed_at: null,
      })

      if (insertError) {
        console.error('[clever-processor] manager users insert failed', insertError)
        await service.auth.admin.deleteUser(invited.user.id)
        if (/duplicate|unique|already/i.test(insertError.message)) {
          return jsonResponse(
            { ok: false, error: 'manager_slot_occupied', message: insertError.message },
            409,
          )
        }
        return jsonResponse(
          { ok: false, error: 'provision_failed', message: insertError.message },
          500,
        )
      }

      const { error: auditError } = await service.from('audit_logs').insert({
        institution_id: institutionId,
        actor_user_id: callerRow.id,
        action_type: 'manager_invited',
        entity_type: 'user',
        entity_id: invited.user.id,
        metadata: {
          invited_email: email,
          invited_full_name: fullName,
          primary_role: 'institution_manager',
        },
      })
      if (auditError) {
        console.error('[clever-processor] manager_invited audit failed', auditError)
      }

      return jsonResponse(
        {
          ok: true,
          user_id: invited.user.id,
          email,
          role: 'institution_manager' as InviteRole,
          institution_id: institutionId,
          invited_by_user_id: callerRow.id,
        },
        201,
      )
    }

    // -------------------------------------------------------------------------
    // Tenant invites (Manager / Deputy / Secretary)
    // -------------------------------------------------------------------------
    if (!isActiveTenantInviter(callerRow)) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (body.institution_id !== undefined && body.institution_id !== null) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (requestedRoleRaw === 'platform_admin') {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const role = parseTenantInviteRole(requestedRoleRaw)
    if (!role) {
      return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
    }

    if (!canTenantInviteRole(callerRow.primary_role, role)) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    let teacherPhone: string | null = null
    let teacherNationalId: string | null = null
    let teacherJobTitle: string | null = null
    let teacherWeeklyHours: number | null = null

    if (role === 'teacher') {
      const weeklyHours = parseOptionalPositiveNumber(body.weekly_hours)
      if (weeklyHours === 'invalid') {
        return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
      }
      teacherPhone = asNonEmptyString(body.phone)
      teacherNationalId = asNonEmptyString(body.national_id)
      teacherJobTitle = asNonEmptyString(body.job_title)
      teacherWeeklyHours = weeklyHours
    }

    const { data: existingByEmail, error: emailLookupError } = await service
      .from('users')
      .select('id, primary_role, institution_id')
      .ilike('email', email)
      .maybeSingle()

    if (emailLookupError) {
      console.error('[clever-processor] tenant email lookup failed', emailLookupError)
      return jsonResponse({ ok: false, error: 'internal_error' }, 500)
    }

    if (existingByEmail) {
      return jsonResponse(
        {
          ok: false,
          error: 'conflict',
          message: 'email already belongs to an existing user',
        },
        409,
      )
    }

    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          password_setup_complete: false,
        },
      },
    )

    if (inviteError || !invited.user) {
      const message = inviteError?.message ?? 'invite_failed'
      if (/already|registered|exists/i.test(message)) {
        return jsonResponse({ ok: false, error: 'conflict', message }, 409)
      }
      console.error('[clever-processor] invite failed', inviteError)
      return jsonResponse({ ok: false, error: 'invite_failed', message }, 500)
    }

    const { error: insertError } = await service.from('users').insert({
      id: invited.user.id,
      email,
      full_name: fullName,
      primary_role: role,
      status: 'active',
      institution_id: callerRow.institution_id,
      onboarding_completed_at: null,
      ...(role === 'teacher'
        ? {
            phone: teacherPhone,
            national_id: teacherNationalId,
            job_title: teacherJobTitle,
            weekly_hours: teacherWeeklyHours,
          }
        : {}),
    })

    if (insertError) {
      console.error('[clever-processor] users insert failed', insertError)
      await service.auth.admin.deleteUser(invited.user.id)
      if (/duplicate|unique|already/i.test(insertError.message)) {
        return jsonResponse({ ok: false, error: 'conflict', message: insertError.message }, 409)
      }
      return jsonResponse({ ok: false, error: 'provision_failed', message: insertError.message }, 500)
    }

    return jsonResponse(
      {
        ok: true,
        user_id: invited.user.id,
        email,
        role,
        institution_id: callerRow.institution_id,
        invited_by_user_id: callerRow.id,
      },
      201,
    )
  } catch (error) {
    console.error('[clever-processor] unexpected error', error)
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
