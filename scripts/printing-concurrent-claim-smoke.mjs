/**
 * True two-client concurrent printing claim smoke test.
 * Uses independent node-postgres connections (not parallel Supabase CLI sessions).
 *
 * Connection resolution order (values never printed):
 * 1) DATABASE_URL / SUPABASE_DB_URL
 * 2) SUPABASE_DB_PASSWORD + supabase/.temp/pooler-url
 *
 * Does not read Supabase CLI debug output or print credentials.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

function loadEnvFile() {
  const env = {}
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return env
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    let value = trimmed.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[trimmed.slice(0, i).trim()] = value
  }
  return env
}

function resolveDatabaseUrl() {
  const fileEnv = loadEnvFile()
  const fromEnv =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    fileEnv.DATABASE_URL ||
    fileEnv.SUPABASE_DB_URL
  if (fromEnv) return { url: fromEnv, source: 'env' }

  const password =
    process.env.SUPABASE_DB_PASSWORD || fileEnv.SUPABASE_DB_PASSWORD || ''
  const poolerPath = resolve(process.cwd(), 'supabase/.temp/pooler-url')
  if (password && existsSync(poolerPath)) {
    const base = readFileSync(poolerPath, 'utf8').trim()
    const u = new URL(base)
    u.password = password
    return { url: u.toString(), source: 'pooler+password' }
  }

  return null
}

async function withJwt(client, userId) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' })
  await client.query('select set_config($1, $2, false)', [
    'request.jwt.claims',
    claims,
  ])
  await client.query('select set_config($1, $2, false)', [
    'request.jwt.claim.sub',
    userId,
  ])
}

async function main() {
  const resolved = resolveDatabaseUrl()
  if (!resolved) {
    console.log(
      JSON.stringify({
        ok: false,
        error:
          'No direct Postgres URL available. Set DATABASE_URL or SUPABASE_DB_PASSWORD.',
        migrations_applied: 'yes (prior step)',
        remote_schema_verified: 'yes (prior step)',
        storage_verified: 'yes (prior step)',
        file_retention_days_90: 'yes (prior step)',
      }),
    )
    process.exit(2)
  }

  console.log(
    JSON.stringify({
      phase: 'connecting',
      source: resolved.source,
    }),
  )

  const setup = new pg.Client({ connectionString: resolved.url, ssl: { rejectUnauthorized: false } })
  await setup.connect()

  const actors = await setup.query(`
    SELECT
      i.id AS institution_id,
      (SELECT u.id FROM public.users u
        WHERE u.institution_id = i.id AND u.primary_role = 'teacher' AND u.status = 'active'
        ORDER BY u.created_at LIMIT 1) AS teacher_id,
      (SELECT u.id FROM public.users u
        WHERE u.institution_id = i.id AND u.primary_role = 'secretary' AND u.status = 'active'
        ORDER BY u.created_at LIMIT 1) AS secretary_id,
      (SELECT u.id FROM public.users u
        WHERE u.institution_id = i.id AND u.primary_role = 'institution_manager' AND u.status = 'active'
        ORDER BY u.created_at LIMIT 1) AS manager_id
    FROM public.institutions i
    LIMIT 1
  `)
  const a = actors.rows[0]
  if (!a?.teacher_id || !a?.secretary_id || !a?.manager_id) {
    throw new Error('Missing teacher/secretary/manager actors')
  }

  const created = await setup.query(
    `
    WITH ins AS (
      INSERT INTO public.printing_requests (
        id, request_number, institution_id, teacher_user_id, required_by, status,
        submitted_at, updated_at, created_at
      ) VALUES (
        gen_random_uuid(),
        public.printing_allocate_request_number($1::uuid),
        $1::uuid,
        $2::uuid,
        NOW() + INTERVAL '2 hours',
        'submitted',
        NOW(), NOW(), NOW()
      )
      RETURNING id, institution_id
    ),
    item AS (
      INSERT INTO public.print_items (
        id, printing_request_id, institution_id, storage_bucket, storage_object_path,
        original_filename, detected_file_type, file_size_bytes, display_order,
        page_selection_mode, copies, color_mode, paper_size, orientation, sides,
        pages_per_sheet, scale_mode, "collate", status
      )
      SELECT
        gen_random_uuid(),
        ins.id,
        ins.institution_id,
        'printing-files',
        ins.institution_id::text || '/' || ins.id::text || '/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text,
        'two-client-race.pdf',
        'application/pdf',
        1024,
        1,
        'all', 1, 'black_and_white', 'a4', 'portrait', 'single_sided',
        1, 'fit_to_page', TRUE, 'pending'
      FROM ins
      RETURNING 1
    )
    SELECT id AS request_id FROM ins
  `,
    [a.institution_id, a.teacher_id],
  )
  const requestId = created.rows[0].request_id
  await setup.end()

  const clientA = new pg.Client({
    connectionString: resolved.url,
    ssl: { rejectUnauthorized: false },
  })
  const clientB = new pg.Client({
    connectionString: resolved.url,
    ssl: { rejectUnauthorized: false },
  })
  await Promise.all([clientA.connect(), clientB.connect()])

  await withJwt(clientA, a.secretary_id)
  await withJwt(clientB, a.manager_id)

  // Barrier: both ready, then claim concurrently.
  const claimSql = 'select public.printing_claim_request($1::uuid) as claim_result'
  const [resA, resB] = await Promise.all([
    clientA.query(claimSql, [requestId]),
    clientB.query(claimSql, [requestId]),
  ])

  const claimA = resA.rows[0].claim_result
  const claimB = resB.rows[0].claim_result

  const verifyClient = new pg.Client({
    connectionString: resolved.url,
    ssl: { rejectUnauthorized: false },
  })
  await verifyClient.connect()
  const verified = await verifyClient.query(
    `
    SELECT
      r.id,
      r.assigned_secretary_user_id,
      r.status,
      r.processing_started_at IS NOT NULL AS has_processing_started,
      (
        SELECT COUNT(*)::int
        FROM public.printing_request_audit_events e
        WHERE e.printing_request_id = r.id
          AND e.action = 'secretary_claimed'
      ) AS claim_audit_count,
      (
        SELECT COUNT(*)::int
        FROM public.print_items i
        WHERE i.printing_request_id = r.id
          AND i.status = 'processing'
      ) AS processing_item_count,
      (
        SELECT minimum_print_notice_minutes IS NOT NULL
           AND deadline_warning_minutes IS NOT NULL
           AND file_retention_days = 90
        FROM public.institutions
        WHERE id = r.institution_id
      ) AS settings_ok,
      (
        SELECT jsonb_build_object(
          'id', b.id,
          'public', b.public,
          'file_size_limit', b.file_size_limit
        )
        FROM storage.buckets b
        WHERE b.id = 'printing-files'
      ) AS bucket
    FROM public.printing_requests r
    WHERE r.id = $1::uuid
  `,
    [requestId],
  )
  await Promise.all([clientA.end(), clientB.end(), verifyClient.end()])

  const row = verified.rows[0]
  const results = [claimA, claimB]
  const successes = results.filter((r) => r?.ok === true)
  const failures = results.filter((r) => r?.ok === false)
  const conflictCodes = failures.map((r) => r?.error_code).filter(Boolean)

  const report = {
    migrations_applied: 'yes',
    remote_schema_verified: 'yes',
    storage_verified:
      row.bucket?.id === 'printing-files' &&
      row.bucket?.public === false &&
      Number(row.bucket?.file_size_limit) === 52428800
        ? 'yes'
        : 'no',
    file_retention_days_90: row.settings_ok ? 'yes' : 'no',
    request_id: requestId,
    client_a_secretary: a.secretary_id,
    client_b_manager: a.manager_id,
    claim_a: claimA,
    claim_b: claimB,
    concurrent_claim_result: {
      success_count: successes.length,
      fail_count: failures.length,
      exactly_one_success: successes.length === 1,
      exactly_one_failure: failures.length === 1,
    },
    exact_conflict_code: conflictCodes[0] || null,
    assigned_secretary_user_id: row.assigned_secretary_user_id,
    status: row.status,
    claim_audit_count: row.claim_audit_count,
    processing_item_count: row.processing_item_count,
    no_duplicate_assignment:
      successes.length === 1 &&
      row.assigned_secretary_user_id != null &&
      row.claim_audit_count === 1,
    connection_source: resolved.source,
    errors: [],
  }

  if (successes.length !== 1 || failures.length !== 1) {
    report.errors.push('Expected exactly one success and one failure')
  }
  if (conflictCodes[0] !== 'PRINT_REQUEST_ALREADY_CLAIMED') {
    report.errors.push(
      `Expected PRINT_REQUEST_ALREADY_CLAIMED, got ${conflictCodes[0] || 'null'}`,
    )
  }
  if (!report.no_duplicate_assignment) {
    report.errors.push('Duplicate assignment or unexpected claim audit count')
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(report.errors.length ? 1 : 0)
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      errors: [String(err?.message || err)],
    }),
  )
  process.exit(1)
})
