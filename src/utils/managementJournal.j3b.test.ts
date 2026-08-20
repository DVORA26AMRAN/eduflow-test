/**
 * J3B Management Journal daily-summary PDF contracts.
 * Source analysis only — no deploy / no SQL apply.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const J1 = 'supabase/migrations/20250819107000_management_journal_j1.sql'
const HARDENING = 'supabase/migrations/20250820108000_management_journal_secretary_shared_task_create_deny.sql'
const FN = 'supabase/functions/management-journal-daily-summary-pdf/index.ts'
const PDF = 'supabase/functions/management-journal-daily-summary-pdf/pdf.ts'
const FONT_MOD =
  'supabase/functions/management-journal-daily-summary-pdf/fonts/notoSansHebrewRegular.b64.ts'
const FONT_README = 'supabase/functions/management-journal-daily-summary-pdf/fonts/README.md'
const SERVICE = 'src/services/managementJournal.ts'
const SUMMARY = 'src/components/managementJournal/ManagementJournalDailySummary.tsx'
const CONFIG = 'supabase/config.toml'

const PHASE3_IMPORT_MARKERS = [
  "../_shared/quotationPdf",
  "school-registration-quotation-pdf",
  "schoolRegistrationQuotation",
  "QUOTATION_PDF_GENERATOR_VERSION",
]

describe('J3B management journal daily-summary PDF', () => {
  it('uses a dedicated Edge Function with page_id only and application/pdf response', () => {
    const fn = read(FN)
    expect(fn).toContain('body.page_id')
    expect(fn).toContain('client_payload_rejected')
    expect(fn).toContain('body.tasks !== undefined')
    expect(fn).toContain("Content-Type': 'application/pdf'")
    expect(fn).toContain('management_journal_pages')
    expect(fn).toContain('management_journal_tasks')
    expect(fn).toContain(".order('sort_order'")
    expect(fn).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(fn).not.toContain('requireServiceRole')
    expect(fn).toContain('createClient(supabaseUrl, anonKey')
    expect(fn).toContain("global: { headers: { Authorization: authHeader } }")
    expect(fn).toContain("req.headers.get('Authorization')")
    expect(fn).toContain('userClient.auth.getUser()')
    expect(fn).toContain("status !== 'active'")
    expect(fn).toContain('MANAGEMENT_ROLES')
    expect(fn).toContain('institution_manager')
    expect(fn).toContain('deputy')
    expect(fn).toContain('secretary')
  })

  it('loads authoritative institution, owner, participants, and tasks server-side', () => {
    const fn = read(FN)
    const pdf = read(PDF)
    expect(fn).toContain(".from('institutions')")
    expect(fn).toContain(".from('users')")
    expect(fn).toContain(".from('management_journal_page_participants')")
    expect(fn).toContain(".from('management_journal_tasks')")
    expect(pdf).toContain('יומן אישי -')
    expect(pdf).toContain('משתתפות:')
    expect(pdf).toContain("new: 'חדש'")
    expect(pdf).toContain("in_progress: 'בטיפול'")
    expect(pdf).toContain("completed: 'הושלם'")
    expect(pdf).toContain("blocked: 'חסום'")
    expect(pdf).toContain('sort_order')
    expect(pdf).toContain('wrapTextToWidth')
    expect(pdf).toContain('splitBidiRuns')
    expect(pdf).toContain('toVisualPdfText')
    expect(pdf).toContain('StandardFonts.Helvetica')
    expect(pdf).toContain('registerFontkit')
    expect(pdf).toContain('BUNDLED_NOTO_SANS_HEBREW_SHA256')
    expect(pdf).toContain('pdf_font_hash_mismatch')
  })

  it('isolates Hebrew font under the journal function with OFL license docs', () => {
    expect(existsSync(resolve(root, FONT_MOD))).toBe(true)
    expect(
      existsSync(
        resolve(
          root,
          'supabase/functions/management-journal-daily-summary-pdf/fonts/NotoSansHebrew-Regular.ttf',
        ),
      ),
    ).toBe(true)
    expect(
      existsSync(
        resolve(root, 'supabase/functions/management-journal-daily-summary-pdf/fonts/OFL.txt'),
      ),
    ).toBe(true)
    const readme = read(FONT_README)
    expect(readme).toContain('SIL Open Font License')
    expect(readme).toContain('Isolated journal PDF font bundle')
    expect(readme).toContain('a7fa16fffb27bedb060a0866267c29e9859aeb9c21cc33f5b3aaf6eb062eca85')
    expect(read(PDF)).toContain('./fonts/notoSansHebrewRegular.b64.ts')
    expect(read(PDF)).not.toContain("../_shared/quotationPdf")
    expect(read(FN)).not.toContain("../_shared/quotationPdf")
  })

  it('keeps client request limited to page_id and uses blob download without window.print', () => {
    const service = read(SERVICE)
    expect(service).toContain('downloadManagementJournalDailySummaryPdf')
    expect(service).toContain('JSON.stringify({ page_id: pageId })')
    expect(service).toContain("type: 'application/pdf'")
    expect(service).toContain('createObjectURL')
    expect(service).not.toContain('window.print')
    expect(service).not.toContain('school-registration-quotation-pdf')

    const summary = read(SUMMARY)
    expect(summary).toContain('downloadManagementJournalDailySummaryPdf(page.id)')
    expect(summary).toContain('isGeneratingPdf')
    expect(summary).not.toContain('window.print')
  })

  it('registers the function in config.toml with verify_jwt', () => {
    const config = read(CONFIG)
    expect(config).toContain('[functions.management-journal-daily-summary-pdf]')
    expect(config).toMatch(
      /\[functions\.management-journal-daily-summary-pdf\][\s\S]*?verify_jwt = true/,
    )
  })

  it('does not create migrations and leaves 107000/108000 readable and secretary-deny intact', () => {
    expect(
      existsSync(resolve(root, 'supabase/migrations/20250820109000_management_journal_j3b.sql')),
    ).toBe(false)
    const j1 = read(J1)
    const hardening = read(HARDENING)
    expect(createHash('sha256').update(j1).digest('hex')).toMatch(/^[a-f0-9]{64}$/)
    expect(createHash('sha256').update(hardening).digest('hex')).toMatch(/^[a-f0-9]{64}$/)
    expect(j1).toContain('auth_user_can_read_management_journal_page')
    expect(hardening).toContain("v_caller.primary_role = 'secretary'::public.user_role")
  })

  it('does not depend on Phase 3 quotation PDF modules', () => {
    for (const path of [FN, PDF, SERVICE, SUMMARY]) {
      const body = read(path)
      for (const marker of PHASE3_IMPORT_MARKERS) {
        expect(body).not.toContain(marker)
      }
    }
  })

  it('builds a deterministic safe filename from journal_date only', () => {
    const pdf = read(PDF)
    expect(pdf).toContain('management-journal-${safeDate}.pdf')
    expect(pdf).toContain('/^\\d{4}-\\d{2}-\\d{2}$/')
  })
})
