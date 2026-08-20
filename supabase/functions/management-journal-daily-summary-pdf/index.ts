/**
 * management-journal-daily-summary-pdf
 *
 * Transient Management Journal daily-summary PDF.
 * Auth: caller JWT + existing J1 RLS (user-scoped anon client only; no elevated DB role).
 * Body: { page_id } only — server reloads authoritative page/tasks/names.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  buildManagementJournalDailySummaryPdf,
  buildManagementJournalPdfFilename,
  type ManagementJournalPdfTask,
} from './pdf.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MANAGEMENT_ROLES = new Set(['institution_manager', 'deputy', 'secretary'])

type JsonBody = {
  page_id?: unknown
  tasks?: unknown
  institution_name?: unknown
  owner_full_name?: unknown
  participant_names?: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing env: ${name}`)
  return value
}

function asUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null
  }
  return trimmed
}

function parseJournalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  // Postgres date may arrive as ISO timestamp via PostgREST
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)
  return m ? m[1]! : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')?.trim()
  if (!authHeader) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: JsonBody
  try {
    body = (await req.json()) as JsonBody
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  // Reject client-supplied report payloads — page_id only.
  if (
    body.tasks !== undefined ||
    body.institution_name !== undefined ||
    body.owner_full_name !== undefined ||
    body.participant_names !== undefined
  ) {
    return jsonResponse({ ok: false, error: 'client_payload_rejected' }, 400)
  }

  const pageId = asUuid(body.page_id)
  if (!pageId) {
    return jsonResponse({ ok: false, error: 'invalid_page_id' }, 400)
  }

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const { data: caller, error: callerError } = await userClient
      .from('users')
      .select('id, full_name, primary_role, status, institution_id')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (callerError || !caller) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (caller.status !== 'active') {
      return jsonResponse({ ok: false, error: 'inactive' }, 403)
    }

    if (!MANAGEMENT_ROLES.has(String(caller.primary_role))) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (!caller.institution_id) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const { data: page, error: pageError } = await userClient
      .from('management_journal_pages')
      .select('id, institution_id, journal_date, page_type, owner_user_id')
      .eq('id', pageId)
      .maybeSingle()

    // RLS hides non-readable pages → null looks like not found / forbidden.
    if (pageError || !page) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    if (page.institution_id !== caller.institution_id) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const pageType = page.page_type === 'personal' || page.page_type === 'shared' ? page.page_type : null
    if (!pageType) {
      return jsonResponse({ ok: false, error: 'invalid_page' }, 400)
    }

    const journalDate = parseJournalDate(page.journal_date)
    if (!journalDate) {
      return jsonResponse({ ok: false, error: 'invalid_page' }, 400)
    }

    const { data: institution, error: institutionError } = await userClient
      .from('institutions')
      .select('id, name')
      .eq('id', page.institution_id)
      .maybeSingle()

    if (institutionError || !institution?.name) {
      return jsonResponse({ ok: false, error: 'institution_unavailable' }, 403)
    }

    let ownerFullName: string | null = null
    let participantNames: string[] = []

    if (pageType === 'personal') {
      const { data: owner, error: ownerError } = await userClient
        .from('users')
        .select('id, full_name')
        .eq('id', page.owner_user_id)
        .maybeSingle()
      if (ownerError || !owner) {
        return jsonResponse({ ok: false, error: 'forbidden' }, 403)
      }
      ownerFullName = typeof owner.full_name === 'string' ? owner.full_name : null
    } else {
      const { data: participantRows, error: participantsError } = await userClient
        .from('management_journal_page_participants')
        .select('user_id')
        .eq('page_id', page.id)

      if (participantsError) {
        return jsonResponse({ ok: false, error: 'forbidden' }, 403)
      }

      const userIds = (participantRows ?? [])
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === 'string')

      if (userIds.length > 0) {
        const { data: users, error: usersError } = await userClient
          .from('users')
          .select('id, full_name')
          .in('id', userIds)

        if (usersError) {
          return jsonResponse({ ok: false, error: 'forbidden' }, 403)
        }

        const byId = new Map(
          (users ?? []).map((u) => [u.id as string, typeof u.full_name === 'string' ? u.full_name : '']),
        )
        participantNames = userIds.map((id) => byId.get(id) ?? '').filter(Boolean)
      }
    }

    const { data: taskRows, error: tasksError } = await userClient
      .from('management_journal_tasks')
      .select('id, title, status, sort_order')
      .eq('page_id', page.id)
      .order('sort_order', { ascending: true })

    if (tasksError) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    const tasks: ManagementJournalPdfTask[] = (taskRows ?? []).map((row) => ({
      title: typeof row.title === 'string' ? row.title : '',
      status: typeof row.status === 'string' ? row.status : '',
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    }))

    const rendered = await buildManagementJournalDailySummaryPdf({
      institution_name: String(institution.name),
      journal_date: journalDate,
      page_type: pageType,
      owner_full_name: ownerFullName,
      participant_names: participantNames,
      tasks,
    })

    if (!rendered.ok) {
      return jsonResponse({ ok: false, error: rendered.code }, 500)
    }

    const filename = rendered.filename || buildManagementJournalPdfFilename(journalDate)

    const pdfBytes = new Uint8Array(rendered.bytes.byteLength)
    pdfBytes.set(rendered.bytes)

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Content-Sha256': rendered.contentSha256,
        'X-Generator-Version': rendered.generatorVersion,
      },
    })
  } catch (error) {
    console.error('[management-journal-daily-summary-pdf] failed', error)
    return jsonResponse({ ok: false, error: 'internal_error' }, 500)
  }
})
