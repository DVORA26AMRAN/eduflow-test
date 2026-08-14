import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildR2ObjectKey,
  parseR2ObjectKey,
  isNonDestructiveBackupModel,
} from '../../scripts/storage-backup/paths.mjs'
import {
  PROTECTED_SOURCE_BUCKETS,
  ENUMERATION_PAGE_SIZE,
  BACKUP_CONCURRENCY,
  R2_BACKUP_BUCKET,
  R2_KEY_PREFIX,
} from '../../scripts/storage-backup/config.mjs'
import {
  backupDeletesDestinationWhenSourceMissing,
  defaultBackupConcurrency,
  enumerateBucketObjects,
  mapPool,
  backupProtectedBuckets,
  redactSecrets,
  sanitizeErrorForLog,
  formatFailureDiagnostic,
} from '../../scripts/storage-backup/backup-core.mjs'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

type StorageListRow = {
  id: string | null
  name: string
  metadata?: { size?: number; contentLength?: number } | null
}

/** Mock Supabase client that serves Storage list() pages by prefix. */
function createStorageEnumMock(options: {
  pagesByPrefix?: Record<string, StorageListRow[][]>
  listError?: { message: string; code?: string; status?: number }
  download?: () => Promise<{ data: unknown; error: unknown }>
}) {
  const pagesByPrefix = options.pagesByPrefix ?? { '': [[]] }
  const offsets: Record<string, number> = {}

  return {
    schema() {
      throw new Error('enumeration must not use PostgREST .schema()')
    },
    storage: {
      from(bucketId: string) {
        return {
          async list(prefix = '', listOptions?: { limit?: number; offset?: number }) {
            if (options.listError) {
              return { data: null, error: options.listError }
            }
            const key = prefix || ''
            const pages = pagesByPrefix[key] ?? [[]]
            const pageIndex = offsets[key] ?? 0
            offsets[key] = pageIndex + 1
            const page = pages[pageIndex] ?? []
            // Honor offset semantics used by production code (page advance via offset bump).
            void listOptions
            void bucketId
            return { data: page, error: null }
          },
          async download(path: string) {
            void path
            if (options.download) {
              return options.download()
            }
            return { data: null, error: { message: 'unexpected download' } }
          },
        }
      },
    },
  }
}

describe('B2 storage backup — protected buckets & destination identity', () => {
  it('includes both required source buckets', () => {
    expect(PROTECTED_SOURCE_BUCKETS).toEqual([
      'request-attachments',
      'printing-files',
    ])
  })

  it('targets the private R2 backup bucket and prefix', () => {
    expect(R2_BACKUP_BUCKET).toBe('mpex-production-backup')
    expect(R2_KEY_PREFIX).toBe('supabase-storage')
  })

  it('preserves source bucket + full object path in R2 keys', () => {
    const path =
      'inst-aaa/req-bbb/att-ccc/report.pdf'
    const key = buildR2ObjectKey('request-attachments', path)
    expect(key).toBe(
      'supabase-storage/request-attachments/inst-aaa/req-bbb/att-ccc/report.pdf',
    )
    expect(parseR2ObjectKey(key)).toEqual({
      sourceBucket: 'request-attachments',
      objectPath: path,
    })
  })

  it('does not flatten nested printing paths', () => {
    const path = 'inst/print/item/large.bin'
    expect(buildR2ObjectKey('printing-files', path)).toBe(
      'supabase-storage/printing-files/inst/print/item/large.bin',
    )
  })
})

