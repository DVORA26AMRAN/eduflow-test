import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INSTALLED_APP_ENTRY_PATH,
  isInstalledAppEntryPath,
  shouldHoldInstalledAppLoginEntry,
} from '../pwa/installedAppEntry'
import { isStandaloneDisplayMode } from '../pwa/displayMode'
import { INSTALL_LABEL } from '../pwa/InstallMpexButton'

const root = process.cwd()

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('MPEX PWA Phase P1 — installable application guards', () => {
  it('ships a valid web app manifest named MPEX with standalone display', () => {
    const raw = read('public/manifest.webmanifest')
    const manifest = JSON.parse(raw) as {
      name: string
      short_name: string
      display: string
      start_url: string
      scope: string
      icons: Array<{ src: string; sizes: string; purpose?: string }>
    }
    expect(manifest.name).toBe('MPEX')
    expect(manifest.short_name).toBe('MPEX')
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe(INSTALLED_APP_ENTRY_PATH)
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true)
    expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true)
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('declares required icon files on disk', () => {
    for (const file of [
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/icon-512-maskable.png',
      'public/icons/apple-touch-icon.png',
      'public/icons/favicon-32.png',
      'public/icons/favicon-48.png',
    ]) {
      expect(existsSync(resolve(root, file))).toBe(true)
    }
  })

  it('installed start URL targets login entry behavior without session wipe', () => {
    expect(INSTALLED_APP_ENTRY_PATH).toBe('/app')
    expect(isInstalledAppEntryPath('/app')).toBe(true)
    expect(isInstalledAppEntryPath('/app/')).toBe(true)
    expect(isInstalledAppEntryPath('/')).toBe(false)
    expect(shouldHoldInstalledAppLoginEntry('/app')).toBe(true)
    expect(shouldHoldInstalledAppLoginEntry('/')).toBe(false)

    const app = read('src/App.tsx')
    expect(app).toContain('holdInstalledLoginEntryRef')
    expect(app).toContain('consumeInstalledAppLoginEntry')
    expect(app).toContain('session preserved')
    expect(app).not.toMatch(/holdInstalledLoginEntryRef[\s\S]{0,200}signOut\(/)
  })

  it('exposes shared התקנת MPEX on login and authenticated header', () => {
    const login = read('src/pages/LoginPage.tsx')
    const header = read('src/components/dashboard/DashboardTopHeader.tsx')
    const installBtn = read('src/pwa/InstallMpexButton.tsx')
    const hook = read('src/pwa/useMpexInstall.ts')

    expect(INSTALL_LABEL).toBe('התקנת MPEX')
    expect(login).toContain("from '../pwa/InstallMpexButton'")
    expect(login).toContain('<InstallMpexButton variant="login" />')
    expect(header).toContain("from '../../pwa/InstallMpexButton'")
    expect(header).toContain('<InstallMpexButton variant="header" />')
    expect(installBtn).toContain('useMpexInstall')
    expect(hook).toContain('beforeinstallprompt')
    expect(hook).toContain('promptEvent.prompt()')
    expect(hook).toContain('isStandaloneDisplayMode')
  })

  it('handles browser install only from explicit user action and has iOS instructions', () => {
    const hook = read('src/pwa/useMpexInstall.ts')
    const button = read('src/pwa/InstallMpexButton.tsx')
    expect(hook).toContain('await promptEvent.prompt()')
    expect(hook).toContain('const install = useCallback(async () => {')
    expect(button).toContain('void install()')
    expect(button).toContain('הוספת MPEX למסך הבית')
    expect(button).toContain('הוסף למסך הבית')
    expect(button).not.toMatch(/\bPWA\b/)
    expect(button).not.toMatch(/service worker/i)
  })

  it('detects installed/standalone mode helper', () => {
    expect(typeof isStandaloneDisplayMode()).toBe('boolean')
    const display = read('src/pwa/displayMode.ts')
    expect(display).toContain("display-mode: standalone")
    expect(display).toContain('standalone')
  })

  it('service worker refuses to cache Supabase/auth/tenant API traffic', () => {
    const sw = read('public/sw.js')
    expect(sw).toContain("CACHE_VERSION = 'mpex-static-v2'")
    expect(sw).toContain('isSensitiveRequest')
    expect(sw).toContain('.supabase.co')
    expect(sw).toContain('/auth/v1')
    expect(sw).toContain('/rest/v1')
    expect(sw).toContain('/storage/v1')
    expect(sw).toContain('/realtime/v1')
    expect(sw).toContain('/functions/v1')
    expect(sw).toContain("pathname.startsWith('/api/')")
    expect(sw).toContain('Authorization')
    expect(sw).toContain('skipWaiting')
    // HTML / navigations must not be precached or served from cache
    expect(sw).not.toMatch(/PRECACHE_URLS = \[[^\]]*['"]\/['"]/)
    expect(sw).not.toMatch(/PRECACHE_URLS = \[[^\]]*['"]\/app['"]/)
    expect(sw).toContain("request.mode === 'navigate'")
    expect(sw).toContain("request.destination === 'document'")
    // Must not intentionally cache API responses
    expect(sw).not.toMatch(/cache\.put\([^)]*supabase/i)
    expect(sw).not.toMatch(/caches\.open\([^)]*api/i)
  })

  it('index.html wires manifest, theme, and apple touch icon', () => {
    const html = read('index.html')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('theme-color')
    expect(html).toContain('#7658d4')
    expect(html).toContain('apple-touch-icon')
    expect(html).toContain('/icons/apple-touch-icon.png')
    expect(html).toContain('apple-mobile-web-app-capable')
  })

  it('registers the service worker from main entry in production only', () => {
    const main = read('src/main.tsx')
    const reg = read('src/pwa/registerServiceWorker.ts')
    expect(main).toContain('registerMpexServiceWorker')
    expect(reg).toContain("register('/sw.js'")
    expect(reg).toContain('import.meta.env.PROD')
  })
})
