import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { AuthenticatedUserProfile } from '../../types/user'
import { useBodyScrollLock } from '../../utils/bodyScrollLock'
import './DashboardShell.css'
import { DashboardTopHeader } from './DashboardTopHeader'
import type { DashboardNavItem } from './dashboardNav'

type DashboardShellProps = {
  roleLabel: string
  subtitle: string
  profile: AuthenticatedUserProfile
  navItems: DashboardNavItem[]
  activeSectionId: string
  onSectionSelect: (sectionId: string) => void
  onLogout: () => void
  children: ReactNode
}

const MOBILE_NAV_MEDIA_QUERY = '(max-width: 1024px)'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

function useIsMobileDashboardNav() {
  const [isMobileNav, setIsMobileNav] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQueryList = window.matchMedia(MOBILE_NAV_MEDIA_QUERY)
    function handleChange(event: MediaQueryListEvent) {
      setIsMobileNav(event.matches)
    }

    mediaQueryList.addEventListener('change', handleChange)
    return () => mediaQueryList.removeEventListener('change', handleChange)
  }, [])

  return isMobileNav
}

function useDrawerFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  restoreFocusRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!isActive || !containerRef.current) {
      return
    }

    const container = containerRef.current
    const previouslyFocused =
      restoreFocusRef.current ?? (document.activeElement as HTMLElement | null)
    const activeItem = container.querySelector<HTMLElement>(
      '.dashboard-shell__nav-item[aria-current="true"]',
    )
    const focusableElements = getFocusableElements(container)
    ;(activeItem ?? focusableElements[0])?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') {
        return
      }

      const elements = getFocusableElements(container)
      if (elements.length === 0) {
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [containerRef, isActive, restoreFocusRef])
}

function DashboardNavButtons({
  navItems,
  activeSectionId,
  onNavigate,
}: {
  navItems: DashboardNavItem[]
  activeSectionId: string
  onNavigate: (item: DashboardNavItem) => void
}) {
  return (
    <>
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            item.id === activeSectionId
              ? 'dashboard-shell__nav-item dashboard-shell__nav-item--active'
              : 'dashboard-shell__nav-item'
          }
          onClick={() => onNavigate(item)}
          aria-current={item.id === activeSectionId ? 'true' : undefined}
          aria-label={item.ariaLabel ?? item.label}
          disabled={item.disabled}
        >
          <span
            className={
              item.badgeAnimate
                ? 'dashboard-shell__nav-icon dashboard-shell__nav-icon--ringing'
                : 'dashboard-shell__nav-icon'
            }
            aria-hidden="true"
          >
            {item.icon}
          </span>
          <span className="dashboard-shell__nav-label">{item.label}</span>
          {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
            <span
              className="dashboard-shell__nav-badge"
              aria-label={`${item.badgeCount} תזכורות שלא נקראו`}
            >
              {item.badgeCount}
            </span>
          )}
        </button>
      ))}
    </>
  )
}

/**
 * Universal dashboard chrome for every role.
 * Mobile (<=1024px): menu button + section label + temporary vertical drawer.
 * Desktop (>1024px): sticky 272px sidebar. Do not reimplement role-specific nav.
 */
export function DashboardShell({
  roleLabel,
  subtitle,
  profile,
  navItems,
  activeSectionId,
  onSectionSelect,
  onLogout,
  children,
}: DashboardShellProps) {
  const isMobileNav = useIsMobileDashboardNav()
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const drawerTitleId = useId()
  const drawerPanelId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerPanelRef = useRef<HTMLElement>(null)

  const activeNavItem =
    navItems.find((item) => item.id === activeSectionId) ?? null
  const activeSectionLabel = activeNavItem?.label ?? roleLabel
  const isDrawerOpen = isMobileNav && isMobileNavOpen

  useBodyScrollLock(isDrawerOpen)
  useDrawerFocusTrap(drawerPanelRef, isDrawerOpen, menuButtonRef)

  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsMobileNavOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDrawerOpen])

  function closeMobileNav() {
    setIsMobileNavOpen(false)
  }

  function handleNavigate(item: DashboardNavItem) {
    if (item.onSelect) {
      item.onSelect()
    } else {
      onSectionSelect(item.id)
    }
    setIsMobileNavOpen(false)
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeMobileNav()
    }
  }

  const mobileDrawer =
    isDrawerOpen &&
    createPortal(
      <div
        className="dashboard-shell__drawer-backdrop"
        dir="rtl"
        onClick={handleBackdropClick}
        role="presentation"
      >
        <aside
          ref={drawerPanelRef}
          id={drawerPanelId}
          className="dashboard-shell__drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={drawerTitleId}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="dashboard-shell__drawer-header">
            <h2 id={drawerTitleId} className="dashboard-shell__drawer-title">
              תפריט ניווט
            </h2>
            <button
              type="button"
              className="dashboard-shell__drawer-close"
              onClick={closeMobileNav}
              aria-label="סגירת תפריט"
            >
              ×
            </button>
          </div>

          <p className="dashboard-shell__drawer-subtitle">{subtitle}</p>
          {profile.school ? (
            <p className="dashboard-shell__drawer-school">{profile.school.name}</p>
          ) : null}

          <nav
            className="dashboard-shell__nav dashboard-shell__nav--drawer"
            aria-label={`ניווט ${roleLabel}`}
          >
            <DashboardNavButtons
              navItems={navItems}
              activeSectionId={activeSectionId}
              onNavigate={handleNavigate}
            />
          </nav>
        </aside>
      </div>,
      document.body,
    )

  return (
    <main
      dir="rtl"
      className={`dashboard-shell dashboard-shell--${profile.role}${
        isMobileNav ? ' dashboard-shell--mobile-nav' : ''
      }`}
    >
      <DashboardTopHeader
        roleSubtitle={roleLabel}
        userDisplayName={profile.fullName}
        role={profile.role}
        school={profile.school}
        onLogout={onLogout}
      />

      {isMobileNav ? (
        <div className="dashboard-shell__mobile-nav-bar">
          <button
            ref={menuButtonRef}
            type="button"
            className="dashboard-shell__menu-button ds-btn ds-btn--secondary ds-btn--compact"
            aria-label="תפריט ניווט"
            aria-expanded={isMobileNavOpen}
            aria-controls={drawerPanelId}
            aria-haspopup="dialog"
            onClick={() => setIsMobileNavOpen(true)}
          >
            <span aria-hidden="true">☰</span>
            <span aria-hidden="true">תפריט</span>
          </button>
          <p className="dashboard-shell__mobile-section-label" aria-live="polite">
            {activeSectionLabel}
          </p>
        </div>
      ) : null}

      <div className="dashboard-shell__layout">
        {!isMobileNav ? (
          <aside className="dashboard-shell__sidebar" aria-label={`ניווט ${roleLabel}`}>
            <header className="dashboard-shell__brand">
              <p className="dashboard-shell__subtitle">{subtitle}</p>
              {profile.school ? (
                <p className="dashboard-shell__school-name">{profile.school.name}</p>
              ) : null}
            </header>

            <nav className="dashboard-shell__nav" aria-label="ניווט חלקים בדף">
              <DashboardNavButtons
                navItems={navItems}
                activeSectionId={activeSectionId}
                onNavigate={handleNavigate}
              />
            </nav>
          </aside>
        ) : null}

        <section className="dashboard-shell__content">{children}</section>
      </div>

      {mobileDrawer}
    </main>
  )
}
