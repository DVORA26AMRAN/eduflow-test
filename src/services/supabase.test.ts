import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('supabase client configuration', () => {
  it('is unchanged by remembered-email UI updates', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/supabase.ts'), 'utf8')

    expect(source).toContain('createClient(supabaseUrl, supabaseAnonKey)')
    expect(source).not.toMatch(/auth\s*:\s*{/)
    expect(source).not.toMatch(/persistSession/)
    expect(source).not.toMatch(/sessionStorage/)
  })
})
