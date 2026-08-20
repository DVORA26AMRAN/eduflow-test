import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagementJournalPage, ManagementJournalTask } from '../../types/managementJournal'
import {
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_EMPTY_LABEL,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_GENERATING_LABEL,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_HINT,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_LABEL,
  MANAGEMENT_JOURNAL_STATUS_LABELS,
} from '../../utils/managementJournalDisplay'

const { downloadPdfMock } = vi.hoisted(() => ({
  downloadPdfMock: vi.fn(),
}))

vi.mock('../../services/managementJournal', () => ({
  downloadManagementJournalDailySummaryPdf: downloadPdfMock,
}))

import { ManagementJournalDailySummary } from './ManagementJournalDailySummary'

const page: ManagementJournalPage = {
  id: 'shared-1',
  institutionId: 'inst-1',
  journalDate: '2026-08-19',
  pageType: 'shared',
  ownerUserId: 'mgr-1',
  createdByUserId: 'mgr-1',
  createdAt: '2026-08-19T07:00:00.000Z',
  updatedAt: '2026-08-19T07:00:00.000Z',
}

const participants = [
  {
    pageId: 'shared-1',
    userId: 'mgr-1',
    addedByUserId: null,
    addedAutomatically: true,
    addedAt: '2026-08-19T07:00:00.000Z',
    fullName: 'מנהלת כהן',
    primaryRole: 'institution_manager' as const,
    status: 'active',
  },
  {
    pageId: 'shared-1',
    userId: 'sec-1',
    addedByUserId: 'mgr-1',
    addedAutomatically: false,
    addedAt: '2026-08-19T07:00:00.000Z',
    fullName: 'מזכירה לוי',
    primaryRole: 'secretary' as const,
    status: 'active',
  },
]

function task(
  overrides: Partial<ManagementJournalTask> &
    Pick<ManagementJournalTask, 'id' | 'title' | 'status' | 'sortOrder'>,
): ManagementJournalTask {
  return {
    pageId: 'shared-1',
    institutionId: 'inst-1',
    details: 'סוד הנחיות',
    note: 'סוד הערה',
    targetTime: '09:30:00',
    responsibleUserId: 'sec-1',
    createdByUserId: 'mgr-1',
    createdAt: '2026-08-19T07:00:00.000Z',
    updatedAt: '2026-08-19T07:00:00.000Z',
    originTaskId: null,
    originPageId: null,
    carriedForward: false,
    ...overrides,
  }
}

