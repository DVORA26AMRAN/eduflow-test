import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821130000_school_registration_marketing_consent.sql',
)
const intakeAtomicPath = resolve(
  process.cwd(),
  'supabase/migrations/20250816040000_school_registration_intake_atomic.sql',
)
const budgetP1aPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821120000_budget_phase1a_configuration_schema.sql',
)
const budgetP1bPath = resolve(
  process.cwd(),
  'supabase/migrations/20250821121000_budget_phase1b_permission_foundation.sql',
)
const edgePath = resolve(
  process.cwd(),
  'supabase/functions/school-registration-intake/index.ts',
)
const formPagePath = resolve(process.cwd(), 'src/pages/SchoolRegistrationPage.tsx')
const formUtilPath = resolve(process.cwd(), 'src/utils/schoolRegistrationForm.ts')
const servicePath = resolve(process.cwd(), 'src/services/schoolRegistration.ts')
const adminSectionPath = resolve(
  process.cwd(),
  'src/components/platform/PlatformAdminRegistrationsSection.tsx',
)
const typesPath = resolve(process.cwd(), 'src/types/schoolRegistration.ts')

const migrationSql = readFileSync(migrationPath, 'utf8')
const intakeAtomicSql = readFileSync(intakeAtomicPath, 'utf8')
const budgetP1aSql = readFileSync(budgetP1aPath, 'utf8')
const budgetP1bSql = readFileSync(budgetP1bPath, 'utf8')
const edgeSource = readFileSync(edgePath, 'utf8')
const formPageSource = readFileSync(formPagePath, 'utf8')
const formUtilSource = readFileSync(formUtilPath, 'utf8')
const serviceSource = readFileSync(servicePath, 'utf8')
const adminSectionSource = readFileSync(adminSectionPath, 'utf8')
const typesSource = readFileSync(typesPath, 'utf8')

describe('school registration marketing consent — database contract', () => {
  it('adds consent columns with safe defaults on school_registrations', () => {
    expect(migrationSql).toContain('ALTER TABLE public.school_registrations')
    expect(migrationSql).toContain(
      'ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT FALSE',
    )
    expect(migrationSql).toContain('ADD COLUMN marketing_consent_at TIMESTAMPTZ NULL')
  })

  it('enforces consent/timestamp invariant at database level', () => {
    expect(migrationSql).toContain(
      'school_registrations_marketing_consent_timestamp_invariant',
    )
    expect(migrationSql).toMatch(
      /marketing_consent = FALSE AND marketing_consent_at IS NULL/,
    )
    expect(migrationSql).toMatch(
      /marketing_consent = TRUE AND marketing_consent_at IS NOT NULL/,
    )
  })

  it('sets server-authoritative consent timestamp on intake create', () => {
    expect(migrationSql).toContain('p_marketing_consent BOOLEAN DEFAULT FALSE')
    expect(migrationSql).toMatch(
      /school_registration_intake_create[\s\S]*WHEN v_marketing_consent THEN NOW\(\)/,
    )
    expect(migrationSql).not.toContain('p_marketing_consent_at')
    expect(migrationSql).toMatch(
      /INSERT INTO public\.school_registrations[\s\S]*marketing_consent_at/,
    )
  })

  it('does not infer historical consent for existing registrations', () => {
    expect(migrationSql).toContain('DEFAULT FALSE')
    expect(migrationSql).not.toMatch(/UPDATE public\.school_registrations[\s\S]*TRUE/)
  })

  it('extends platform admin read RPCs without weakening ACL', () => {
    expect(migrationSql).toContain('platform_admin_list_school_registrations')
    expect(migrationSql).toContain('platform_admin_get_school_registration')
    expect(migrationSql).toContain('marketing_consent BOOLEAN')
    expect(migrationSql).toContain('marketing_consent_at TIMESTAMPTZ')
    expect(migrationSql).toContain('platform_admin_require_active()')
    expect(migrationSql).not.toMatch(
      /GRANT\s+(SELECT|INSERT|UPDATE|ALL).*school_registrations.*TO\s+(anon|authenticated)/i,
    )
  })

  it('replaces intake RPC signature without granting client EXECUTE', () => {
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS public.school_registration_intake_create',
    )
    const intakeGrantSection = migrationSql.slice(
      migrationSql.indexOf('REVOKE ALL ON FUNCTION public.school_registration_intake_create'),
      migrationSql.indexOf('GRANT EXECUTE ON FUNCTION public.school_registration_intake_create'),
    )
    expect(intakeGrantSection).toContain('FROM authenticated')
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.school_registration_intake_create',
    )
    expect(migrationSql).toContain('TO service_role')
    expect(intakeAtomicSql).toContain(
      'school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)',
    )
  })
})

