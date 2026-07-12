/**
 * Diagnose send_request_reminder RPC without changing app behavior.
 * Run: node scripts/diagnose-request-reminder.mjs [request_uuid]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env')
  const env = {}
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
  return env
}

function printSupabaseError(label, error) {
  console.log(`\n=== ${label} ===`)
  if (!error) {
    console.log('(no error object)')
    return
  }
  console.log(JSON.stringify(error, null, 2))
  console.log('message:', error.message)
  console.log('code:', error.code)
  console.log('details:', error.details)
  console.log('hint:', error.hint)
}

const env = loadEnvFile()
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const requestId = process.argv[2] ?? '00000000-0000-4000-8000-000000000001'

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const anonClient = createClient(url, anonKey)

console.log('RPC: send_request_reminder')
console.log('Payload:', JSON.stringify({ p_request_id: requestId }, null, 2))
console.log('Supabase URL:', url)

const { data: anonData, error: anonError } = await anonClient.rpc('send_request_reminder', {
  p_request_id: requestId,
})

console.log('\n=== Anonymous RPC response data ===')
console.log(JSON.stringify(anonData, null, 2))
printSupabaseError('Anonymous RPC error', anonError)

const teacherEmail = env.VERIFY_TEACHER_EMAIL
const teacherPassword = env.VERIFY_TEACHER_PASSWORD

if (teacherEmail && teacherPassword) {
  const teacherClient = createClient(url, anonKey)
  const { error: signInError } = await teacherClient.auth.signInWithPassword({
    email: teacherEmail,
    password: teacherPassword,
  })

  if (signInError) {
    printSupabaseError('Teacher sign-in error', signInError)
  } else {
    const {
      data: { session },
    } = await teacherClient.auth.getSession()

    console.log('\n=== Authenticated teacher session ===')
    console.log('user_id:', session?.user?.id)

    const { data: teacherData, error: teacherError } = await teacherClient.rpc(
      'send_request_reminder',
      { p_request_id: requestId },
    )

    console.log('\n=== Teacher RPC response data ===')
    console.log(JSON.stringify(teacherData, null, 2))
    printSupabaseError('Teacher RPC error', teacherError)

    const { data: requests, error: requestsError } = await teacherClient
      .from('requests')
      .select('id, status, created_by_user_id, institution_id')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(5)

    console.log('\n=== Teacher visible requests (sample) ===')
    console.log(JSON.stringify(requests, null, 2))
    printSupabaseError('Teacher requests load error', requestsError)

    if (requests?.[0]?.id) {
      const liveRequestId = requests[0].id
      console.log('\n=== Retrying RPC with teacher-owned request ===')
      console.log('Payload:', JSON.stringify({ p_request_id: liveRequestId }, null, 2))
      const { data: liveData, error: liveError } = await teacherClient.rpc(
        'send_request_reminder',
        { p_request_id: liveRequestId },
      )
      console.log('data:', JSON.stringify(liveData, null, 2))
      printSupabaseError('Live request RPC error', liveError)
    }
  }
} else {
  console.log('\n(Set VERIFY_TEACHER_EMAIL and VERIFY_TEACHER_PASSWORD in .env for authenticated probe)')
}

// Probe audit_logs columns via service role if available
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
if (serviceRoleKey) {
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: auditSample, error: auditError } = await admin
    .from('audit_logs')
    .select('*')
    .limit(1)

  console.log('\n=== audit_logs sample row (service role) ===')
  console.log(JSON.stringify(auditSample, null, 2))
  printSupabaseError('audit_logs sample error', auditError)

  const { data: reminders, error: remindersError } = await admin
    .from('request_reminders')
    .select('*')
    .limit(3)

  console.log('\n=== request_reminders sample rows ===')
  console.log(JSON.stringify(reminders, null, 2))
  printSupabaseError('request_reminders sample error', remindersError)
}
