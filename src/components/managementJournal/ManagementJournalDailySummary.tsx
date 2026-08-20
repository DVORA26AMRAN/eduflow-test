import { Modal } from '../ui/Modal'
import type {
  ManagementJournalPage,
  ManagementJournalParticipant,
  ManagementJournalTask,
} from '../../types/managementJournal'
import {
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_EMPTY_LABEL,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_HINT,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_LABEL,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_STATUS_COLUMN,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_TASK_COLUMN,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_TITLE,
  formatManagementJournalHebrewDate,
  sortManagementJournalTasks,
  translateManagementJournalPageType,
  translateManagementJournalTaskStatus,
} from '../../utils/managementJournalDisplay'
import './ManagementJournalDailySummary.css'

export type ManagementJournalDailySummaryProps = {
  isOpen: boolean
  page: ManagementJournalPage
  participants: ManagementJournalParticipant[]
  tasks: ManagementJournalTask[]
  onClose: () => void
}

export function ManagementJournalDailySummary({
  isOpen,
  page,
  participants,
  tasks,
  onClose,
}: ManagementJournalDailySummaryProps) {
  const orderedTasks = sortManagementJournalTasks(tasks)
  const hebrewDate = formatManagementJournalHebrewDate(page.journalDate)
  const pageTypeLabel = translateManagementJournalPageType(page.pageType)

  return (
    <Modal
      isOpen={isOpen}
      title={MANAGEMENT_JOURNAL_DAILY_SUMMARY_TITLE}
      onClose={onClose}
      closeLabel="סגירת דוח יומי"
      size="large"
    >
      <div
        className="journal-daily-summary"
        data-testid="journal-daily-summary"
        dir="rtl"
      >
        <header className="journal-daily-summary__header">
          <h3 className="journal-daily-summary__title">{MANAGEMENT_JOURNAL_DAILY_SUMMARY_TITLE}</h3>
          <p className="journal-daily-summary__date" data-testid="journal-daily-summary-date">
            {hebrewDate}
          </p>
          <p className="journal-daily-summary__date-key" data-testid="journal-daily-summary-date-key">
            {page.journalDate}
          </p>
          <p
            className={`journal-daily-summary__page-type journal-daily-summary__page-type--${page.pageType}`}
            data-testid="journal-daily-summary-page-type"
          >
            {pageTypeLabel}
          </p>
          {page.pageType === 'shared' ? (
            <ul
              className="journal-daily-summary__participants"
              aria-label="משתתפות הדף"
              data-testid="journal-daily-summary-participants"
            >
              {participants.map((participant) => (
                <li key={participant.userId}>{participant.fullName}</li>
              ))}
            </ul>
          ) : null}
        </header>

        {orderedTasks.length === 0 ? (
          <p className="journal-daily-summary__empty" data-testid="journal-daily-summary-empty">
            {MANAGEMENT_JOURNAL_DAILY_SUMMARY_EMPTY_LABEL}
          </p>
        ) : (
          <table className="journal-daily-summary__table" data-testid="journal-daily-summary-table">
            <thead>
              <tr>
                <th scope="col">{MANAGEMENT_JOURNAL_DAILY_SUMMARY_TASK_COLUMN}</th>
                <th scope="col">{MANAGEMENT_JOURNAL_DAILY_SUMMARY_STATUS_COLUMN}</th>
              </tr>
            </thead>
            <tbody>
              {orderedTasks.map((task) => (
                <tr key={task.id} data-testid={`journal-daily-summary-row-${task.id}`}>
                  <td className="journal-daily-summary__task-cell">{task.title}</td>
                  <td className="journal-daily-summary__status-cell">
                    <span
                      className={`journal-daily-summary__status journal-daily-summary__status--${task.status}`}
                      data-testid={`journal-daily-summary-status-${task.id}`}
                    >
                      {translateManagementJournalTaskStatus(task.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="journal-daily-summary__actions">
          <button
            type="button"
            className="journal-daily-summary__pdf"
            data-testid="journal-daily-summary-pdf"
            disabled
            title={MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_HINT}
            aria-disabled="true"
          >
            {MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_LABEL}
          </button>
          <p className="journal-daily-summary__pdf-hint">{MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_HINT}</p>
        </div>
      </div>
    </Modal>
  )
}
