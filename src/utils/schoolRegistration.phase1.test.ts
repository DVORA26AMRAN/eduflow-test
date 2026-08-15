import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SCHOOL_REGISTRATION_PATH,
  PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID,
} from '../types/schoolRegistration'
import {
  getSchoolRegistrationPublicUrl,
  isSchoolRegistrationPath,
  normalizeInstitutionSymbol,
  validateSchoolRegistrationForm,
} from './schoolRegistrationForm'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('school registration Phase 1 — public route security', () => {
  const main = read('src/main.tsx')
  const registrationPage = read('src/pages/SchoolRegistrationPage.tsx')
  const app = read('src/App.tsx')

  it('exposes /register-school without authenticating through App', () => {
    expect(SCHOOL_REGISTRATION_PATH).toBe('/register-school')
    expect(isSchoolRegistrationPath('/register-school')).toBe(true)
    expect(isSchoolRegistrationPath('/register-school/')).toBe(true)
    expect(isSchoolRegistrationPath('/')).toBe(false)
    expect(main).toContain('isSchoolRegistrationPath')
    expect(main).toContain('SchoolRegistrationPage')
    expect(main).toContain('<App />')
  })

  it('public registration page does not use DashboardShell or app navigation', () => {
    expect(registrationPage).not.toContain('DashboardShell')
    expect(registrationPage).not.toContain('DashboardSectionPanel')
    expect(registrationPage).not.toContain('onLogout')
    expect(registrationPage).not.toContain('ManagerDashboardPage')
    expect(registrationPage).not.toContain('to="/')
    expect(registrationPage).toContain('SchoolRegistrationPage')
  })

  it('does not mount registration inside authenticated App dashboards', () => {
    expect(app).not.toContain('SchoolRegistrationPage')
    expect(app).toContain('PlatformAdminDashboardPage')
  })
})

