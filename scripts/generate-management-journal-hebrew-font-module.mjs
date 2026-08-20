import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve('supabase/functions/management-journal-daily-summary-pdf/fonts')
const fontPath = resolve(dir, 'NotoSansHebrew-Regular.ttf')
const bytes = readFileSync(fontPath)
const hash = createHash('sha256').update(bytes).digest('hex')
const b64 = bytes.toString('base64')

const out = `/**
 * Deploy-safe bundled Noto Sans Hebrew Regular (TTF) for Management Journal PDF.
 *
 * Disk source: ./NotoSansHebrew-Regular.ttf (+ OFL.txt).
 * Isolated from unfinished school-registration PDF assets — do not import their modules.
 * SHA-256: ${hash}
 * Do not edit the base64 payload by hand — regenerate via
 * scripts/generate-management-journal-hebrew-font-module.mjs
 */
export const NOTO_SANS_HEBREW_REGULAR_TTF_SHA256 =
  '${hash}'

export const NOTO_SANS_HEBREW_REGULAR_TTF_BASE64 =
  '${b64}'

/** Decode the exact bundled TTF bytes (no network / no filesystem). */
export function notoSansHebrewRegularBytes(): Uint8Array {
  const binary = atob(NOTO_SANS_HEBREW_REGULAR_TTF_BASE64)
  const outBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) outBytes[i] = binary.charCodeAt(i)
  return outBytes
}
`

writeFileSync(resolve(dir, 'notoSansHebrewRegular.b64.ts'), out)
console.log(JSON.stringify({ hash, ttfBytes: bytes.length, moduleChars: out.length }))
