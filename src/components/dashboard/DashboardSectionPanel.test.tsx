import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardSectionPanel } from './DashboardSectionPanel'

afterEach(() => {
  cleanup()
})

describe('DashboardSectionPanel', () => {
  it('renders only the active section', () => {
    const { rerender, container } = render(
      <>
        <DashboardSectionPanel sectionId="overview" activeSectionId="overview">
          <div>סקירה</div>
        </DashboardSectionPanel>
        <DashboardSectionPanel sectionId="requests" activeSectionId="overview">
          <div>בקשות</div>
        </DashboardSectionPanel>
      </>,
    )

    expect(screen.getByText('סקירה')).toBeInTheDocument()
    expect(screen.queryByText('בקשות')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-section-id]')).toHaveLength(1)

    rerender(
      <>
        <DashboardSectionPanel sectionId="overview" activeSectionId="requests">
          <div>סקירה</div>
        </DashboardSectionPanel>
        <DashboardSectionPanel sectionId="requests" activeSectionId="requests">
          <div>בקשות</div>
        </DashboardSectionPanel>
      </>,
    )

    expect(screen.queryByText('סקירה')).not.toBeInTheDocument()
    expect(screen.getByText('בקשות')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-section-id]')).toHaveLength(1)
  })

  it('focuses the active panel when the section changes', () => {
    render(
      <DashboardSectionPanel sectionId="overview" activeSectionId="overview">
        <div>סקירה</div>
      </DashboardSectionPanel>,
    )

    const panel = screen.getByText('סקירה').closest('section')
    expect(panel).toHaveAttribute('tabindex', '-1')
  })
})
