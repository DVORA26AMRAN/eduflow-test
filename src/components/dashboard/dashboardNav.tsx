import type { ReactNode } from 'react'

export type DashboardNavItem = {
  id: string
  label: string
  icon: ReactNode
}

function iconStroke() {
  return {
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
}

export function NavBellIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a5 5 0 0 1 5 5v3.2l1.7 2.1v1.2H5.3v-1.2L7 12.2V9a5 5 0 0 1 5-5Z" {...stroke} />
      <path d="M10 18.3a2.2 2.2 0 0 0 4 0" {...stroke} />
    </svg>
  )
}

export function NavClipboardIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="12" height="15" rx="2" {...stroke} />
      <path d="M9 5.5h6M10 9.5h4M9.5 13h5M9.5 16.5h5" {...stroke} />
    </svg>
  )
}

export function NavUsersIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="2.6" {...stroke} />
      <circle cx="15.2" cy="9.2" r="2.2" {...stroke} />
      <path d="M4.8 18c.7-2.7 2.4-4 4.9-4s4.2 1.3 4.9 4" {...stroke} />
      <path d="M14.2 17.5c.4-1.8 1.5-2.8 3.2-2.8s2.8 1 3.2 2.8" {...stroke} />
    </svg>
  )
}

export function NavInboxIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 8.8 7 5h10l2.5 3.8V19H4.5Z" {...stroke} />
      <path d="M4.5 12h4l1.2 2h4.6l1.2-2h4" {...stroke} />
    </svg>
  )
}

export function NavChartIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V6M12 19V9M19 19V12" {...stroke} />
      <path d="M4 19h16" {...stroke} />
    </svg>
  )
}

export function NavActivityIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 12h4l2-4.5 3.5 9 2.2-5H20.5" {...stroke} />
    </svg>
  )
}

export function NavArchiveIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 7.5h15v11.5a1.5 1.5 0 0 1-1.5 1.5h-12a1.5 1.5 0 0 1-1.5-1.5Z" {...stroke} />
      <path d="M4 5.5h16v2H4Z" {...stroke} />
      <path d="M10 12.5h4" {...stroke} />
    </svg>
  )
}

export function NavCalendarIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="5.5" width="15" height="14" rx="2" {...stroke} />
      <path d="M8 3.8v3.2M16 3.8v3.2M4.5 10h15" {...stroke} />
      <path d="M8.5 14h2M13.5 14h2M8.5 17h2" {...stroke} />
    </svg>
  )
}

export function NavPackageIcon() {
  const stroke = iconStroke()
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 8.2 12 4.5l7.2 3.7v7.6L12 19.5 4.8 15.8Z" {...stroke} />
      <path d="M12 12.2V19.5M4.8 8.2 12 12.2l7.2-4" {...stroke} />
    </svg>
  )
}