describe('school registration marketing consent — submission contract', () => {
  it('rejects browser-supplied consent timestamp and passes boolean only', () => {
    expect(edgeSource).toContain("'marketing_consent_at'")
    expect(edgeSource).toContain('p_marketing_consent: marketingConsent')
    expect(edgeSource).not.toContain('marketing_consent_at:')
    expect(formUtilSource).toContain('marketing_consent: boolean')
    expect(formUtilSource).not.toContain('marketing_consent_at')
    expect(serviceSource).toMatch(
      /submitSchoolRegistration[\s\S]*body: JSON\.stringify\(validation\.values\)/,
    )
    expect(formUtilSource).not.toMatch(/marketing_consent_at/)
  })

  it('defaults missing marketing_consent to false at the edge', () => {
    expect(edgeSource).toMatch(
      /marketingConsent[\s\S]*body\.marketing_consent === true[\s\S]*: false/,
    )
  })

  it('maps consent fields in the admin service read model', () => {
    expect(serviceSource).toContain('marketingConsent')
    expect(serviceSource).toContain('marketingConsentAt')
    expect(serviceSource).toContain('row.marketing_consent')
    expect(serviceSource).toContain('row.marketing_consent_at')
  })
})

describe('school registration marketing consent — UI contract', () => {
  it('defines exact Hebrew checkbox label and form field', () => {
    expect(typesSource).toContain(
      'אני מסכים/ה לקבל עדכונים ודיוור שיווקי',
    )
    expect(formPageSource).toContain('SCHOOL_REGISTRATION_MARKETING_CONSENT_LABEL')
    expect(formPageSource).toContain('marketingConsent: false')
    expect(formPageSource).toContain('type="checkbox"')
    expect(formPageSource).toContain('htmlFor="reg-marketing-consent"')
    expect(formPageSource).toContain('id="reg-marketing-consent"')
  })

  it('shows admin table column with Hebrew title and yes/no display', () => {
    expect(typesSource).toContain('הסכמה לדיוור')
    expect(adminSectionSource).toContain('MARKETING_CONSENT_COLUMN_LABEL')
    expect(adminSectionSource).toContain('marketingConsentDisplayLabel')
    expect(typesSource).toMatch(/consent \? 'כן' : 'לא'/)
    expect(adminSectionSource).not.toContain('marketingConsentAt')
  })
})

describe('school registration marketing consent — regression guardrails', () => {
  it('does not modify Budget P1A/P1B migrations', () => {
    expect(budgetP1aSql).not.toContain('marketing_consent')
    expect(budgetP1bSql).not.toContain('marketing_consent')
  })

  it('does not implement P1C/P1D or ledger scope in this migration', () => {
    expect(migrationSql).not.toContain('budget_ledger_entries')
    expect(migrationSql).not.toContain('budget_allocations')
    expect(migrationSql).not.toMatch(/CREATE TABLE public\.budget_/)
  })

  it('does not touch public.requests or quotation PDF scope', () => {
    expect(migrationSql).not.toMatch(/ALTER TABLE public\.requests/)
    expect(migrationSql).not.toContain('quotation_pdf')
    expect(migrationSql).not.toContain('school_registration_quotations')
  })
})
