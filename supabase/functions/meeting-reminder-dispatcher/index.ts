import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/**
 * Phase 5 backend reminder dispatcher — authoritative production scheduler.
 * Invoked on a schedule (Supabase scheduled functions / external cron).
 * Never called from UI. Do not also run pg_cron against the same dispatch RPC.
 * Calls meeting_calendar_dispatch_due_reminders with the service role.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'method_not_allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('meeting_calendar_dispatch_due_reminders')

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
