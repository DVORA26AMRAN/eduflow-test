import { useEffect, useRef, type ReactNode } from 'react'

type DashboardSectionPanelProps = {
  sectionId: string
  activeSectionId: string
  children: ReactNode
  className?: string
  id?: string
}

export function DashboardSectionPanel({
  sectionId,
  activeSectionId,
  children,
  className,
  id,
}: DashboardSectionPanelProps) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (sectionId !== activeSectionId) {
      return
    }

    requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true })
    })
  }, [activeSectionId, sectionId])

  if (sectionId !== activeSectionId) {
    return null
  }

  return (
    <section
      ref={panelRef}
      id={id}
      data-section-id={sectionId}
      className={className}
      tabIndex={-1}
    >
      {children}
    </section>
  )
}
