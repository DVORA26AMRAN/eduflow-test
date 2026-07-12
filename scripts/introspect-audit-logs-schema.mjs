/**
 * Probe audit_logs column names via PostgREST select validation.
 * Run: node scripts/introspect-audit-logs-schema.mjs
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
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const candidateColumns = [
  'id',
  'institution_id',
  'user_id',
  'actor_user_id',
  'actor_id',
  'changed_by_user_id',
  'performed_by_user_id',
  'created_by_user_id',
  'action',
  'action_type',
  'entity_type',
  'entity_id',
  'metadata',
  'created_at',
  'updated_at',
]

const validColumns = []

for (const column of candidateColumns) {
  const { error } = await client.from('audit_logs').select(column).limit(0)
  const missing = error?.message?.includes('does not exist')

  if (!error) {
    validColumns.push(column)
    continue
  }

  if (!missing) {
    console.log(`column ${column}:`, error.message)
  }
}

console.log('\nValid audit_logs columns from probe:')
console.log(validColumns.join(', ') || '(none detected)')

const { error: starError } = await client.from('audit_logs').select('*').limit(1)
if (starError) {
  console.log('\nselect * error:', starError.message)
} else {
  const { data } = await client.from('audit_logs').select('*').limit(1)
  if (data?.[0]) {
    console.log('\nSample row keys:', Object.keys(data[0]).join(', '))
    console.log('Sample action_type:', data[0].action_type ?? '(missing)')
  } else {
    console.log('\nselect * succeeded (table empty or RLS returned no rows)')
  }
}

const openapiResponse = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
  },
})

if (openapiResponse.ok) {
  const openapi = await openapiResponse.json()
  const actionTypeProp = openapi.definitions?.audit_logs?.properties?.action_type
  console.log('\naudit_logs.action_type OpenAPI definition:')
  console.log(JSON.stringify(actionTypeProp, null, 2))
} else {
  console.log('\nOpenAPI fetch failed:', openapiResponse.status, openapiResponse.statusText)
}
