import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ManagerPersonalArchivedRequest,
  ManagerPersonalArchiveFilters,
} from '../../types/managerPersonalArchive'
import type { ReminderNavigationIntent } from '../../types/reminderNavigation'
import type { RequestDetailsManagerRequest } from '../../types/requestDetails'
import { loadManagerPersonalArchivedRequests } from '../../services/managerPersonalArchive'
import { MANAGER_PERSONAL_ARCHIVE_PAGE_SIZE } from '../../services/reminderRequestLocation'
import { filterManagerPersonalArchivedRequests, translateRequestType } from '../../utils/requests'
import {
  MANAGER_ARCHIVE_DEFAULT_FILTERS,
  shouldResetArchiveFilters,
} from '../../utils/reminderNavigation'
import { useRequestReminderNavigationEffect } from '../../hooks/useRequestReminderNavigationEffect'
import { NavArchiveIcon } from '../dashboard/dashboardNav'
import { DashboardSection } from '../dashboard/DashboardSection'
import { SecretaryArchiveFilters as ManagerArchiveFiltersPanel } from '../secretary/SecretaryArchiveFilters'
import { SecretaryArchiveTable } from '../secretary/SecretaryArchiveTable'
import { RequestDetailsModal } from '../requests/RequestDetailsModal'

const defaultFilters = MANAGER_ARCHIVE_DEFAULT_FILTERS

const ARCHIVE_PAGE_SIZE = MANAGER_PERSONAL_ARCHIVE_PAGE_SIZE

type ManagerArchiveSectionProps = {
  refreshToken: number
  unreadMessageRequestIds?: ReadonlySet<string>
  requestIdsWithMessages?: ReadonlySet<string>
  onConversationOpened?: (requestId: string) => void | Promise<boolean>
  reminderNavigationIntent?: ReminderNavigationIntent | null
  onReminderNavigationComplete?: (token: number, found: boolean) => void
}