describe('B2 storage backup — pagination & concurrency', () => {
  it('uses a bounded page size (never assumes a single page)', () => {
    expect(ENUMERATION_PAGE_SIZE).toBeGreaterThan(0)
    expect(ENUMERATION_PAGE_SIZE).toBeLessThanOrEqual(1000)
    const core = read('scripts/storage-backup/backup-core.mjs')
    expect(core).toContain('ENUMERATION_PAGE_SIZE')
    expect(core).toContain('.list(prefix')
    expect(core).toContain('offset')
    expect(core).toMatch(/rows\.length < ENUMERATION_PAGE_SIZE/)
    // Regression: PostgREST storage-schema enumeration causes PGRST125 in production.
    expect(core).not.toMatch(/supabase\s*\.\s*schema\(/)
    expect(core).not.toMatch(/\.from\(\s*['"]objects['"]\s*\)/)
  })

  it('enumerates via Storage list API and fails closed on PGRST125-style PostgREST path', async () => {
    const core = read('scripts/storage-backup/backup-core.mjs')
    expect(core).toContain('supabase.storage.from(bucketId).list')
    expect(core).not.toMatch(/supabase\s*\.\s*schema\(/)

    let listCalls = 0
    let schemaCalls = 0
    const supabase = {
      schema(name: string) {
        schemaCalls += 1
        void name
        return {
          from() {
            return this
          },
          select() {
            return this
          },
          eq() {
            return this
          },
          order() {
            return this
          },
          async range() {
            return {
              data: null,
              error: {
                code: 'PGRST125',
                message: 'Invalid path specified in request URL',
              },
            }
          },
        }
      },
      storage: {
        from(bucketId: string) {
          expect(bucketId).toBe('request-attachments')
          return {
            async list(prefix: string, opts: { limit: number; offset: number }) {
              listCalls += 1
              expect(prefix).toBe('')
              expect(opts.limit).toBe(ENUMERATION_PAGE_SIZE)
              expect(opts.offset).toBe(0)
              return {
                data: [
                  {
                    id: 'obj-1',
                    name: 'inst/req/file.pdf',
                    metadata: { size: 12 },
                  },
                ],
                error: null,
              }
            },
          }
        },
      },
    }

    const objects = await enumerateBucketObjects(supabase, 'request-attachments')
    expect(schemaCalls).toBe(0)
    expect(listCalls).toBe(1)
    expect(objects).toEqual([{ name: 'inst/req/file.pdf', size: 12 }])
  })

  it('paginates until a short page', async () => {
    const page0 = Array.from({ length: ENUMERATION_PAGE_SIZE }, (_, i) => ({
      id: `id-${i}`,
      name: `obj-${i}`,
      metadata: { size: i },
    }))
    const page1 = Array.from({ length: 3 }, (_, i) => ({
      id: `id-b-${i}`,
      name: `obj-b-${i}`,
      metadata: { size: i },
    }))
    const supabase = createStorageEnumMock({
      pagesByPrefix: {
        '': [page0, page1],
      },
    })

    const objects = await enumerateBucketObjects(supabase, 'request-attachments')
    expect(objects).toHaveLength(ENUMERATION_PAGE_SIZE + 3)
    expect(objects[0]?.name).toBe('obj-0')
  })

  it('recurses into folder entries to preserve full object paths', async () => {
    const supabase = createStorageEnumMock({
      pagesByPrefix: {
        '': [[{ id: null, name: 'inst', metadata: null }]],
        inst: [
          [
            {
              id: 'file-1',
              name: 'doc.pdf',
              metadata: { size: 44 },
            },
          ],
        ],
      },
    })

    const objects = await enumerateBucketObjects(supabase, 'printing-files')
    expect(objects).toEqual([{ name: 'inst/doc.pdf', size: 44 }])
  })

  it('bounds concurrent object workers', async () => {
    expect(defaultBackupConcurrency()).toBe(BACKUP_CONCURRENCY)
    expect(BACKUP_CONCURRENCY).toBeGreaterThan(0)
    expect(BACKUP_CONCURRENCY).toBeLessThanOrEqual(4)

    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 8 }, (_, i) => i)
    await mapPool(items, 2, async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
    })
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
})

describe('B2 storage backup — non-destructive model', () => {
  it('declares copy-based non-destructive semantics', () => {
    expect(isNonDestructiveBackupModel()).toBe(true)
    expect(backupDeletesDestinationWhenSourceMissing()).toBe(false)
  })

  it('never issues DeleteObject in backup utilities', () => {
    const core = read('scripts/storage-backup/backup-core.mjs')
    const backupCli = read('scripts/storage-backup/backup.mjs')
    expect(core).not.toMatch(/DeleteObjectCommand/)
    expect(core).not.toMatch(/\bdeleteObject\b/)
    expect(backupCli).not.toMatch(/DeleteObjectCommand/)
    expect(core).toContain('from \'@aws-sdk/client-s3\'')
    expect(core).toContain('PutObjectCommand')
    expect(core).toContain('HeadObjectCommand')
  })

  it('skips re-upload when destination exists with same size (no dest delete)', async () => {
    const objectPath = 'inst/req/att/file.txt'
    const body = Buffer.from('hello-backup')
    const r2Key = buildR2ObjectKey('request-attachments', objectPath)

    const supabase = createStorageEnumMock({
      pagesByPrefix: {
        '': [
          [
            {
              id: 'obj-1',
              name: objectPath,
              metadata: { size: body.length },
            },
          ],
        ],
      },
      download: async () => {
        throw new Error('download should not run when sizes match')
      },
    })

    const sent: string[] = []
    const r2 = {
      async send(command: { constructor: { name: string }; input?: { Key?: string } }) {
        sent.push(command.constructor.name)
        if (command.constructor.name === 'HeadObjectCommand') {
          return { ContentLength: body.length }
        }
        if (command.constructor.name === 'PutObjectCommand') {
          throw new Error('PutObject must not run for identical existing dest')
        }
        if (command.constructor.name === 'DeleteObjectCommand') {
          throw new Error('DeleteObject must never run')
        }
        return {}
      },
    }

    const report = await backupProtectedBuckets(supabase, r2, [
      'request-attachments',
    ])
    expect(report.ok).toBe(true)
    expect(report.skippedExisting).toBe(1)
    expect(report.uploaded).toBe(0)
    expect(report.failed).toBe(0)
    expect(sent).toContain('HeadObjectCommand')
    expect(sent).not.toContain('PutObjectCommand')
    expect(sent).not.toContain('DeleteObjectCommand')
    expect(r2Key.startsWith('supabase-storage/request-attachments/')).toBe(true)
  })

  it('does not request destination deletion when source enumeration is empty', async () => {
    const supabase = createStorageEnumMock({
      pagesByPrefix: { '': [[]] },
    })
    const sent: string[] = []
    const r2 = {
      async send(command: { constructor: { name: string } }) {
        sent.push(command.constructor.name)
        return {}
      },
    }
    const report = await backupProtectedBuckets(supabase, r2, [
      'printing-files',
    ])
    expect(report.ok).toBe(true)
    expect(report.discovered).toBe(0)
    expect(sent).not.toContain('DeleteObjectCommand')
  })

  it('fails the run when an object backup fails', async () => {
    const supabase = createStorageEnumMock({
      pagesByPrefix: {
        '': [
          [
            {
              id: 'obj-1',
              name: 'a/b/c.bin',
              metadata: { size: 10 },
            },
          ],
        ],
      },
      download: async () => ({ data: null, error: { message: 'download boom' } }),
    })
    const r2 = {
      async send(command: { constructor: { name: string } }) {
        if (command.constructor.name === 'HeadObjectCommand') {
          const err = new Error('NotFound') as Error & {
            name: string
            $metadata: { httpStatusCode: number }
          }
          err.name = 'NotFound'
          err.$metadata = { httpStatusCode: 404 }
          throw err
        }
        return {}
      },
    }

    const report = await backupProtectedBuckets(supabase, r2, [
      'request-attachments',
    ])
    expect(report.ok).toBe(false)
    expect(report.failed).toBeGreaterThan(0)
  })

  it('records safe enumeration failure diagnostics with bucket/phase/message', async () => {
    const supabase = createStorageEnumMock({
      listError: {
        message: 'permission denied for schema storage',
        code: '42501',
        status: 401,
      },
    })
    const r2 = { async send() { return {} } }

    const report = await backupProtectedBuckets(supabase, r2, [
      'request-attachments',
    ])
    expect(report.ok).toBe(false)
    expect(report.failed).toBe(1)
    expect(report.discovered).toBe(0)
    expect(report.buckets[0]?.failures).toHaveLength(1)
    const failure = report.buckets[0].failures[0]
    expect(failure.bucket).toBe('request-attachments')
    expect(failure.phase).toBe('enumeration')
    expect(failure.message).toContain('permission denied for schema storage')
    expect(failure.code).toBe('42501')
    expect(failure.status).toBe(401)
  })
})

describe('B2 storage backup — safe failure diagnostics', () => {
  it('redacts bearer tokens and JWTs from diagnostic text', () => {
    const dirty =
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb failed apikey=supersecret'
    expect(redactSecrets(dirty)).not.toContain('eyJhbGci')
    expect(redactSecrets(dirty)).not.toContain('supersecret')
    expect(redactSecrets(dirty)).toContain('[REDACTED]')

    const safe = sanitizeErrorForLog({
      message: dirty,
      code: 'PGRST301',
      status: 403,
    })
    expect(safe.message).not.toContain('eyJhbGci')
    expect(safe.code).toBe('PGRST301')
    expect(safe.status).toBe(403)

    const diagnostic = formatFailureDiagnostic(
      'printing-files',
      'enumeration',
      { message: dirty, code: '42501', status: 401 },
    )
    expect(diagnostic.bucket).toBe('printing-files')
    expect(diagnostic.phase).toBe('enumeration')
    expect(diagnostic.code).toBe('42501')
    expect(diagnostic.status).toBe(401)
    expect(diagnostic.message).not.toContain('eyJhbGci')
    expect(diagnostic.message).toContain('[REDACTED')
  })

  it('summary logging includes failure message not only phases', () => {
    const backupCli = read('scripts/storage-backup/backup.mjs')
    expect(backupCli).toContain('failures: b.failures.map')
    expect(backupCli).toContain('message: f.message')
    expect(backupCli).not.toContain('failurePhases:')
    expect(backupCli).toContain('JSON.stringify')
  })
})

describe('B2 storage backup — workflow, secrets, restore gating', () => {
  const workflowPath = ' .github/workflows/storage-backup.yml'.trim()
  const workflow = read(workflowPath)
  const envSource = read('scripts/storage-backup/env.mjs')
  const restoreSource = read('scripts/storage-backup/restore.mjs')
  const backupCli = read('scripts/storage-backup/backup.mjs')
  const clients = read('scripts/storage-backup/clients.mjs')

  it('ships the scheduled + manually dispatchable workflow', () => {
    expect(existsSync(resolve(root, workflowPath))).toBe(true)
    expect(workflow).toContain('schedule:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('concurrency:')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('node scripts/storage-backup/backup.mjs')
  })

  it('references required secrets only via GitHub Secrets', () => {
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_ACCOUNT_ID',
    ]) {
      expect(workflow).toContain(`secrets.${name}`)
      expect(envSource).toContain(`'${name}'`)
    }
    expect(workflow).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    expect(backupCli).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    expect(clients).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })

  it('does not hardcode credentials in backup tooling', () => {
    const files = [
      'scripts/storage-backup/config.mjs',
      'scripts/storage-backup/env.mjs',
      'scripts/storage-backup/clients.mjs',
      'scripts/storage-backup/backup.mjs',
      'scripts/storage-backup/restore.mjs',
      'scripts/storage-backup/backup-core.mjs',
      workflowPath,
    ]
    for (const file of files) {
      const source = read(file)
      expect(source).not.toMatch(/R2_SECRET_ACCESS_KEY\s*=\s*['"][^$]/)
      expect(source).not.toMatch(/service_role['"]\s*:\s*['"]eyJ/)
      expect(source).not.toContain('sk_live_')
    }
  })

  it('does not upload storage objects as workflow artifacts', () => {
    expect(workflow.toLowerCase()).not.toContain('upload-artifact')
  })

  it('requires explicit restore invocation and refuses overwrite by default', () => {
    expect(workflow).not.toContain('restore.mjs')
    expect(restoreSource).toContain('--overwrite')
    expect(restoreSource).toContain(
      'Supabase object already exists; pass --overwrite to replace',
    )
    expect(restoreSource).toMatch(/overwrite:\s*false/)
    expect(existsSync(resolve(root, 'docs/storage-backup-restore-runbook.md'))).toBe(
      true,
    )
  })
})
