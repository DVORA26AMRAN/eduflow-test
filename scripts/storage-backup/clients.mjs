import { createClient } from '@supabase/supabase-js'
import { S3Client } from '@aws-sdk/client-s3'
import { createR2Endpoint } from './env.mjs'
import { R2_BACKUP_BUCKET } from './config.mjs'

export function createSupabaseAdmin(env) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createR2Client(env) {
  return new S3Client({
    region: 'auto',
    endpoint: createR2Endpoint(env.r2AccountId),
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
    forcePathStyle: false,
  })
}

export function getR2BackupBucketName() {
  return R2_BACKUP_BUCKET
}
