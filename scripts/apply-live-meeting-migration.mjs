/**
 * Apply the Live Meeting Actions migration to the staging/dev database only.
 *
 * Required .env:
 *   DATABASE_URL or SUPABASE_DB_URL  (direct Postgres connection)
 *   VITE_SUPABASE_URL               (used as host allowlist for safety)
 *
 * Optional:
 *   ALLOW_LIVE_MIGRATION_HOSTS=host1,host2  (extra allowed hosts)
 *
 * Refuses to run against hosts that are not the app's configured Supabase host
 * (or an explicitly allowlisted host). Never targets production aliases.
 *
 * Run: node scripts/apply-live-meeting-migration.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const MIGRATION_FILE =
  'supabase/migrations/20250721120000_meeting_calendar_live_actions.sql'
const MIGRATION_VERSION = '20250721120000'

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
    // .env may be absent
  }
  return { ...env, ...process.env }
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function assertStagingOnly(env, databaseUrl) {
  const appHost = hostFromUrl(env.VITE_SUPABASE_URL ?? '')
  const dbHost = hostFromUrl(databaseUrl)
  if (!dbHost) {
    throw new Error('DATABASE_URL is not a valid URL')
  }

  const blocked = ['prod', 'production']
  const haystack = `${dbHost} ${databaseUrl}`.toLowerCase()
  for (const token of blocked) {
    if (haystack.includes(`.${token}.`) || haystack.includes(`-${token}-`)) {
      throw new Error(`Refusing to apply: DATABASE_URL looks like production (${token})`)
    }
  }

  const extra = (env.ALLOW_LIVE_MIGRATION_HOSTS ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  const allowed = new Set(
    [appHost, ...extra].filter(Boolean).flatMap((host) => {
      // Pooler hosts are db.<ref>.supabase.co or aws-0-....pooler.supabase.com
      if (host.endsWith('.supabase.co')) {
        const ref = host.split('.')[0]
        return [
          host,
          `db.${ref}.supabase.co`,
          `aws-0-eu-central-1.pooler.supabase.com`,
          `aws-0-eu-west-1.pooler.supabase.com`,
          `aws-0-us-east-1.pooler.supabase.com`,
        ]
      }
      return [host]
    }),
  )

  // Prefer matching project ref from VITE_SUPABASE_URL inside DATABASE_URL.
  if (appHost?.endsWith('.supabase.co')) {
    const ref = appHost.split('.')[0]
    if (!databaseUrl.includes(ref) && !allowed.has(dbHost)) {
      throw new Error(
        `Refusing to apply: DATABASE_URL host "${dbHost}" does not match staging project ref "${ref}" from VITE_SUPABASE_URL`,
      )
    }
    return { appHost, dbHost, projectRef: ref }
  }

  if (!allowed.has(dbHost)) {
    throw new Error(
      `Refusing to apply: DATABASE_URL host "${dbHost}" is not allowlisted. Set VITE_SUPABASE_URL or ALLOW_LIVE_MIGRATION_HOSTS.`,
    )
  }

  return { appHost, dbHost, projectRef: null }
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      statements text[],
      name text
    )
  `)
}

async function main() {
  const env = loadEnvFile()
  const databaseUrl = env.DATABASE_URL ?? env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error:
            'DATABASE_URL or SUPABASE_DB_URL is required to apply the live meeting migration to staging.',
          hint: 'Add the staging Postgres connection string to .env (not production).',
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }

  const target = assertStagingOnly(env, databaseUrl)
  const sql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8')
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    // Prefer Supabase migrations schema when present.
    const schemaCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = 'supabase_migrations'
      ) AS exists
    `)
    const hasMigrationsSchema = schemaCheck.rows[0]?.exists === true

    if (hasMigrationsSchema) {
      await ensureSchemaMigrationsTable(client)
      const existing = await client.query(
        `SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1`,
        [MIGRATION_VERSION],
      )
      if (existing.rowCount > 0) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              alreadyApplied: true,
              migration: MIGRATION_FILE,
              version: MIGRATION_VERSION,
              target,
            },
            null,
            2,
          ),
        )
        return
      }
    }

    // Fallback idempotency probe for environments without schema_migrations.
    const probe = await client.query(`
      SELECT to_regprocedure('public.meeting_calendar_get_live_context(uuid)') IS NOT NULL AS has_live_context,
             to_regclass('public.meeting_activity_events') IS NOT NULL AS has_activity_events
    `)
    if (probe.rows[0]?.has_live_context && probe.rows[0]?.has_activity_events) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            alreadyApplied: true,
            migration: MIGRATION_FILE,
            version: MIGRATION_VERSION,
            detectedVia: 'object_probe',
            target,
          },
          null,
          2,
        ),
      )
      return
    }

    await client.query('BEGIN')
    await client.query(sql)
    if (hasMigrationsSchema) {
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [MIGRATION_VERSION, 'meeting_calendar_live_actions'],
      )
    }
    await client.query('COMMIT')

    console.log(
      JSON.stringify(
        {
          ok: true,
          alreadyApplied: false,
          migration: MIGRATION_FILE,
          version: MIGRATION_VERSION,
          target,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore
    }
    console.error(
      JSON.stringify(
        {
          ok: false,
          migration: MIGRATION_FILE,
          target,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  } finally {
    await client.end()
  }
}

await main()
