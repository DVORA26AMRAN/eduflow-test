#!/usr/bin/env node
/**
 * Operator-controlled restore: R2 backup → Supabase Storage.
 *
 * Usage:
 *   node scripts/storage-backup/restore.mjs --bucket request-attachments --path "<object-path>"
 *   node scripts/storage-backup/restore.mjs --bucket printing-files --path "<object-path>" --overwrite
 *
 * By default refuses to overwrite an existing Supabase object.
 * Not scheduled — disaster recovery only.
 */
import { createWriteStream } from 'node:fs'
import { unlink, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { loadBackupEnv } from './env.mjs'
import { createR2Client, createSupabaseAdmin, getR2BackupBucketName } from './clients.mjs'
import { buildR2ObjectKey, parseR2ObjectKey } from './paths.mjs'
import { PROTECTED_SOURCE_BUCKETS } from './config.mjs'
import { withBoundedRetry, errorMessage } from './backup-core.mjs'

function parseArgs(argv) {
  const args = {
    bucket: null,
    path: null,
    overwrite: false,
    r2Key: null,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--overwrite') {
      args.overwrite = true
      continue
    }
    if (token === '--bucket') {
      args.bucket = argv[i + 1] ?? null
      i += 1
      continue
    }
    if (token === '--path') {
      args.path = argv[i + 1] ?? null
      i += 1
      continue
    }
    if (token === '--r2-key') {
      args.r2Key = argv[i + 1] ?? null
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
    }
  }

  return args
}

function printHelp() {
  console.info(`Restore one object from R2 backup to Supabase Storage.

Required:
  --bucket <request-attachments|printing-files>
  --path <exact-original-object-path>

Optional:
  --overwrite          Allow replacing an existing Supabase object
  --r2-key <full-key>  Alternative to --bucket/--path (must be under supabase-storage/)

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_* secrets
`)
}

async function streamBodyToFile(body, destPath) {
  if (!body) {
    throw new Error('empty R2 body')
  }
  if (typeof body.transformToByteArray === 'function') {
    const bytes = Buffer.from(await body.transformToByteArray())
    await pipeline(Readable.from(bytes), createWriteStream(destPath))
    return bytes.length
  }
  await pipeline(body, createWriteStream(destPath))
  const info = await stat(destPath)
  return info.size
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath)
  } catch {
    // best-effort
  }
}

async function supabaseObjectExists(supabase, bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath)
  if (data && !error) {
    return true
  }
  return false
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  let sourceBucket
  let objectPath

  if (args.r2Key) {
    const parsed = parseR2ObjectKey(args.r2Key)
    sourceBucket = parsed.sourceBucket
    objectPath = parsed.objectPath
  } else {
    sourceBucket = args.bucket
    objectPath = args.path
  }

  if (!sourceBucket || !objectPath) {
    printHelp()
    throw new Error('Restore requires --bucket and --path (or --r2-key)')
  }

  if (!PROTECTED_SOURCE_BUCKETS.includes(sourceBucket)) {
    throw new Error(
      `bucket must be one of: ${PROTECTED_SOURCE_BUCKETS.join(', ')}`,
    )
  }

  const env = loadBackupEnv()
  const supabase = createSupabaseAdmin(env)
  const r2 = createR2Client(env)
  const r2Key = buildR2ObjectKey(sourceBucket, objectPath)

  console.info('[storage-restore] start', {
    bucket: sourceBucket,
    overwrite: args.overwrite,
  })

  if (!args.overwrite) {
    const exists = await supabaseObjectExists(supabase, sourceBucket, objectPath)
    if (exists) {
      throw new Error('Supabase object already exists; pass --overwrite to replace')
    }
  }

  const tempPath = join(
    tmpdir(),
    `mpex-storage-restore-${process.pid}-${Date.now()}.bin`,
  )

  try {
    const getResult = await withBoundedRetry('r2-get', () =>
      r2.send(
        new GetObjectCommand({
          Bucket: getR2BackupBucketName(),
          Key: r2Key,
        }),
      ),
    )

    const bytes = await streamBodyToFile(getResult.Body, tempPath)
    const body = await readFile(tempPath)

    const { error: uploadError } = await withBoundedRetry('supabase-upload', () =>
      supabase.storage.from(sourceBucket).upload(objectPath, body, {
        upsert: args.overwrite,
        contentType: getResult.ContentType ?? 'application/octet-stream',
      }),
    )

    if (uploadError) {
      throw new Error(`restore upload failed: ${errorMessage(uploadError)}`)
    }

    const { data: verify, error: verifyError } = await supabase.storage
      .from(sourceBucket)
      .download(objectPath)

    if (verifyError || !verify) {
      throw new Error(`restore verification failed: ${errorMessage(verifyError)}`)
    }

    const restoredBytes = Buffer.from(await verify.arrayBuffer()).length
    if (restoredBytes !== bytes) {
      throw new Error(
        `restore size mismatch expected=${bytes} actual=${restoredBytes}`,
      )
    }

    console.info('[storage-restore] ok', {
      bucket: sourceBucket,
      bytes: restoredBytes,
      overwrite: args.overwrite,
    })
  } finally {
    await safeUnlink(tempPath)
  }
}

main().catch((error) => {
  console.error(
    '[storage-restore] fatal',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
