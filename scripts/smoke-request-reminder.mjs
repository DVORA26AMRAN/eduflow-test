/**
 * Live smoke test for send_request_reminder after audit schema fix.
 * Run after applying 20250712153000_fix_request_reminder_audit_logs_action_type.sql
 *
 * Optional .env:
 *   VERIFY_TEACHER_EMAIL / VERIFY_TEACHER_PASSWORD
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

const env = loadEnvFile()
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const teacherEmail = env.VERIFY_TEACHER_EMAIL
const teacherPassword = env.VERIFY_TEACHER_PASSWORD

if (!url || !anonKey || !teacherEmail || !teacherPassword) {
  console.error('Missing VITE_SUPABASE_* or VERIFY_TEACHER_* credentials in .env')
  process.exit(1)
}

const teacherClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { error: signInError } = await teacherClient.auth.signInWithPassword({
  email: teacherEmail,
  password: teacherPassword,
})

if (signInError) {
  console.error('Teacher sign-in failed:', signInError.message)
  process.exit(1)
}

const { data: requests, error: requestsError } = await teacherClient
  .from('requests')
  .select('id, status')
  .in('status', ['new', 'in_progress'])
  .is('archived_at', null)
  .order('created_at', { ascending: false })
  .limit(1)

if (requestsError || !requests?.[0]) {
  console.error('No eligible teacher request found for smoke test', requestsError?.message)
  process.exit(1)
}

const request = requests[0]
const { data, error } = await teacherClient.rpc('send_request_reminder', {
  p_request_id: request.id,
})

if (error) {
  console.error('Smoke test RPC failed:', JSON.stringify(error, null, 2))
  process.exit(1)
}

console.log('Smoke test RPC response:', JSON.stringify(data, null, 2))

const { count: reminderCount } = await teacherClient
  .from('request_reminders')
  .select('*', { count: 'exact', head: true })
  .eq('request_id', request.id)

const { data: refreshedRequest } = await teacherClient
  .from('requests')
  .select('status')
  .eq('id', request.id)
  .single()

console.log('Reminder rows for request:', reminderCount)
console.log('Request status unchanged:', refreshedRequest?.status === request.status)
