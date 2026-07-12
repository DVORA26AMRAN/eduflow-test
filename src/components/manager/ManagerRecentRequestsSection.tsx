import { useCallback, useEffect, useState } from 'react'
import type { ManagerRecentRequest } from '../../types/analytics'
import { loadRecentRequests } from '../../services/analytics'
import { archiveRequestForManager } from '../../services/managerPersonalArchive'
import { NavClipboardIcon } from '../dashboard/dashboardNav'
import { DashboardCollapsibleSection } from '../dashboard/DashboardCollapsibleSection'
import { ManagerRecentRequestsTable } from './ManagerRecentRequestsTable'

type ManagerRecentRequestsSectionProps = {
  refreshToken: number
  onArchived: () => void
}

export function ManagerRecentRequestsSection({
  refreshToken,
  onArchived,
}: ManagerRecentRequestsSectionProps) {
  const [requests, setRequests] = useState<ManagerRecentRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)
  const [archivingRequestId, setArchivingRequestId] = useState<string | null>(null)
  const [archiveDialogRequest, setArchiveDialogRequest] = useState<ManagerRecentRequest | null>(
    null,
  )

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const result = await loadRecentRequests()

    if (!result.ok) {
      setRequests([])
      setErrorMessage(result.errorMessage)
    } else {
      setRequests(result.requests)
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRequests()
    })
  }, [fetchRequests, refreshToken])

  function handleOpenArchiveDialog(request: ManagerRecentRequest) {
    setStatusMessage('')
    setArchiveDialogRequest(request)
  }

  function handleCloseArchiveDialog() {
    if (archivingRequestId !== null) {
      return
    }
    setArchiveDialogRequest(null)
  }

  async function handleConfirmArchive() {
    if (!archiveDialogRequest || archivingRequestId !== null) {
      return
    }

    setStatusMessage('')
    setArchivingRequestId(archiveDialogRequest.id)

    const result = await archiveRequestForManager(archiveDialogRequest.id)

    setArchivingRequestId(null)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      setArchiveDialogRequest(null)
      return
    }

    setRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== archiveDialogRequest.id),
    )
    setStatusMessage('הבקשה הועברה לארכיון האישי שלך.')
    setStatusMessageIsError(false)
    setArchiveDialogRequest(null)
    onArchived()
  }

  return (
    <section className="ds-card manager-dashboard__insight-card" aria-label="בקשות אחרונות">
      <DashboardCollapsibleSection
        title="בקשות אחרונות"
        icon={<NavClipboardIcon />}
        className="dashboard-collapsible-section--flush-header"
      >
        {statusMessage && (
          <p
            className={
              statusMessageIsError
                ? 'ds-form-message ds-form-message--error manager-dashboard__insight-status'
                : 'ds-form-message ds-form-message--success manager-dashboard__insight-status'
            }
          >
            {statusMessage}
          </p>
        )}

        {isLoading && <p className="manager-dashboard__insight-status">טוען נתונים...</p>}

        {!isLoading && errorMessage && (
          <p className="manager-dashboard__insight-status ds-form-message ds-form-message--error">
            {errorMessage}
          </p>
        )}

        {!isLoading && !errorMessage && requests.length === 0 && (
          <p className="manager-dashboard__insight-status">אין בקשות להצגה.</p>
        )}

        {!isLoading && !errorMessage && requests.length > 0 && (
          <ManagerRecentRequestsTable
            requests={requests}
            archivingRequestId={archivingRequestId}
            onArchive={handleOpenArchiveDialog}
          />
        )}
      </DashboardCollapsibleSection>

      {archiveDialogRequest && (
        <div
          className="manager-dashboard__archive-confirm-overlay"
          onClick={handleCloseArchiveDialog}
          role="presentation"
        >
          <div
            className="manager-dashboard__archive-confirm-panel ds-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-archive-confirm-title"
          >
            <h3 id="manager-archive-confirm-title" className="manager-dashboard__section-title">
              להעביר לארכיון האישי?
            </h3>
            <p className="ds-form-message">
              הבקשה תוסר מתצוגת הבקשות הפעילות שלך בלבד ותופיע ב&quot;הארכיון שלי&quot;.
              הבקשה תישאר פעילה עבור שאר המשתמשים במערכת.
            </p>
            <div className="manager-dashboard__archive-confirm-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                onClick={handleCloseArchiveDialog}
                disabled={archivingRequestId !== null}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={handleConfirmArchive}
                disabled={archivingRequestId !== null}
              >
                {archivingRequestId !== null ? 'מעביר...' : 'כן, להעביר לארכיון'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
