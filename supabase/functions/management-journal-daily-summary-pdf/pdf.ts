import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1'
import * as fontkitImport from 'https://esm.sh/@pdf-lib/fontkit@1.0.0'
import {
  NOTO_SANS_HEBREW_REGULAR_TTF_SHA256,
  notoSansHebrewRegularBytes,
} from './fonts/notoSansHebrewRegular.b64.ts'

const fontkit = (fontkitImport as { default?: unknown }).default ?? fontkitImport

export const MANAGEMENT_JOURNAL_PDF_GENERATOR_VERSION = 'mpex-management-journal-pdf/v1'

/** Integrity constant — update only together with regenerating the font embed. */
export const BUNDLED_NOTO_SANS_HEBREW_SHA256 =
  'a7fa16fffb27bedb060a0866267c29e9859aeb9c21cc33f5b3aaf6eb062eca85'

export const STATUS_LABELS: Record<string, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  completed: 'הושלם',
  blocked: 'חסום',
}

export type ManagementJournalPdfTask = {
  title: string
  status: string
  sort_order: number
}

export type ManagementJournalPdfInput = {
  institution_name: string
  journal_date: string
  page_type: 'personal' | 'shared'
  owner_full_name: string | null
  participant_names: string[]
  tasks: ManagementJournalPdfTask[]
}

export type BidiRun = {
  text: string
  hebrew: boolean
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase()
}

