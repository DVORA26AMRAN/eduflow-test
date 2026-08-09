import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { requireServiceRoleJwt } from '../_shared/requireServiceRole.ts'

/**
 * Printing Phase 4 — overdue notification dispatcher.
 * Schedule via Supabase scheduled functions / external cron (service_role JWT).
 * Never expose to anon/authenticated clients.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const auth = requireServiceRoleJwt(request.headers.get('Authorization'))
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let batchSize = 50
  try {
    const body = await request.json()
    if (body && typeof body.batch_size === 'number') {
      batchSize = body.batch_size
    }
  } catch {
    /* empty body ok */
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('printing_dispatch_overdue_notifications', {
    p_batch_size: batchSize,
  })

  if (error) {
    console.error('[printing-overdue-dispatcher]', { error: error.message })
    return new Response(JSON.stringify({ ok: false, error: 'dispatch_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
