import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { requireServiceRoleJwt } from '../_shared/requireServiceRole.ts'

/**
 * Printing Phase 4 — retention cleanup worker.
 * Lists eligible print items, deletes private storage objects, then marks purged.
 * Service-role only. Idempotent. Continues after individual failures.
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

  const { data: candidates, error: listError } = await supabase.rpc(
    'printing_list_retention_purge_candidates',
    { p_batch_size: batchSize },
  )

  if (listError) {
    console.error('[printing-retention-cleanup]', { op: 'list', error: listError.message })
    return new Response(JSON.stringify({ ok: false, error: 'list_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = Array.isArray(candidates) ? candidates : []
  let purged = 0
  let failed = 0

  for (const row of rows) {
    const itemId = row.print_item_id as string
    const path = row.storage_object_path as string | null
    const institutionId = row.institution_id as string

    if (!itemId || !path) {
      failed += 1
      continue
    }

    const { error: removeError } = await supabase.storage.from('printing-files').remove([path])
    if (removeError) {
      console.error('[printing-retention-cleanup]', {
        op: 'storage_remove',
        print_item_id: itemId,
        institution_id: institutionId,
        result: 'PRINT_RETENTION_DELETE_FAILED',
      })
      failed += 1
      continue
    }

    const { data: markResult, error: markError } = await supabase.rpc(
      'printing_mark_item_file_purged',
      { p_print_item_id: itemId },
    )

    if (markError || !markResult || markResult.ok !== true) {
      console.error('[printing-retention-cleanup]', {
        op: 'mark_purged',
        print_item_id: itemId,
        institution_id: institutionId,
        result: markResult?.error_code ?? 'PRINT_RETENTION_DELETE_FAILED',
      })
      failed += 1
      continue
    }

    purged += 1
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scanned: rows.length,
      purged,
      failed,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