describe('ManagementJournalDailySummary J3A/J3B', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    downloadPdfMock.mockReset()
  })

  it('renders every task once as title + status only, preserving sort_order', () => {
    const tasks = [
      task({ id: 't3', title: 'שלישית', status: 'blocked', sortOrder: 3 }),
      task({ id: 't1', title: 'ראשונה', status: 'new', sortOrder: 1 }),
      task({ id: 't2', title: 'שנייה', status: 'completed', sortOrder: 2 }),
    ]

    render(
      <ManagementJournalDailySummary
        isOpen
        page={page}
        participants={participants}
        tasks={tasks}
        onClose={() => undefined}
      />,
    )

    const summary = screen.getByTestId('journal-daily-summary')
    expect(within(summary).getByText('סיכום יומי')).toBeInTheDocument()
    expect(screen.getByTestId('journal-daily-summary-page-type')).toHaveTextContent('דף משותף')
    expect(screen.getByTestId('journal-daily-summary-participants')).toHaveTextContent('מנהלת כהן')
    expect(screen.getByTestId('journal-daily-summary-participants')).toHaveTextContent('מזכירה לוי')

    const rows = within(screen.getByTestId('journal-daily-summary-table')).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      `ראשונה${MANAGEMENT_JOURNAL_STATUS_LABELS.new}`,
      `שנייה${MANAGEMENT_JOURNAL_STATUS_LABELS.completed}`,
      `שלישית${MANAGEMENT_JOURNAL_STATUS_LABELS.blocked}`,
    ])

    expect(summary).not.toHaveTextContent('סוד הנחיות')
    expect(summary).not.toHaveTextContent('סוד הערה')
    expect(summary).not.toHaveTextContent('09:30')
    expect(summary).not.toHaveTextContent('sec-1')
    expect(screen.queryByLabelText('סטטוס משימה')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('הערת טיפול')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הוספת משימה' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-reassign')).not.toBeInTheDocument()
  })

  it('maps exact Hebrew statuses and shows empty state without fabricating rows', () => {
    const { rerender } = render(
      <ManagementJournalDailySummary
        isOpen
        page={{ ...page, pageType: 'personal' }}
        participants={[]}
        tasks={[
          task({ id: 'a', title: 'א', status: 'new', sortOrder: 1 }),
          task({ id: 'b', title: 'ב', status: 'in_progress', sortOrder: 2 }),
          task({ id: 'c', title: 'ג', status: 'completed', sortOrder: 3 }),
          task({ id: 'd', title: 'ד', status: 'blocked', sortOrder: 4 }),
        ]}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByTestId('journal-daily-summary-status-a')).toHaveTextContent('חדש')
    expect(screen.getByTestId('journal-daily-summary-status-b')).toHaveTextContent('בטיפול')
    expect(screen.getByTestId('journal-daily-summary-status-c')).toHaveTextContent('הושלם')
    expect(screen.getByTestId('journal-daily-summary-status-d')).toHaveTextContent('חסום')
    expect(screen.getByTestId('journal-daily-summary-page-type')).toHaveTextContent('דף אישי')
    expect(screen.queryByTestId('journal-daily-summary-participants')).not.toBeInTheDocument()

    rerender(
      <ManagementJournalDailySummary
        isOpen
        page={page}
        participants={participants}
        tasks={[]}
        onClose={() => undefined}
      />,
    )
    expect(screen.getByTestId('journal-daily-summary-empty')).toHaveTextContent(
      MANAGEMENT_JOURNAL_DAILY_SUMMARY_EMPTY_LABEL,
    )
    expect(screen.queryByTestId('journal-daily-summary-table')).not.toBeInTheDocument()
  })

  it('requests PDF by page id, prevents duplicate submit, and keeps summary open on error', async () => {
    const user = userEvent.setup({ delay: null })
    const onClose = vi.fn()
    let resolveDownload: ((value: { ok: false; errorMessage: string }) => void) | null = null
    downloadPdfMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        }),
    )

    render(
      <ManagementJournalDailySummary
        isOpen
        page={page}
        participants={participants}
        tasks={[task({ id: 't1', title: 'משימה', status: 'new', sortOrder: 1 })]}
        onClose={onClose}
      />,
    )

    const pdf = screen.getByTestId('journal-daily-summary-pdf')
    expect(pdf).not.toBeDisabled()
    expect(pdf).toHaveTextContent(MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_LABEL)
    expect(pdf).toHaveAttribute('title', MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_HINT)

    await user.click(pdf)
    expect(pdf).toBeDisabled()
    expect(pdf).toHaveTextContent(MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_GENERATING_LABEL)
    await user.click(pdf)
    expect(downloadPdfMock).toHaveBeenCalledTimes(1)
    expect(downloadPdfMock).toHaveBeenCalledWith('shared-1')

    resolveDownload?.({ ok: false, errorMessage: 'לא ניתן להפיק את קובץ ה־PDF כרגע.' })
    expect(await screen.findByTestId('journal-daily-summary-pdf-error')).toHaveTextContent(
      'לא ניתן להפיק את קובץ ה־PDF כרגע.',
    )
    expect(screen.getByTestId('journal-daily-summary')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses a mobile-safe document layout contract', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/managementJournal/ManagementJournalDailySummary.css'),
      'utf8',
    )
    expect(css).toContain('max-width: 100%')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('table-layout: fixed')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('@media (max-width: 480px)')
    expect(css).toContain('@media (max-width: 768px)')
    expect(css).toContain('journal-daily-summary__table-wrap')
    expect(css).toContain('min-height: 44px')
    expect(css).not.toContain('overflow-x: hidden')
  })

  it('renders status pills with semantic status class names', () => {
    render(
      <ManagementJournalDailySummary
        isOpen
        page={page}
        participants={participants}
        tasks={[
          task({ id: 't-new', title: 'א', status: 'new', sortOrder: 1 }),
          task({ id: 't-prog', title: 'ב', status: 'in_progress', sortOrder: 2 }),
          task({ id: 't-done', title: 'ג', status: 'completed', sortOrder: 3 }),
          task({ id: 't-block', title: 'ד', status: 'blocked', sortOrder: 4 }),
        ]}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByTestId('journal-daily-summary-status-t-new')).toHaveClass(
      'journal-daily-summary__status--new',
    )
    expect(screen.getByTestId('journal-daily-summary-status-t-prog')).toHaveClass(
      'journal-daily-summary__status--in_progress',
    )
    expect(screen.getByTestId('journal-daily-summary-status-t-done')).toHaveClass(
      'journal-daily-summary__status--completed',
    )
    expect(screen.getByTestId('journal-daily-summary-status-t-block')).toHaveClass(
      'journal-daily-summary__status--blocked',
    )
    expect(screen.getByTestId('journal-daily-summary-pdf')).toHaveClass('ds-btn')
  })
})
