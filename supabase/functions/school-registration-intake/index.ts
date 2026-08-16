import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/**
 * school-registration-intake — public constrained registration submit (Phase 1 / 1A).
 *
 * - No JWT required (verify_jwt = false).
 * - Accepts only expected intake fields.
 * - Never creates institutions/users or accepts admin/internal fields.
 * - Persists via atomic SECURITY DEFINER RPC (registration + registration_created).
 * - Body size ceiling, email/symbol/IP rate limits (Phase 1A).
 *
 * Trusted client IP assumption (Supabase Edge / Deno Deploy):
 * Prefer `cf-connecting-ip` when present, else the left-most
 * `x-forwarded-for` hop set by the platform proxy. Do not trust
 * caller-supplied custom headers. IP is stored only as SHA-256 hash.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = new Set(['principal', 'vice_principal'])

/** Form JSON is small; reject anything larger before parse. */
const MAX_BODY_BYTES = 8192

const MAX_SUBMISSIONS_PER_EMAIL_HOUR = 5
const MAX_SUBMISSIONS_PER_SYMBOL_HOUR = 5
const MAX_SUBMISSIONS_PER_IP_HOUR = 10
const MAX_SUBMISSIONS_UNKNOWN_IP_HOUR = 3

type IntakeBody = Record<string, unknown>

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

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLen) return null
  return trimmed
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return null
  }
  return email
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\+?[0-9][0-9\s\-()]{5,24}$/.test(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * Resolve client address from platform-provided headers only.
 * Prefer cf-connecting-ip; else first x-forwarded-for hop.
 */
function resolveClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf && /^[0-9a-fA-F:.]+$/.test(cf) && cf.length <= 45) {
    return cf
  }
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() ?? ''
    if (first && /^[0-9a-fA-F:.]+$/.test(first) && first.length <= 45) {
      return first
    }
  }
  return 'unknown'
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`mpex-school-registration-intake:v1:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function contentLengthTooLarge(req: Request): boolean {
  const header = req.headers.get('content-length')
  if (!header) return false
  const n = Number(header)
  return Number.isFinite(n) && n > MAX_BODY_BYTES
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  if (contentLengthTooLarge(req)) {
    return jsonResponse({ ok: false, error: 'payload_too_large' }, 413)
  }

  let rawText: string
  try {
    rawText = await req.text()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400)
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: 'payload_too_large' }, 413)
  }

  let body: IntakeBody
  try {
    body = JSON.parse(rawText) as IntakeBody
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400)
  }

  // Reject internal/admin fields if supplied.
  for (const forbidden of [
    'id',
    'status',
    'institution_id',
    'converted_institution_id',
    'converted_at',
    'created_at',
    'updated_at',
    'primary_role',
    'role',
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
      return jsonResponse({ ok: false, error: 'invalid_fields' }, 400)
    }
  }

  const schoolName = asNonEmptyString(body.school_name, 200)
  const institutionSymbol = asNonEmptyString(body.institution_symbol, 64)
  const city = asNonEmptyString(body.city, 120)
  const applicantRoleRaw = asNonEmptyString(body.applicant_role, 32)
  const contactFullName = asNonEmptyString(body.contact_full_name, 200)
  const emailRaw = asNonEmptyString(body.email, 254)
  const phoneRaw = asNonEmptyString(body.phone, 32)

  if (
    !schoolName ||
    !institutionSymbol ||
    !city ||
    !applicantRoleRaw ||
    !contactFullName ||
    !emailRaw ||
    !phoneRaw
  ) {
    return jsonResponse({ ok: false, error: 'validation_failed' }, 400)
  }

  if (!ALLOWED_ROLES.has(applicantRoleRaw)) {
    return jsonResponse({ ok: false, error: 'validation_failed' }, 400)
  }

  const email = normalizeEmail(emailRaw)
  const phone = normalizePhone(phoneRaw)
  if (!email || !phone) {
    return jsonResponse({ ok: false, error: 'validation_failed' }, 400)
  }

  // Institution symbol must remain text (never coerced to number).
  const institutionSymbolText = String(institutionSymbol)

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const clientIp = resolveClientIp(req)
    const ipHash = await hashIp(clientIp)
    const ipLimit =
      clientIp === 'unknown'
        ? MAX_SUBMISSIONS_UNKNOWN_IP_HOUR
        : MAX_SUBMISSIONS_PER_IP_HOUR

    const { count: emailCount, error: emailCountError } = await admin
      .from('school_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', oneHourAgo)

    if (emailCountError) {
      console.error('[school-registration-intake] rate email count failed')
      return jsonResponse({ ok: false, error: 'submit_failed' }, 500)
    }
    if ((emailCount ?? 0) >= MAX_SUBMISSIONS_PER_EMAIL_HOUR) {
      return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
    }

    const { count: symbolCount, error: symbolCountError } = await admin
      .from('school_registrations')
      .select('id', { count: 'exact', head: true })
      .ilike('institution_symbol', institutionSymbolText)
      .gte('created_at', oneHourAgo)

    if (symbolCountError) {
      console.error('[school-registration-intake] rate symbol count failed')
      return jsonResponse({ ok: false, error: 'submit_failed' }, 500)
    }
    if ((symbolCount ?? 0) >= MAX_SUBMISSIONS_PER_SYMBOL_HOUR) {
      return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
    }

    const { count: ipCount, error: ipCountError } = await admin
      .from('school_registration_intake_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo)

    if (ipCountError) {
      console.error('[school-registration-intake] rate ip count failed')
      return jsonResponse({ ok: false, error: 'submit_failed' }, 500)
    }
    if ((ipCount ?? 0) >= ipLimit) {
      return jsonResponse({ ok: false, error: 'rate_limited' }, 429)
    }

    const { data: intakeResult, error: intakeError } = await admin.rpc(
      'school_registration_intake_create',
      {
        p_school_name: schoolName,
        p_institution_symbol: institutionSymbolText,
        p_city: city,
        p_applicant_role: applicantRoleRaw,
        p_contact_full_name: contactFullName,
        p_email: email,
        p_phone: phone,
      },
    )

    if (
      intakeError ||
      !intakeResult ||
      typeof intakeResult !== 'object' ||
      (intakeResult as { ok?: boolean }).ok !== true
    ) {
      console.error('[school-registration-intake] atomic intake failed')
      return jsonResponse({ ok: false, error: 'submit_failed' }, 500)
    }

    const { error: eventError } = await admin
      .from('school_registration_intake_events')
      .insert({ ip_hash: ipHash })

    if (eventError) {
      // Registration already accepted; do not fail the caller. Log only.
      console.error('[school-registration-intake] intake event insert failed')
    }

    // Generic success only — never reveal duplicate / prior-intake state.
    return jsonResponse({ ok: true })
  } catch (error) {
    console.error(
      '[school-registration-intake] fatal',
      error instanceof Error ? error.message : 'unknown',
    )
    return jsonResponse({ ok: false, error: 'submit_failed' }, 500)
  }
})
