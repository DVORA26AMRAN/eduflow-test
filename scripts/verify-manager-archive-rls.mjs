/**
 * Database-level RLS verification for manager personal archive.
 * Run: node scripts/verify-manager-archive-rls.mjs
 *
 * Required .env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional role credentials (if omitted, discovered via service role):
 *   VERIFY_MANAGER_A_EMAIL / VERIFY_MANAGER_A_PASSWORD
 *   VERIFY_MANAGER_B_EMAIL / VERIFY_MANAGER_B_PASSWORD
 *   VERIFY_TEACHER_EMAIL / VERIFY_TEACHER_PASSWORD
 *   VERIFY_SECRETARY_EMAIL / VERIFY_SECRETARY_PASSWORD
 *   VERIFY_STUDENT_EMAIL / VERIFY_STUDENT_PASSWORD
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
    // .env may be absent in CI
  }
  return env
}

function createAuthedClient(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
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
    accessToken: data.session.access_token,
    client: createAuthedClient(url, anonKey, data.session.access_token),
  }
}

function resultRow(id, passed, detail) {
  return { id, passed, detail }
}

async function fetchPolicies(admin, tableName) {
  const { data, error } = await admin.rpc('exec_sql', {
    query: `
      SELECT policyname, cmd, roles::text AS roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = '${tableName}'
      ORDER BY policyname
    `,
  })

  if (error) {
    return { ok: false, error: error.message, policies: [] }
  }

  return { ok: true, policies: data ?? [] }
}

async function queryPoliciesViaPg(env) {
  const databaseUrl = env.DATABASE_URL ?? env.SUPABASE_DB_URL
  if (!databaseUrl) {
    return { ok: false, error: 'DATABASE_URL or SUPABASE_DB_URL not set', policies: {} }
  }

  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    const tables = ['requests', 'manager_archived_requests']
    const policies = {}
    for (const tableName of tables) {
      const res = await client.query(
        `
          SELECT policyname, cmd, roles::text AS roles, qual, with_check
          FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1
          ORDER BY policyname
        `,
        [tableName],
      )
      policies[tableName] = res.rows
    }
    return { ok: true, policies }
  } finally {
    await client.end()
  }
}

async function discoverUsers(admin) {
  const { data, error } = await admin
    .from('users')
    .select('id, email, primary_role, institution_id, status')
    .eq('status', 'active')

  if (error) {
    throw new Error(`failed to load users: ${error.message}`)
  }

  return data ?? []
}

async function discoverCredentials(admin, users) {
  const byRole = (role) => users.filter((user) => user.primary_role === role)
  const managers = byRole('institution_manager')
  const teachers = byRole('teacher')
  const secretaries = byRole('secretary')
  const students = byRole('student')

  const managerA = managers[0]
  const managerB = managers.find((user) => user.institution_id !== managerA?.institution_id) ?? managers[1]
  const teacher = teachers[0]
  const secretary = secretaries[0]
  const student = students[0]

  if (!managerA?.email) {
    throw new Error('need at least one active institution_manager in public.users')
  }

  return { managerA, managerB, teacher, secretary, student }
}

async function resolveSession(url, anonKey, env, user, emailKey, passwordKey) {
  const email = env[emailKey] ?? user?.email
  const password = env[passwordKey]
  if (!email || !password) {
    throw new Error(
      `missing credentials for ${emailKey}. Set ${emailKey} and ${passwordKey} in .env`,
    )
  }
  return signIn(url, anonKey, email, password)
}

async function findInstitutionRequest(admin, institutionId, { requireUnarchived = true } = {}) {
  let query = admin
    .from('requests')
    .select('id, institution_id, status, archived_at, created_by_user_id')
    .eq('institution_id', institutionId)
    .limit(1)

  if (requireUnarchived) {
    query = query.is('archived_at', null)
  }

  const { data, error } = await query
  if (error) throw new Error(`request lookup failed: ${error.message}`)
  return data?.[0] ?? null
}

async function findForeignInstitutionRequest(admin, institutionId) {
  const { data, error } = await admin
    .from('requests')
    .select('id, institution_id')
    .neq('institution_id', institutionId)
    .is('archived_at', null)
    .limit(1)

  if (error) throw new Error(`foreign request lookup failed: ${error.message}`)
  return data?.[0] ?? null
}

async function findTeacherOwnedRequest(admin, teacherUserId) {
  const { data, error } = await admin
    .from('requests')
    .select('id, institution_id, status, archived_at, created_by_user_id')
    .eq('created_by_user_id', teacherUserId)
    .is('archived_at', null)
    .limit(1)

  if (error) throw new Error(`teacher request lookup failed: ${error.message}`)
  return data?.[0] ?? null
}

async function findSecretaryArchivableRequest(admin, institutionId) {
  const { data, error } = await admin
    .from('requests')
    .select('id, institution_id, status, archived_at')
    .eq('institution_id', institutionId)
    .in('status', ['completed', 'rejected'])
    .is('archived_at', null)
    .limit(1)

  if (error) throw new Error(`secretary archivable request lookup failed: ${error.message}`)
  return data?.[0] ?? null
}

function isDenied(error) {
  if (!error) return false
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST116' ||
    message.includes('permission') ||
    message.includes('policy') ||
    message.includes('row-level security') ||
    message.includes('violates row-level security')
  )
}

async function runScenarioTests(context) {
  const {
    url,
    anonKey,
    admin,
    managerA,
    managerB,
    teacher,
    secretary,
    student,
    managerASession,
    managerBSession,
    teacherSession,
    secretarySession,
    studentSession,
  } = context

  const results = []
  const managerAUser = await admin
    .from('users')
    .select('institution_id')
    .eq('id', managerASession.userId)
    .single()
  const institutionId = managerAUser.data?.institution_id

  const ownRequest =
    (await findInstitutionRequest(admin, institutionId)) ??
    (teacher ? await findTeacherOwnedRequest(admin, teacher.id) : null)
  const foreignRequest = await findForeignInstitutionRequest(admin, institutionId)
  const teacherRequest = teacher ? await findTeacherOwnedRequest(admin, teacher.id) : null
  const secretaryRequest = secretary
    ? await findSecretaryArchivableRequest(admin, secretary.institution_id)
    : null

  // 1. Manager A insert own personal archive
  if (!ownRequest) {
    results.push(resultRow(1, false, 'BLOCKED: no unarchived request in manager A institution'))
  } else {
    const archiveId = `verify-mgr-a-${Date.now()}`
    const { error } = await managerASession.client.from('manager_archived_requests').insert({
      manager_user_id: managerASession.userId,
      request_id: ownRequest.id,
      archived_at: new Date().toISOString(),
    })
    if (!error) {
      results.push(resultRow(1, true, `inserted personal archive for request ${ownRequest.id}`))
      await admin
        .from('manager_archived_requests')
        .delete()
        .eq('manager_user_id', managerASession.userId)
        .eq('request_id', ownRequest.id)
    } else {
      results.push(resultRow(1, false, error.message))
    }
    void archiveId
  }

  // 2. Manager A cannot insert with Manager B user id
  if (!ownRequest || !managerBSession) {
    results.push(
      resultRow(
        2,
        false,
        `BLOCKED: need own request and manager B session (managerB=${Boolean(managerBSession)})`,
      ),
    )
  } else {
    const { error } = await managerASession.client.from('manager_archived_requests').insert({
      manager_user_id: managerBSession.userId,
      request_id: ownRequest.id,
      archived_at: new Date().toISOString(),
    })
    results.push(
      resultRow(2, Boolean(error) && isDenied(error), error?.message ?? 'insert unexpectedly succeeded'),
    )
  }

  // 3. Manager A cannot archive foreign institution request
  if (!foreignRequest) {
    results.push(resultRow(3, false, 'BLOCKED: no request found in another institution'))
  } else {
    const { error } = await managerASession.client.from('manager_archived_requests').insert({
      manager_user_id: managerASession.userId,
      request_id: foreignRequest.id,
      archived_at: new Date().toISOString(),
    })
    results.push(
      resultRow(3, Boolean(error) && isDenied(error), error?.message ?? 'insert unexpectedly succeeded'),
    )
  }

  // Seed manager A archive row for select tests
  let seededArchiveRequestId = null
  if (ownRequest) {
    await admin.from('manager_archived_requests').upsert({
      manager_user_id: managerASession.userId,
      request_id: ownRequest.id,
      archived_at: new Date().toISOString(),
    })
    seededArchiveRequestId = ownRequest.id
  }

  // 4. Manager A selects only own archive rows
  const { data: managerASelect, error: managerASelectError } = await managerASession.client
    .from('manager_archived_requests')
    .select('manager_user_id, request_id')

  if (managerASelectError) {
    results.push(resultRow(4, false, managerASelectError.message))
  } else {
    const onlyOwn = (managerASelect ?? []).every(
      (row) => row.manager_user_id === managerASession.userId,
    )
    results.push(
      resultRow(
        4,
        onlyOwn && (managerASelect?.length ?? 0) > 0,
        `rows=${managerASelect?.length ?? 0}, onlyOwn=${onlyOwn}`,
      ),
    )
  }

  // 5. Manager A cannot see Manager B archives
  if (!managerBSession || !seededArchiveRequestId) {
    results.push(resultRow(5, false, 'BLOCKED: need manager B and seeded manager A archive row'))
  } else {
    const { data, error } = await managerBSession.client
      .from('manager_archived_requests')
      .select('manager_user_id, request_id')
      .eq('manager_user_id', managerASession.userId)

    results.push(
      resultRow(
        5,
        !error && (data?.length ?? 0) === 0,
        error?.message ?? `visible rows for manager A archive: ${data?.length ?? 0}`,
      ),
    )
  }

  // 6-8. Non-managers cannot insert
  const nonManagerCases = [
    [6, teacherSession, 'teacher'],
    [7, secretarySession, 'secretary'],
    [8, studentSession, 'student'],
  ]

  for (const [id, session, label] of nonManagerCases) {
    if (!session || !ownRequest) {
      results.push(resultRow(id, false, `BLOCKED: missing ${label} session or own request`))
      continue
    }
    const { error } = await session.client.from('manager_archived_requests').insert({
      manager_user_id: session.userId,
      request_id: ownRequest.id,
      archived_at: new Date().toISOString(),
    })
    results.push(
      resultRow(
        id,
        Boolean(error) && isDenied(error),
        error?.message ?? `${label} insert unexpectedly succeeded`,
      ),
    )
  }

  // 9. Anonymous cannot select or insert
  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: anonSelect, error: anonSelectError } = await anonClient
    .from('manager_archived_requests')
    .select('manager_user_id')
    .limit(1)
  const anonSelectDenied = (anonSelect?.length ?? 0) === 0 || Boolean(anonSelectError)

  const { error: anonInsertError } = await anonClient.from('manager_archived_requests').insert({
    manager_user_id: managerASession.userId,
    request_id: ownRequest?.id ?? '00000000-0000-0000-0000-000000000000',
    archived_at: new Date().toISOString(),
  })
  results.push(
    resultRow(
      9,
      anonSelectDenied && Boolean(anonInsertError),
      `select=${anonSelectError?.message ?? `rows=${anonSelect?.length ?? 0}`}; insert=${anonInsertError?.message ?? 'succeeded'}`,
    ),
  )

  // 10-11. Manager cannot update/delete personal archive rows
  if (!seededArchiveRequestId) {
    results.push(resultRow(10, false, 'BLOCKED: no seeded archive row'))
    results.push(resultRow(11, false, 'BLOCKED: no seeded archive row'))
  } else {
    const { error: updateError } = await managerASession.client
      .from('manager_archived_requests')
      .update({ archived_at: new Date().toISOString() })
      .eq('manager_user_id', managerASession.userId)
      .eq('request_id', seededArchiveRequestId)

    const { error: deleteError } = await managerASession.client
      .from('manager_archived_requests')
      .delete()
      .eq('manager_user_id', managerASession.userId)
      .eq('request_id', seededArchiveRequestId)

    results.push(
      resultRow(
        10,
        Boolean(updateError),
        updateError?.message ?? 'update unexpectedly succeeded',
      ),
    )
    results.push(
      resultRow(
        11,
        Boolean(deleteError),
        deleteError?.message ?? 'delete unexpectedly succeeded',
      ),
    )
  }

  // 12. Manager cannot update shared archive fields
  if (!ownRequest) {
    results.push(resultRow(12, false, 'BLOCKED: no own institution request'))
  } else {
    const { error } = await managerASession.client
      .from('requests')
      .update({
        archived_at: new Date().toISOString(),
        archived_by_user_id: managerASession.userId,
      })
      .eq('id', ownRequest.id)
    results.push(
      resultRow(
        12,
        Boolean(error) || (await admin.from('requests').select('archived_at').eq('id', ownRequest.id).single()).data?.archived_at === null,
        error?.message ?? 'shared archive fields unchanged after attempted manager update',
      ),
    )
  }

  // 13. Teacher shared archive update
  if (!teacherSession || !teacherRequest) {
    results.push(resultRow(13, false, 'BLOCKED: missing teacher session or teacher-owned request'))
  } else {
    const archivedAt = new Date().toISOString()
    const { data, error } = await teacherSession.client
      .from('requests')
      .update({
        archived_at: archivedAt,
        archived_by_user_id: teacherSession.userId,
      })
      .eq('id', teacherRequest.id)
      .select('id, archived_at')
      .single()

    const passed = !error && Boolean(data?.archived_at)
    results.push(resultRow(13, passed, error?.message ?? `archived_at set=${Boolean(data?.archived_at)}`))

    if (passed) {
      await admin
        .from('requests')
        .update({ archived_at: null, archived_by_user_id: null })
        .eq('id', teacherRequest.id)
    }
  }

  // 14. Secretary shared archive update
  if (!secretarySession || !secretaryRequest) {
    results.push(
      resultRow(14, false, 'BLOCKED: missing secretary session or completed/rejected request'),
    )
  } else {
    const archivedAt = new Date().toISOString()
    const { data, error } = await secretarySession.client
      .from('requests')
      .update({
        archived_at: archivedAt,
        archived_by_user_id: secretarySession.userId,
      })
      .eq('id', secretaryRequest.id)
      .select('id, archived_at')
      .single()

    const passed = !error && Boolean(data?.archived_at)
    results.push(resultRow(14, passed, error?.message ?? `archived_at set=${Boolean(data?.archived_at)}`))

    if (passed) {
      await admin
        .from('requests')
        .update({ archived_at: null, archived_by_user_id: null })
        .eq('id', secretaryRequest.id)
    }
  }

  // 15. Teacher/Secretary cannot update outside policy scope
  if (!teacherSession || !foreignRequest) {
    results.push(resultRow(15, false, 'BLOCKED: missing teacher session or foreign request'))
  } else {
    const { error: teacherForeignError } = await teacherSession.client
      .from('requests')
      .update({
        archived_at: new Date().toISOString(),
        archived_by_user_id: teacherSession.userId,
      })
      .eq('id', foreignRequest.id)

    let secretaryForeignDenied = true
    let secretaryForeignDetail = 'secretary session not tested'
    if (secretarySession) {
      const { error } = await secretarySession.client
        .from('requests')
        .update({ status: 'in_progress' })
        .eq('id', foreignRequest.id)
      secretaryForeignDenied = Boolean(error) && isDenied(error)
      secretaryForeignDetail = error?.message ?? 'secretary foreign status update succeeded'
    }

    results.push(
      resultRow(
        15,
        Boolean(teacherForeignError) &&
          isDenied(teacherForeignError) &&
          secretaryForeignDenied,
        `teacher=${teacherForeignError?.message ?? 'succeeded'}; ${secretaryForeignDetail}`,
      ),
    )
  }

  // cleanup seeded manager archive row
  if (seededArchiveRequestId) {
    await admin
      .from('manager_archived_requests')
      .delete()
      .eq('manager_user_id', managerASession.userId)
      .eq('request_id', seededArchiveRequestId)
  }

  return results
}

async function main() {
  const env = { ...process.env, ...loadEnvFile() }
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

  const report = {
    migration141000Applied:
      'no — file removed before commit; was never applied (remained untracked in git)',
    noopMigrationHandling:
      'deleted supabase/migrations/20250712141000_revoke_manager_requests_archive_update_privilege.sql and removed the source-text-only test from managerPersonalArchive.test.ts',
    targetProject: url ?? null,
    migrationsOnTarget: {},
    policies: {},
    scenarioResults: [],
    errors: [],
  }

  if (!url || !anonKey) {
    report.errors.push('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in .env')
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: tableProbeError } = await anonClient
    .from('manager_archived_requests')
    .select('manager_user_id')
    .limit(1)

  const migrationChecks = {
    manager_archived_requests_table:
      !tableProbeError || tableProbeError.code !== 'PGRST205',
    manager_archived_requests_probe:
      tableProbeError?.code === 'PGRST205'
        ? 'table missing in schema cache'
        : tableProbeError?.message ?? 'reachable',
  }

  report.migrationsOnTarget = migrationChecks

  if (!migrationChecks.manager_archived_requests_table) {
    report.errors.push(
      'manager_archived_requests is missing on target — apply 20250712140000_manager_personal_archive.sql before RLS scenario verification',
    )
  }

  if (!serviceRoleKey) {
    report.errors.push(
      'SUPABASE_SERVICE_ROLE_KEY is required in .env for authenticated scenario verification and cleanup',
    )
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  migrationChecks.manager_update_policy_absent = null

  const policyQuery = await queryPoliciesViaPg(env)
  if (policyQuery.ok) {
    report.policies = policyQuery.policies
    const requestPolicies = policyQuery.policies.requests ?? []
    migrationChecks.manager_update_policy_absent = !requestPolicies.some((policy) =>
      policy.policyname.includes('manager_archive'),
    )
  } else {
    report.policies = { error: policyQuery.error }
  }

  report.migrationsOnTarget = migrationChecks

  if (!migrationChecks.manager_archived_requests_table) {
    report.errors.push(
      'manager_archived_requests is missing — apply 20250712140000_manager_personal_archive.sql to the target database',
    )
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  try {
    const users = await discoverUsers(admin)
    const discovered = await discoverCredentials(admin, users)

    const managerASession = await resolveSession(
      url,
      anonKey,
      env,
      discovered.managerA,
      'VERIFY_MANAGER_A_EMAIL',
      'VERIFY_MANAGER_A_PASSWORD',
    )

    const managerBSession = discovered.managerB
      ? await resolveSession(
          url,
          anonKey,
          env,
          discovered.managerB,
          'VERIFY_MANAGER_B_EMAIL',
          'VERIFY_MANAGER_B_PASSWORD',
        ).catch(() => null)
      : null

    const teacherSession = discovered.teacher
      ? await resolveSession(
          url,
          anonKey,
          env,
          discovered.teacher,
          'VERIFY_TEACHER_EMAIL',
          'VERIFY_TEACHER_PASSWORD',
        ).catch(() => null)
      : null

    const secretarySession = discovered.secretary
      ? await resolveSession(
          url,
          anonKey,
          env,
          discovered.secretary,
          'VERIFY_SECRETARY_EMAIL',
          'VERIFY_SECRETARY_PASSWORD',
        ).catch(() => null)
      : null

    const studentSession = discovered.student
      ? await resolveSession(
          url,
          anonKey,
          env,
          discovered.student,
          'VERIFY_STUDENT_EMAIL',
          'VERIFY_STUDENT_PASSWORD',
        ).catch(() => null)
      : null

    report.scenarioResults = await runScenarioTests({
      url,
      anonKey,
      admin,
      managerA: discovered.managerA,
      managerB: discovered.managerB,
      teacher: discovered.teacher,
      secretary: discovered.secretary,
      student: discovered.student,
      managerASession,
      managerBSession,
      teacherSession,
      secretarySession,
      studentSession,
    })
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }

  console.log(JSON.stringify(report, null, 2))
  const failed = report.scenarioResults.filter((row) => !row.passed)
  process.exit(report.errors.length > 0 || failed.length > 0 ? 1 : 0)
}

main()