describe('school registration Phase 1 — form validation & symbol text', () => {
  it('requires all fields server-side shape via shared validator', () => {
    const result = validateSchoolRegistrationForm({
      schoolName: '',
      institutionSymbol: '12345',
      city: 'חיפה',
      applicantRole: 'principal',
      contactFullName: 'ישראל ישראלי',
      email: 'a@example.com',
      phone: '050-1234567',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('שם בית הספר')
    }
  })

  it('stores institution symbol as string (never numeric coercion)', () => {
    const symbol = normalizeInstitutionSymbol('0012345')
    expect(typeof symbol).toBe('string')
    expect(symbol).toBe('0012345')
    expect(Number.isNaN(Number(symbol)) || symbol === '0012345').toBe(true)

    const result = validateSchoolRegistrationForm({
      schoolName: 'בית ספר לדוגמה',
      institutionSymbol: '0012345',
      city: 'חיפה',
      applicantRole: 'vice_principal',
      contactFullName: 'ישראל ישראלי',
      email: ' Person@Example.COM ',
      phone: '050-1234567',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.institution_symbol).toBe('0012345')
      expect(typeof result.values.institution_symbol).toBe('string')
      expect(result.values.email).toBe('person@example.com')
    }
  })

  it('rejects invalid email and phone', () => {
    const badEmail = validateSchoolRegistrationForm({
      schoolName: 'א',
      institutionSymbol: '1',
      city: 'ב',
      applicantRole: 'principal',
      contactFullName: 'ג',
      email: 'not-an-email',
      phone: '050-1234567',
    })
    expect(badEmail.ok).toBe(false)

    const badPhone = validateSchoolRegistrationForm({
      schoolName: 'א',
      institutionSymbol: '1',
      city: 'ב',
      applicantRole: 'principal',
      contactFullName: 'ג',
      email: 'a@b.com',
      phone: 'abc',
    })
    expect(badPhone.ok).toBe(false)
  })
})

describe('school registration Phase 1 — public boundary & admin access', () => {
  const migration = read(
    'supabase/migrations/20250816010000_school_registrations_phase1.sql',
  )
  const edge = read('supabase/functions/school-registration-intake/index.ts')
  const config = read('supabase/config.toml')
  const service = read('src/services/schoolRegistration.ts')
  const adminPage = read('src/pages/PlatformAdminDashboardPage.tsx')
  const managerPage = read('src/pages/ManagerDashboardPage.tsx')
  const teacherPage = read('src/pages/TeacherDashboardPage.tsx')
  const secretaryPage = read('src/pages/SecretaryDashboardPage.tsx')
  const registrationsSection = read(
    'src/components/platform/PlatformAdminRegistrationsSection.tsx',
  )

  it('public caller cannot create institutions or users via intake edge function', () => {
    expect(edge).toContain('school_registrations')
    expect(edge).not.toMatch(/\.from\(\s*['"]institutions['"]\s*\)/)
    expect(edge).not.toMatch(/\.from\(\s*['"]users['"]\s*\)/)
    expect(edge).not.toContain('inviteUserByEmail')
    expect(edge).not.toContain('auth.admin')
    expect(edge).toContain("status: 'new'")
  })

  it('rejects internal/admin fields from public body', () => {
    expect(edge).toContain("'status'")
    expect(edge).toContain("'institution_id'")
    expect(edge).toContain("'converted_institution_id'")
    expect(edge).toContain('invalid_fields')
  })

  it('does not grant anonymous direct INSERT on school_registrations', () => {
    expect(migration).toContain('CREATE TABLE public.school_registrations')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.school_registrations FROM anon',
    )
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.school_registrations FROM authenticated',
    )
    expect(migration).not.toMatch(
      /GRANT\s+INSERT\s+ON\s+TABLE\s+public\.school_registrations\s+TO\s+anon/i,
    )
    expect(migration).toContain('institution_symbol    TEXT')
    expect(migration).toContain('converted_institution_id')
  })

  it('lists registrations only via Platform Admin RPCs', () => {
    expect(migration).toContain('platform_admin_list_school_registrations')
    expect(migration).toContain('platform_admin_get_school_registration')
    expect(migration).toContain('platform_admin_require_active')
    expect(service).toContain('platform_admin_list_school_registrations')
    expect(service).toContain('platform_admin_get_school_registration')
  })

  it('Platform Admin nav includes Registrations; tenant roles do not', () => {
    expect(adminPage).toContain(PLATFORM_ADMIN_REGISTRATIONS_SECTION_ID)
    expect(adminPage).toContain('PlatformAdminRegistrationsSection')
    expect(managerPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(teacherPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(secretaryPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(managerPage).not.toContain('platform_admin_list_school_registrations')
  })

  it('copy-link / preview use registration route derived from origin', () => {
    expect(getSchoolRegistrationPublicUrl('https://app.example.com')).toBe(
      'https://app.example.com/register-school',
    )
    expect(getSchoolRegistrationPublicUrl('https://app.example.com/')).toBe(
      'https://app.example.com/register-school',
    )
    expect(registrationsSection).toContain('getSchoolRegistrationPublicUrl')
    expect(registrationsSection).toContain('SCHOOL_REGISTRATION_PATH')
    expect(registrationsSection).not.toContain('localhost:5173/register-school')
  })

  it('edge function is public (verify_jwt false) and rate-limited', () => {
    expect(config).toContain('[functions.school-registration-intake]')
    expect(config).toMatch(
      /\[functions\.school-registration-intake\]\s*\nverify_jwt = false/,
    )
    expect(edge).toContain('rate_limited')
    expect(edge).toContain('MAX_SUBMISSIONS_PER_EMAIL_HOUR')
    expect(edge).toContain('MAX_SUBMISSIONS_PER_SYMBOL_HOUR')
  })
})

describe('school registration Phase 1A — pre-deploy hardening', () => {
  const edge = read('supabase/functions/school-registration-intake/index.ts')
  const eventsMigration = read(
    'supabase/migrations/20250816020000_school_registration_intake_events.sql',
  )
  const vercel = read('vercel.json')
  const service = read('src/services/schoolRegistration.ts')
  const migration = read(
    'supabase/migrations/20250816010000_school_registrations_phase1.sql',
  )
  const managerPage = read('src/pages/ManagerDashboardPage.tsx')
  const adminPage = read('src/pages/PlatformAdminDashboardPage.tsx')

  it('ships Vercel SPA rewrite so GET /register-school serves index.html', () => {
    const config = JSON.parse(vercel) as {
      rewrites?: Array<{ source: string; destination: string }>
    }
    expect(Array.isArray(config.rewrites)).toBe(true)
    expect(config.rewrites?.some((r) => r.destination === '/index.html')).toBe(
      true,
    )
    expect(vercel).not.toContain('localhost')
    expect(vercel).toContain('/(.*)')
  })

  it('rejects oversized bodies before unrestricted JSON processing', () => {
    expect(edge).toContain('MAX_BODY_BYTES')
    expect(edge).toContain('payload_too_large')
    expect(edge).toContain('413')
    expect(edge).toContain('content-length')
    expect(edge).toContain('req.text()')
    expect(edge.indexOf('MAX_BODY_BYTES')).toBeLessThan(edge.indexOf('JSON.parse'))
  })

  it('applies IP abuse limiting with email and symbol limits', () => {
    expect(edge).toContain('MAX_SUBMISSIONS_PER_IP_HOUR')
    expect(edge).toContain('MAX_SUBMISSIONS_PER_EMAIL_HOUR')
    expect(edge).toContain('MAX_SUBMISSIONS_PER_SYMBOL_HOUR')
    expect(edge).toContain('school_registration_intake_events')
    expect(edge).toContain('resolveClientIp')
    expect(edge).toContain('cf-connecting-ip')
    expect(edge).toContain('x-forwarded-for')
    expect(edge).toContain('hashIp')
    expect(eventsMigration).toContain('CREATE TABLE public.school_registration_intake_events')
    expect(eventsMigration).toContain(
      'REVOKE ALL ON TABLE public.school_registration_intake_events FROM anon',
    )
    expect(eventsMigration).toContain(
      'REVOKE ALL ON TABLE public.school_registration_intake_events FROM authenticated',
    )
  })

  it('public success response does not reveal duplicate state', () => {
    expect(edge).not.toContain('possibleDuplicate')
    expect(edge).toMatch(/return jsonResponse\(\{\s*ok:\s*true\s*\}\)/)
    expect(service).not.toContain('possibleDuplicate')
  })

  it('keeps internal-field rejection and forced status new', () => {
    expect(edge).toContain('invalid_fields')
    expect(edge).toContain("'converted_institution_id'")
    expect(edge).toContain("status: 'new'")
  })

  it('keeps Platform Admin RPC access and tenant isolation', () => {
    expect(migration).toContain('platform_admin_require_active')
    expect(adminPage).toContain('PlatformAdminRegistrationsSection')
    expect(managerPage).not.toContain('PlatformAdminRegistrationsSection')
    expect(service).toContain('platform_admin_list_school_registrations')
  })
})
