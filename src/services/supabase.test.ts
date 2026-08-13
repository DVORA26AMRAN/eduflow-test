import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('supabase client configuration', () => {
  it('keeps default client auth options and registers recovery listener', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/supabase.ts'), 'utf8')

    expect(source).toContain('createClient(supabaseUrl, supabaseAnonKey)')
    expect(source).toContain('PASSWORD_RECOVERY')
    expect(source).toContain('PENDING_RECOVERY_KEY')
    expect(source).not.toMatch(/auth\s*:\s*{/)
    expect(source).not.toMatch(/persistSession/)
  })
})