export async function loadBundledHebrewFontBytes(): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; code: string }
> {
  try {
    const expected = BUNDLED_NOTO_SANS_HEBREW_SHA256.toLowerCase()
    if (NOTO_SANS_HEBREW_REGULAR_TTF_SHA256.toLowerCase() !== expected) {
      return { ok: false, code: 'pdf_font_hash_mismatch' }
    }
    const bytes = notoSansHebrewRegularBytes()
    if (!bytes || bytes.byteLength < 16) {
      return { ok: false, code: 'pdf_font_unavailable' }
    }
    const b0 = bytes[0]
    const b1 = bytes[1]
    const b2 = bytes[2]
    const b3 = bytes[3]
    const isTtf =
      (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
      (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) ||
      (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f)
    if (!isTtf) {
      return { ok: false, code: 'pdf_font_unavailable' }
    }
    const hash = await sha256Hex(bytes)
    if (hash !== expected) {
      return { ok: false, code: 'pdf_font_hash_mismatch' }
    }
    return { ok: true, bytes }
  } catch {
    return { ok: false, code: 'pdf_font_unavailable' }
  }
}

function containsHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

/** Strip punctuation that Noto Sans Hebrew maps to .notdef boxes. */
export function sanitizePdfText(text: string): string {
  return text
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u00B7/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split logical bidi runs. Spaces stay attached to the preceding run.
 * Hebrew runs use the bundled Hebrew TTF; other runs use Helvetica because
 * Noto Sans Hebrew does not reliably include Latin digit glyphs.
 */
export function splitBidiRuns(text: string): BidiRun[] {
  const runs: BidiRun[] = []
  for (const ch of text) {
    const hebrew = /[\u0590-\u05FF]/.test(ch)
    const space = /\s/.test(ch)
    const last = runs[runs.length - 1]
    if (!last) {
      runs.push({ text: ch, hebrew })
      continue
    }
    if (space) {
      last.text += ch
      continue
    }
    if (hebrew === last.hebrew) {
      last.text += ch
    } else {
      runs.push({ text: ch, hebrew })
    }
  }
  return runs
}

/** @deprecated Prefer splitBidiRuns. Kept for source contracts. */
export function toVisualPdfText(text: string): string {
  return splitBidiRuns(text)
    .map((run) => (run.hebrew ? [...run.text].reverse().join('') : run.text))
    .join('')
}

function measureMixedLine(
  text: string,
  hebrewFont: PDFFont,
  latinFont: PDFFont,
  size: number,
): number {
  return splitBidiRuns(text).reduce((total, run) => {
    const painted = run.hebrew ? [...run.text].reverse().join('') : run.text
    const font = run.hebrew ? hebrewFont : latinFont
    return total + font.widthOfTextAtSize(painted, size)
  }, 0)
}

export function wrapTextToWidth(
  text: string,
  hebrewFont: PDFFont,
  latinFont: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const normalized = sanitizePdfText(text)
  if (!normalized) return []

  const words = normalized.split(' ')
  const lines: string[] = []
  let current = ''

  const pushCurrent = () => {
    if (current) {
      lines.push(current)
      current = ''
    }
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (measureMixedLine(candidate, hebrewFont, latinFont, size) <= maxWidth) {
      current = candidate
      continue
    }

    pushCurrent()

    if (measureMixedLine(word, hebrewFont, latinFont, size) <= maxWidth) {
      current = word
      continue
    }

    let chunk = ''
    for (const ch of word) {
      const next = chunk + ch
      if (measureMixedLine(next, hebrewFont, latinFont, size) <= maxWidth) {
        chunk = next
      } else {
        if (chunk) lines.push(chunk)
        chunk = ch
      }
    }
    current = chunk
  }
  pushCurrent()
  return lines
}

function drawRtlMixedLine(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  pageWidth: number,
  margin: number,
  hebrewFont: PDFFont,
  latinFont: PDFFont,
  color = rgb(0.08, 0.12, 0.18),
) {
  const runs = splitBidiRuns(text)
  if (runs.length === 0) return

  let x = pageWidth - margin
  for (const run of runs) {
    const painted = run.hebrew ? [...run.text].reverse().join('') : run.text
    if (!painted) continue
    const font = run.hebrew ? hebrewFont : latinFont
    const width = font.widthOfTextAtSize(painted, size)
    x -= width
    page.drawText(painted, {
      x: Math.max(margin, x),
      y,
      size,
      font,
      color,
    })
  }
}

function drawInLeftColumn(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  margin: number,
  columnWidth: number,
  hebrewFont: PDFFont,
  latinFont: PDFFont,
  color = rgb(0.08, 0.12, 0.18),
) {
  let x = margin + columnWidth
  for (const run of splitBidiRuns(text)) {
    const painted = run.hebrew ? [...run.text].reverse().join('') : run.text
    if (!painted) continue
    const font = run.hebrew ? hebrewFont : latinFont
    const width = font.widthOfTextAtSize(painted, size)
    x -= width
    page.drawText(painted, {
      x: Math.max(margin, x),
      y,
      size,
      font,
      color,
    })
  }
}

function pageTypeLabel(pageType: 'personal' | 'shared'): string {
  return pageType === 'personal' ? 'דף אישי' : 'דף משותף'
}

export function buildManagementJournalPdfFilename(journalDate: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(journalDate) ? journalDate : 'unknown-date'
  return `management-journal-${safeDate}.pdf`
}

export async function buildManagementJournalDailySummaryPdf(
  input: ManagementJournalPdfInput,
): Promise<
  | { ok: true; bytes: Uint8Array; contentSha256: string; generatorVersion: string; filename: string }
  | { ok: false; code: string }
> {
  if (!input.institution_name.trim() || !input.journal_date.trim()) {
    return { ok: false, code: 'pdf_snapshot_invalid' }
  }
  if (input.page_type !== 'personal' && input.page_type !== 'shared') {
    return { ok: false, code: 'pdf_snapshot_invalid' }
  }

  const fontBytes = await loadBundledHebrewFontBytes()
  if (!fontBytes.ok) return fontBytes

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit as Parameters<PDFDocument['registerFontkit']>[0])
  const hebrewFont = await pdf.embedFont(fontBytes.bytes, { subset: true })
  const latinFont = await pdf.embedFont(StandardFonts.Helvetica)

  try {
    if (hebrewFont.widthOfTextAtSize('א', 12) <= 0) {
      return { ok: false, code: 'pdf_font_unavailable' }
    }
  } catch {
    return { ok: false, code: 'pdf_font_unavailable' }
  }

  const pageWidth = 595
  const pageHeight = 842
  const margin = 48
  const contentWidth = pageWidth - margin * 2
  const statusColWidth = 90
  const taskColWidth = contentWidth - statusColWidth - 12

  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const ensureSpace = (needed: number) => {
    if (y - needed >= margin) return
    page = pdf.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
  }

  const drawBlock = (text: string, size: number, gap = 6) => {
    const lines = wrapTextToWidth(text, hebrewFont, latinFont, size, contentWidth)
    for (const line of lines) {
      ensureSpace(size + gap)
      drawRtlMixedLine(page, line, y, size, pageWidth, margin, hebrewFont, latinFont)
      y -= size + gap
    }
  }

  drawBlock(input.institution_name, 16, 8)
  drawBlock('סיכום יומי', 18, 8)
  drawBlock(input.journal_date, 12, 6)
  drawBlock(pageTypeLabel(input.page_type), 12, 8)

  if (input.page_type === 'personal') {
    const owner = (input.owner_full_name ?? '').trim() || '-'
    drawBlock(`יומן אישי - ${owner}`, 12, 10)
  } else {
    const names = input.participant_names.map((n) => n.trim()).filter(Boolean)
    if (names.length > 0) {
      drawBlock(`משתתפות: ${names.join(', ')}`, 11, 10)
    }
  }

  ensureSpace(28)
  drawRtlMixedLine(
    page,
    'משימה',
    y,
    11,
    pageWidth,
    margin,
    hebrewFont,
    latinFont,
    rgb(0.25, 0.28, 0.35),
  )
  drawInLeftColumn(
    page,
    'סטטוס',
    y,
    11,
    margin,
    statusColWidth,
    hebrewFont,
    latinFont,
    rgb(0.25, 0.28, 0.35),
  )
  y -= 16
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.8,
    color: rgb(0.75, 0.78, 0.82),
  })
  y -= 14

  const ordered = [...input.tasks].sort((a, b) => a.sort_order - b.sort_order)

  if (ordered.length === 0) {
    drawBlock('אין משימות להצגה בדוח היומי', 11, 8)
  } else {
    for (const task of ordered) {
      const statusLabel = STATUS_LABELS[task.status] ?? task.status
      const titleLines = wrapTextToWidth(task.title || '-', hebrewFont, latinFont, 11, taskColWidth)
      const statusLines = wrapTextToWidth(statusLabel, hebrewFont, latinFont, 11, statusColWidth)
      const rowLines = Math.max(titleLines.length, statusLines.length, 1)
      ensureSpace(rowLines * 16 + 8)

      for (let i = 0; i < rowLines; i += 1) {
        const title = titleLines[i] ?? ''
        const status = statusLines[i] ?? ''
        if (title) {
          drawRtlMixedLine(page, title, y, 11, pageWidth, margin, hebrewFont, latinFont)
        }
        if (status) {
          drawInLeftColumn(page, status, y, 11, margin, statusColWidth, hebrewFont, latinFont)
        }
        y -= 16
      }
      y -= 4
    }
  }

  if (containsHebrew('סיכום')) {
    try {
      hebrewFont.widthOfTextAtSize('סיכום', 12)
    } catch {
      return { ok: false, code: 'pdf_font_unavailable' }
    }
  }

  const bytes = await pdf.save()
  const contentSha256 = await sha256Hex(bytes)
  return {
    ok: true,
    bytes,
    contentSha256,
    generatorVersion: MANAGEMENT_JOURNAL_PDF_GENERATOR_VERSION,
    filename: buildManagementJournalPdfFilename(input.journal_date),
  }
}