export function ManagerArchiveSection({
  refreshToken,
  unreadMessageRequestIds = new Set(),
  requestIdsWithMessages = new Set(),
  onConversationOpened,
  reminderNavigationIntent = null,
  onReminderNavigationComplete,
}: ManagerArchiveSectionProps) {
  const [requests, setRequests] = useState<ManagerPersonalArchivedRequest[]>([])
  const [filters, setFilters] = useState<ManagerPersonalArchiveFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [detailsRequest, setDetailsRequest] = useState<RequestDetailsManagerRequest | null>(null)
  const [detailsReturnFocusElement, setDetailsReturnFocusElement] = useState<HTMLElement | null>(
    null,
  )

  const effectivePage =
    reminderNavigationIntent?.location.kind === 'manager_personal_archive'
      ? reminderNavigationIntent.location.page
      : page

  const fetchArchive = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadManagerPersonalArchivedRequests({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      page: effectivePage,
      pageSize: ARCHIVE_PAGE_SIZE,
    })

    if (!result.ok) {
      setRequests([])
      setTotalCount(0)
      setLoadError(result.errorMessage)
    } else {
      setRequests(result.requests)
      setTotalCount(result.totalCount)
    }

    setIsLoading(false)
  }, [filters.dateFrom, filters.dateTo, effectivePage])

  function handleFiltersChange(next: ManagerPersonalArchiveFilters) {
    const datesChanged =
      next.dateFrom !== filters.dateFrom || next.dateTo !== filters.dateTo

    if (datesChanged) {
      setPage(1)
    }

    setFilters(next)
  }

  useEffect(() => {
    queueMicrotask(() => {
      void fetchArchive()
    })
  }, [fetchArchive, refreshToken])

  const filteredRequests = useMemo(
    () => filterManagerPersonalArchivedRequests(requests, filters),
    [requests, filters],
  )

  const filteredRequestIds = useMemo(
    () => new Set(filteredRequests.map((request) => request.id)),
    [filteredRequests],
  )

  const handleReminderNavigationComplete = useCallback(
    (token: number, found: boolean) => {
      onReminderNavigationComplete?.(token, found)
    },
    [onReminderNavigationComplete],
  )

  const revealReminderRequest = useCallback(
    (requestId: string) => {
      if (shouldResetArchiveFilters(filters, requestId, requests, filteredRequestIds)) {
        setFilters(defaultFilters)
      }
    },
    [filters, requests, filteredRequestIds],
  )

  useRequestReminderNavigationEffect({
    intent: reminderNavigationIntent,
    expectedLocationKind: 'manager_personal_archive',
    isReady: !isLoading && !loadError,
    isRequestInDataset: (requestId) => requests.some((request) => request.id === requestId),
    isRequestVisible: (requestId) => filteredRequestIds.has(requestId),
    revealRequest: revealReminderRequest,
    onComplete: handleReminderNavigationComplete,
  })

  const totalPages = Math.max(1, Math.ceil(totalCount / ARCHIVE_PAGE_SIZE))
  const rangeStart = totalCount === 0 ? 0 : (effectivePage - 1) * ARCHIVE_PAGE_SIZE + 1
  const rangeEnd = Math.min(effectivePage * ARCHIVE_PAGE_SIZE, totalCount)
  const hasPreviousPage = effectivePage > 1
  const hasNextPage = effectivePage < totalPages

  const emptyMessage =
    totalCount === 0 ? 'אין בקשות בארכיון האישי שלך.' : 'לא נמצאו בקשות התואמות לסינון.'

  const handleOpenDetails = useCallback(
    (request: ManagerPersonalArchivedRequest, rowElement: HTMLTableRowElement) => {
      setDetailsReturnFocusElement(rowElement)
      setDetailsRequest({
        id: request.id,
        request_type: request.request_type,
        description: translateRequestType(request.request_type),
        status: request.status,
        created_at: request.created_at,
        teacher_full_name: request.teacher_full_name,
        role: 'manager',
      })
    },
    [],
  )

  const handleCloseDetails = useCallback(() => {
    setDetailsRequest(null)
  }, [])

  return (
    <section className="ds-card manager-dashboard__archive" aria-label="הארכיון שלי">
      <DashboardSection
        title="הארכיון שלי"
        icon={<NavArchiveIcon />}
        className="dashboard-section--flush-header"
      >
        <ManagerArchiveFiltersPanel filters={filters} onFiltersChange={handleFiltersChange} />

        {isLoading && <p className="manager-dashboard__insight-status">טוען ארכיון...</p>}

        {!isLoading && loadError && (
          <p className="manager-dashboard__insight-status ds-form-message ds-form-message--error">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && (
          <>
            <div className="manager-dashboard__archive-pagination-summary">
              {totalCount === 0 ? (
                <p className="manager-dashboard__insight-status">אין בקשות בארכיון האישי שלך.</p>
              ) : (
                <p className="manager-dashboard__insight-status">
                  מציגות {rangeStart}–{rangeEnd} מתוך {totalCount} בקשות (עמוד {effectivePage} מתוך{' '}
                  {totalPages})
                </p>
              )}
            </div>

            <SecretaryArchiveTable
              requests={filteredRequests}
              emptyMessage={emptyMessage}
              unreadMessageRequestIds={unreadMessageRequestIds}
              requestIdsWithMessages={requestIdsWithMessages}
              onOpenDetails={handleOpenDetails}
            />

            {totalCount > 0 && (
              <div className="manager-dashboard__archive-pagination">
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setPage((currentPage) => currentPage - 1)}
                  disabled={!hasPreviousPage || isLoading}
                >
                  הקודם
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary"
                  onClick={() => setPage((currentPage) => currentPage + 1)}
                  disabled={!hasNextPage || isLoading}
                >
                  הבא
                </button>
              </div>
            )}
          </>
        )}
      </DashboardSection>

      {detailsRequest && (
        <RequestDetailsModal
          isOpen
          request={detailsRequest}
          returnFocusElement={detailsReturnFocusElement}
          onConversationOpened={() => void onConversationOpened?.(detailsRequest.id)}
          onClose={handleCloseDetails}
          showNotes={false}
        />
      )}
    </section>
  )
}
