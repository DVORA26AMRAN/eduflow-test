import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestType } from '../../types/request'
import { TEACHER_REQUEST_CATEGORIES } from '../../utils/requests'
import { TeacherRequestCategorySelector } from './TeacherRequestCategorySelector'

vi.mock('../dashboard/dashboardNav', () => ({
  NavCalendarIcon: () => <svg data-testid="nav-calendar-icon" aria-hidden="true" />,
  NavPackageIcon: () => <svg data-testid="nav-package-icon" aria-hidden="true" />,
  NavEnvelopeIcon: () => <svg data-testid="nav-envelope-icon" aria-hidden="true" />,
}))

const CATEGORY_ICON_TEST_IDS = {
  absence: 'nav-calendar-icon',
  budget_or_equipment: 'nav-package-icon',
  general_request: 'nav-envelope-icon',
} as const

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}]/u

afterEach(() => {
  cleanup()
})

function renderSelector(selectedType: RequestType | '' = '') {
  const onSelect = vi.fn()

  render(
    <div dir="rtl">
      <TeacherRequestCategorySelector
        selectedType={selectedType}
        isDisabled={false}
        onSelect={onSelect}
      />
    </div>,
  )

  return { onSelect }
}

function renderControlledSelector() {
  function ControlledSelector() {
    const [selectedType, setSelectedType] = useState<RequestType | ''>('')

    return (
      <TeacherRequestCategorySelector
        selectedType={selectedType}
        isDisabled={false}
        onSelect={setSelectedType}
      />
    )
  }

  render(
    <div dir="rtl">
      <ControlledSelector />
    </div>,
  )
}

describe('TeacherRequestCategorySelector icons', () => {
  it('does not render emoji or colorful text icons', () => {
    renderSelector()

    const iconContainers = document.querySelectorAll('.teacher-dashboard__category-icon')
    expect(iconContainers).toHaveLength(TEACHER_REQUEST_CATEGORIES.length)

    for (const iconContainer of iconContainers) {
      expect(iconContainer.textContent).not.toMatch(EMOJI_PATTERN)
      expect(iconContainer.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('renders navigation-style line icons for every request category card', () => {
    renderSelector()

    const categoryCards = screen.getAllByRole('radio')
    expect(categoryCards).toHaveLength(TEACHER_REQUEST_CATEGORIES.length)

    for (const card of categoryCards) {
      const svg = card.querySelector('svg[aria-hidden="true"]')
      expect(svg).not.toBeNull()
      expect(svg?.tagName.toLowerCase()).toBe('svg')
    }
  })

  it('maps each category to the correct navigation icon component', () => {
    renderSelector()

    for (const category of TEACHER_REQUEST_CATEGORIES) {
      const card = screen.getByRole('radio', { name: new RegExp(category.title) })
      expect(
        within(card).getByTestId(CATEGORY_ICON_TEST_IDS[category.value]),
      ).toBeInTheDocument()
    }
  })

  it('keeps category titles and descriptions unchanged', () => {
    renderSelector()

    for (const category of TEACHER_REQUEST_CATEGORIES) {
      const card = screen.getByRole('radio', { name: new RegExp(category.title) })
      expect(within(card).getByText(category.title)).toBeInTheDocument()
      expect(within(card).getByText(category.description)).toBeInTheDocument()
    }
  })

  it('preserves keyboard selection behavior', async () => {
    const user = userEvent.setup()
    renderControlledSelector()

    const absenceCard = screen.getByRole('radio', { name: /היעדרויות/ })
    absenceCard.focus()
    expect(absenceCard).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(absenceCard).toHaveAttribute('aria-checked', 'true')
  })
})

describe('TeacherRequestCategorySelector icon dependencies', () => {
  it('does not add a new icon library dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    const iconLibraries = [
      'react-icons',
      '@heroicons/react',
      'lucide-react',
      '@tabler/icons-react',
      'phosphor-react',
    ]

    for (const library of iconLibraries) {
      expect(
        packageJson.dependencies?.[library] ?? packageJson.devDependencies?.[library],
      ).toBeUndefined()
    }
  })
})
