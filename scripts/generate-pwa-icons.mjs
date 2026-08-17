/**
 * Regenerate PWA icons from the product M mark.
 * Source of truth: src/assets/branding/m-transition-logo.png.png
 *
 * Requires sharp (dev): npm install -D sharp
 *   node scripts/generate-pwa-icons.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let sharp
try {
  sharp = require('sharp')
} catch {
  console.error('Install sharp first: npm install -D sharp')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src/assets/branding/m-transition-logo.png.png')
const outDir = path.join(root, 'public/icons')
mkdirSync(outDir, { recursive: true })

const bg = { r: 255, g: 255, b: 255, alpha: 1 }

async function makeSquare(size, padRatio, file) {
  const inner = Math.round(size * (1 - padRatio * 2))
  const resized = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: bg })
    .png()
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toFile(path.join(outDir, file))
  console.log('wrote', file, size)
}

await makeSquare(192, 0.12, 'icon-192.png')
await makeSquare(512, 0.12, 'icon-512.png')
await makeSquare(512, 0.2, 'icon-512-maskable.png')
await makeSquare(180, 0.1, 'apple-touch-icon.png')
await makeSquare(32, 0.08, 'favicon-32.png')
await makeSquare(48, 0.08, 'favicon-48.png')
console.log('done')
