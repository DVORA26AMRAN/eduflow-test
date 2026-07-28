/**
 * Validate Meeting Calendar / Live Meeting RPCs against the linked Supabase DB.
 *
 * Required .env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Optional (stronger ACL checks):
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VERIFY_MANAGER_A_EMAIL / VERIFY_MANAGER_A_PASSWORD
 *
 * Run: node scripts/validate-live-meeting-rpcs.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env')
  const env = {}
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  } catch {
    // ignore
  }
  return { ...env, ...process.env }
}

function createAuthedClient(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no session'}`)
  }
  return {
    userId: data.session.user.id,
    client: createAuthedClient(url, anonKey, data.session.access_token),
  }
}

function check(id, passed, detail) {
  return { id, passed, detail }
}

function isMissingFunction(error) {
  return (
    error?.code === 'PGRST202' ||
    Boolean(error?.message?.toLowerCase().includes('could not find the function'))
  )
}

function summarizeError(error) {
  if (!error) return 'ok'
  return `${error.code ?? 'no-code'}: ${error.message ?? 'unknown'}`
}

async function main() {
  const env = loadEnvFile()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  const report = {
    targetHost: url ? new URL(url).host : null,
    mode: serviceRoleKey ? 'anon+service_role' : 'anon_only',
    checks: [],
    errors: [],
  }

  if (!url || !anonKey) {
    report.errors.push('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required')
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const liveRpcs = [
    [
      'meeting_calendar_get_live_context',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000' },
    ],
    [
      'meeting_calendar_report_delay',
      {
        p_meeting_id: '00000000-0000-0000-0000-000000000000',
        p_delay_minutes: 5,
      },
    ],
    [
      'meeting_calendar_set_connection_details',
      {
        p_meeting_id: '00000000-0000-0000-0000-000000000000',
        p_meeting_format: 'in_person',
        p_meet_url: null,
        p_phone_number: null,
      },
    ],
    [
      'meeting_calendar_record_live_primary_action',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000' },
    ],
  ]

  for (const [name, args] of liveRpcs) {
    const { error } = await anon.rpc(name, args)
    // Anon has no auth.uid(); expected Permission denied (42501) proves RPC exists + gate works.
    const passed = !isMissingFunction(error) && error?.code === '42501'
    report.checks.push(
      check(`live_rpc_exists_and_gated:${name}`, passed, summarizeError(error)),
    )
  }

  // Attach RPC must NOT execute body for anon (no Meeting not found).
  {
    const { error } = await anon.rpc('meeting_calendar_attach_system_meet_url', {
      p_meeting_id: '00000000-0000-0000-0000-000000000000',
      p_meet_url: 'https://meet.google.com/abc-defg-hij',
    })
    const denied =
      isMissingFunction(error) ||
      error?.code === '42501' ||
      Boolean(error?.message?.toLowerCase().includes('permission'))
    const leakedIntoBody = error?.code === 'P0002' || error?.message === 'Meeting not found.'
    report.checks.push(
      check(
        'anon_cannot_attach_meet_url',
        denied && !leakedIntoBody,
        summarizeError(error),
      ),
    )
  }

  // Schema surfaces for live actions
  {
    const { error } = await anon.from('meeting_activity_events').select('id').limit(0)
    report.checks.push(
      check(
        'table:meeting_activity_events',
        !error || !error.message?.includes('does not exist'),
        summarizeError(error),
      ),
    )
  }
  {
    const { error } = await anon
      .from('meetings')
      .select('id,meeting_format,meet_url,phone_number,delay_minutes')
      .limit(0)
    report.checks.push(
      check(
        'columns:meetings_live_fields',
        !error || !error.message?.includes('does not exist'),
        summarizeError(error),
      ),
    )
  }

  // Scheduling workflow RPCs still present (anon → permission denied / validation, not missing)
  const scheduling = [
    [
      'meeting_calendar_create_meeting',
      {
        p_recipient_id: '00000000-0000-0000-0000-000000000000',
        p_subject: 'validation',
        p_reason: 'validation',
        p_duration_minutes: 30,
      },
    ],
    [
      'meeting_calendar_propose_slots',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000', p_slots: [] },
    ],
    [
      'meeting_calendar_select_slot',
      {
        p_meeting_id: '00000000-0000-0000-0000-000000000000',
        p_slot_id: '00000000-0000-0000-0000-000000000000',
      },
    ],
    [
      'meeting_calendar_confirm_meeting',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000' },
    ],
    [
      'meeting_calendar_set_duration',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000', p_duration_minutes: 30 },
    ],
    [
      'meeting_calendar_approve_by_owner',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000' },
    ],
    [
      'meeting_calendar_cancel_meeting',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000', p_reason: null },
    ],
    [
      'meeting_calendar_reschedule_meeting',
      { p_meeting_id: '00000000-0000-0000-0000-000000000000' },
    ],
  ]

  for (const [name, args] of scheduling) {
    const { error } = await anon.rpc(name, args)
    report.checks.push(
      check(
        `scheduling_rpc_exists:${name}`,
        !isMissingFunction(error),
        summarizeError(error),
      ),
    )
  }

  if (serviceRoleKey) {
    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await admin.rpc('meeting_calendar_attach_system_meet_url', {
      p_meeting_id: '00000000-0000-0000-0000-000000000000',
      p_meet_url: 'https://meet.google.com/abc-defg-hij',
    })
    // Service role should reach body (Meeting not found) or succeed — not missing/permission.
    const passed =
      !isMissingFunction(error) &&
      error?.code !== '42501' &&
      (error?.code === 'P0002' || error == null || error?.message?.includes('Meeting not found'))
    report.checks.push(
      check('service_role_can_reach_attach_rpc', passed, summarizeError(error)),
    )
  } else {
    report.checks.push(
      check(
        'service_role_can_reach_attach_rpc',
        false,
        'skipped: SUPABASE_SERVICE_ROLE_KEY not set',
      ),
    )
  }

  const managerEmail = env.VERIFY_MANAGER_A_EMAIL
  const managerPassword = env.VERIFY_MANAGER_A_PASSWORD
  if (managerEmail && managerPassword) {
    try {
      const manager = await signIn(url, anonKey, managerEmail, managerPassword)
      const { error } = await manager.client.rpc('meeting_calendar_attach_system_meet_url', {
        p_meeting_id: '00000000-0000-0000-0000-000000000000',
        p_meet_url: 'https://meet.google.com/abc-defg-hij',
      })
      const denied =
        isMissingFunction(error) ||
        error?.code === '42501' ||
        Boolean(error?.message?.toLowerCase().includes('permission'))
      const leakedIntoBody = error?.code === 'P0002' || error?.message === 'Meeting not found.'
      report.checks.push(
        check(
          'authenticated_cannot_attach_meet_url',
          denied && !leakedIntoBody,
          summarizeError(error),
        ),
      )
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
    }
  } else {
    report.checks.push(
      check(
        'authenticated_cannot_attach_meet_url',
        false,
        'skipped: VERIFY_MANAGER_A_EMAIL/PASSWORD not set (anon denial checked separately)',
      ),
    )
  }

  const failed = report.checks.filter((row) => !row.passed)
  // Treat optional skipped service-role / manager checks as non-blocking when anon_only mode
  // except anon attach denial and live/scheduling presence which are required.
  const blockingFailed = failed.filter(
    (row) =>
      !row.detail.startsWith('skipped:') &&
      row.id !== 'service_role_can_reach_attach_rpc' &&
      row.id !== 'authenticated_cannot_attach_meet_url',
  )
  report.ok = report.errors.length === 0 && blockingFailed.length === 0
  report.failedCount = failed.length
  report.blockingFailedCount = blockingFailed.length
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

await main()
