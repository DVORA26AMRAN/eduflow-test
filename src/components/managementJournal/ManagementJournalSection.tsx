import { useCallback, useEffect, useMemo, useState } from 'react'
import { DashboardSection } from '../dashboard/DashboardSection'
import { NavNotebookIcon } from '../dashboard/dashboardNav'
import {
  addManagementJournalPageParticipant,
  assignManagementJournalTask,
  createManagementJournalTask,
  loadEligibleManagementJournalParticipants,
  loadManagementJournalCurrentDate,
  loadManagementJournalNewerPageExists,
  loadManagementJournalPageById,
  loadManagementJournalParticipants,
  loadManagementJournalTasks,
  loadTodayManagementJournalPage,
  openPersonalManagementJournalPage,
  openSharedManagementJournalPage,
  updateManagementJournalTaskContent,
  updateManagementJournalTaskNote,
  updateManagementJournalTaskStatus,
} from '../../services/managementJournal'
import {
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_BUTTON_LABEL,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_REFRESH_ERROR,
  MANAGEMENT_JOURNAL_EMPTY_TASKS_LABEL,
  MANAGEMENT_JOURNAL_FROZEN_LABEL,
  MANAGEMENT_JOURNAL_NAV_LABEL,
  canAddManagementJournalParticipantUi,
  canCreateManagementJournalTaskUi,
  canCreateSharedManagementJournalPageUi,
  formatManagementJournalHebrewDate,
  isManagementJournalPageReadOnly,
  sortManagementJournalTasks,
  translateManagementJournalPageType,
} from '../../utils/managementJournalDisplay'
import { translateRole } from '../../utils/roles'
import type {
  ManagementJournalCandidate,
  ManagementJournalErrorCode,
  ManagementJournalPage,
  ManagementJournalPageType,
  ManagementJournalParticipant,
  ManagementJournalTask,
  ManagementJournalTaskStatus,
} from '../../types/managementJournal'
import type { PrimaryRole } from '../../types/user'
import { ManagementJournalDailySummary } from './ManagementJournalDailySummary'
import { ManagementJournalTaskComposer } from './ManagementJournalTaskComposer'
import { ManagementJournalTaskRow } from './ManagementJournalTaskRow'
import './ManagementJournalSection.css'

type ManagementJournalSectionProps = {
  actorUserId: string
  actorFullName: string
  actorRole: PrimaryRole
  institutionId: string
}

type SharedAccessDenial = {
  visible: boolean
}

const PLACEHOLDER_ROW_COUNT = 8

export function ManagementJournalSection({
  actorUserId,
  actorFullName,
  actorRole,
  institutionId,
}: ManagementJournalSectionProps) {
  const canCreateShared = canCreateSharedManagementJournalPageUi(actorRole)
  const canAddParticipant = canAddManagementJournalParticipantUi(actorRole)

  const [journalDate, setJournalDate] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<ManagementJournalPageType>('personal')
  const [page, setPage] = useState<ManagementJournalPage | null>(null)
  const [participants, setParticipants] = useState<ManagementJournalParticipant[]>([])
  const [tasks, setTasks] = useState<ManagementJournalTask[]>([])
  const [candidates, setCandidates] = useState<ManagementJournalCandidate[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([actorUserId])
  const [userToAdd, setUserToAdd] = useState('')
  const [isBooting, setIsBooting] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [sharedDenial, setSharedDenial] = useState<SharedAccessDenial>({ visible: false })
  const [isPageFrozen, setIsPageFrozen] = useState(false)
  const [newerPageExists, setNewerPageExists] = useState(false)
  /** RLS-visible today's shared page id (participant membership). Never use create RPC to discover this. */
  const [visibleSharedPageId, setVisibleSharedPageId] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summarySnapshot, setSummarySnapshot] = useState<{
    page: ManagementJournalPage
    participants: ManagementJournalParticipant[]
    tasks: ManagementJournalTask[]
  } | null>(null)

  const hebrewDate = journalDate ? formatManagementJournalHebrewDate(journalDate) : ''

  const refreshPageBundle = useCallback(async (pageId: string) => {
    const [pageResult, participantResult, taskResult] = await Promise.all([
      loadManagementJournalPageById(pageId),
      loadManagementJournalParticipants(pageId),
      loadManagementJournalTasks(pageId),
    ])

    if (!pageResult.ok) {
      return { ok: false as const, errorMessage: pageResult.errorMessage }
    }
    if (!participantResult.ok) {
      return { ok: false as const, errorMessage: participantResult.errorMessage }
    }
    if (!taskResult.ok) {
      return { ok: false as const, errorMessage: taskResult.errorMessage }
    }

    let newerExists = false
    if (pageResult.page) {
      const newer = await loadManagementJournalNewerPageExists(pageResult.page)
      if (newer.ok) {
        newerExists = newer.exists
      }
    }

    return {
      ok: true as const,
      page: pageResult.page,
      participants: participantResult.participants,
      tasks: sortManagementJournalTasks(taskResult.tasks),
      newerPageExists: newerExists,
    }
  }, [])

  const applyLoadedBundle = useCallback(
    (bundle: {
      page: ManagementJournalPage | null
      participants: ManagementJournalParticipant[]
      tasks: ManagementJournalTask[]
      newerPageExists: boolean
    }) => {
      setPage(bundle.page)
      setParticipants(bundle.participants)
      setTasks(bundle.tasks)
      setNewerPageExists(bundle.newerPageExists)
      if (bundle.newerPageExists) {
        setIsPageFrozen(true)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    async function boot() {
      setIsBooting(true)
      setErrorMessage('')
      setSharedDenial({ visible: false })
      setVisibleSharedPageId(null)

      const dateResult = await loadManagementJournalCurrentDate()
      if (cancelled) {
        return
      }
      if (!dateResult.ok) {
        setErrorMessage(dateResult.errorMessage)
        setIsBooting(false)
        return
      }

      setJournalDate(dateResult.journalDate)

      if (canCreateShared) {
        const candidatesResult = await loadEligibleManagementJournalParticipants(institutionId)
        if (cancelled) {
          return
        }
        if (candidatesResult.ok) {
          setCandidates(candidatesResult.candidates)
        }
      }

      // Discover today's shared page via RLS SELECT only (no create RPC).
      // Participant → visible row; non-participant → no row.
      const sharedProbe = await loadTodayManagementJournalPage({
        journalDate: dateResult.journalDate,
        pageType: 'shared',
      })
      if (cancelled) {
        return
      }
      if (sharedProbe.ok && sharedProbe.page) {
        setVisibleSharedPageId(sharedProbe.page.id)
      }

      const personalResult = await openPersonalManagementJournalPage()
      if (cancelled) {
        return
      }
      if (!personalResult.ok) {
        setErrorMessage(personalResult.errorMessage)
        setIsBooting(false)
        return
      }

      const bundle = await refreshPageBundle(personalResult.pageId)
      if (cancelled) {
        return
      }
      if (!bundle.ok) {
        setErrorMessage(bundle.errorMessage)
        setIsBooting(false)
        return
      }

      setSelectedType('personal')
      applyLoadedBundle(bundle)
      setIsBooting(false)
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [actorUserId, applyLoadedBundle, canCreateShared, institutionId, refreshPageBundle])

  const remainingCandidates = useMemo(() => {
    const memberIds = new Set(participants.map((participant) => participant.userId))
    return candidates.filter((candidate) => candidate.id !== actorUserId && !memberIds.has(candidate.id))
  }, [actorUserId, candidates, participants])

  const pickerCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.id !== actorUserId),
    [actorUserId, candidates],
  )

  const showSharedTypeOption = canCreateShared || Boolean(visibleSharedPageId)

  async function handleSelectType(nextType: ManagementJournalPageType) {
    if (nextType === 'shared' && !showSharedTypeOption) {
      return
    }

    setSelectedType(nextType)
    setErrorMessage('')
    setSharedDenial({ visible: false })
    setPage(null)
    setParticipants([])
    setTasks([])
    setUserToAdd('')
    setIsPageFrozen(false)
    setNewerPageExists(false)
    setSummaryOpen(false)
    setSummarySnapshot(null)

    if (!journalDate) {
      return
    }

    if (nextType === 'personal') {
      setIsWorking(true)
      const opened = await openPersonalManagementJournalPage()
      if (!opened.ok) {
        setErrorMessage(opened.errorMessage)
        setIsWorking(false)
        return
      }
      const bundle = await refreshPageBundle(opened.pageId)
      setIsWorking(false)
      if (!bundle.ok) {
        setErrorMessage(bundle.errorMessage)
        return
      }
      applyLoadedBundle(bundle)
      return
    }

    // Shared: open existing page via RLS SELECT only. Never use create RPC for discovery.
    setIsWorking(true)
    const existing = await loadTodayManagementJournalPage({
      journalDate,
      pageType: 'shared',
    })
    if (!existing.ok) {
      setErrorMessage(existing.errorMessage)
      setIsWorking(false)
      return
    }

    if (existing.page) {
      setVisibleSharedPageId(existing.page.id)
      const bundle = await refreshPageBundle(existing.page.id)
      setIsWorking(false)
      if (!bundle.ok) {
        setErrorMessage(bundle.errorMessage)
        setVisibleSharedPageId(null)
        return
      }
      applyLoadedBundle(bundle)
      return
    }

    // No visible shared page (RLS). Creators may start the create picker; Secretary must not.
    setVisibleSharedPageId(null)
    if (!canCreateShared) {
      setIsWorking(false)
      return
    }

    setIsWorking(false)
  }

  function toggleCandidate(userId: string) {
    if (userId === actorUserId) {
      return
    }
    setSelectedCandidateIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )
  }

  async function handleOpenSharedPage() {
    if (!canCreateShared) {
      return
    }

    setIsWorking(true)
    setErrorMessage('')
    setSharedDenial({ visible: false })

    const opened = await openSharedManagementJournalPage(selectedCandidateIds)
    if (!opened.ok) {
      if (opened.errorCode === 'JOURNAL_PAGE_EXISTS') {
        setSharedDenial({ visible: true })
        setPage(null)
        setParticipants([])
        setTasks([])
        setIsWorking(false)
        return
      }
      setErrorMessage(opened.errorMessage)
      setIsWorking(false)
      return
    }

    setVisibleSharedPageId(opened.pageId)
    const bundle = await refreshPageBundle(opened.pageId)
    setIsWorking(false)
    if (!bundle.ok) {
      setErrorMessage(bundle.errorMessage)
      return
    }
    applyLoadedBundle(bundle)
  }

  async function handleAddParticipant() {
    if (!page || !userToAdd) {
      return
    }

    setIsWorking(true)
    setErrorMessage('')
    const result = await addManagementJournalPageParticipant(page.id, userToAdd)
    if (!result.ok) {
      await handleMutationFailure(result.errorCode, result.errorMessage, page.id)
      return
    }

    const bundle = await refreshPageBundle(page.id)
    setIsWorking(false)
    setUserToAdd('')
    if (!bundle.ok) {
      setErrorMessage(bundle.errorMessage)
      return
    }
    applyLoadedBundle(bundle)
  }

  async function handleOpenDailySummary() {
    if (!page) {
      return
    }

    setIsWorking(true)
    setErrorMessage('')
    const bundle = await refreshPageBundle(page.id)
    setIsWorking(false)

    if (!bundle.ok || !bundle.page) {
      setSummaryOpen(false)
      setSummarySnapshot(null)
      setErrorMessage(
        bundle.ok ? MANAGEMENT_JOURNAL_DAILY_SUMMARY_REFRESH_ERROR : bundle.errorMessage,
      )
      return
    }

    applyLoadedBundle(bundle)
    setSummarySnapshot({
      page: bundle.page,
      participants: bundle.participants,
      tasks: bundle.tasks,
    })
    setSummaryOpen(true)
  }

  function handleCloseDailySummary() {
    setSummaryOpen(false)
    setSummarySnapshot(null)
  }

  async function handleMutationFailure(
    errorCode: ManagementJournalErrorCode,
    errorMessageText: string,
    pageId: string,
  ) {
    setErrorMessage(errorMessageText)
    const bundle = await refreshPageBundle(pageId)
    setIsWorking(false)
    if (bundle.ok) {
      applyLoadedBundle(bundle)
      if (errorCode === 'JOURNAL_PAGE_FROZEN') {
        setIsPageFrozen(true)
      }
    }
  }

  async function runTaskMutation(
    pageId: string,
    mutate: () => Promise<{ ok: true } | { ok: false; errorCode: ManagementJournalErrorCode; errorMessage: string }>,
  ) {
    if (isWorking) {
      return
    }
    setIsWorking(true)
    setErrorMessage('')
    const result = await mutate()
    if (!result.ok) {
      await handleMutationFailure(result.errorCode, result.errorMessage, pageId)
      return
    }
    const bundle = await refreshPageBundle(pageId)
    setIsWorking(false)
    if (!bundle.ok) {
      setErrorMessage(bundle.errorMessage)
      return
    }
    applyLoadedBundle(bundle)
  }

  const pageReadOnly = isPageFrozen || isManagementJournalPageReadOnly(newerPageExists)

  const showSharedPicker =
    selectedType === 'shared' &&
    canCreateShared &&
    !visibleSharedPageId &&
    !sharedDenial.visible &&
    !page &&
    !isBooting
  const showNotebook = Boolean(page) && !sharedDenial.visible

  return (
    <DashboardSection
      title={MANAGEMENT_JOURNAL_NAV_LABEL}
      icon={<NavNotebookIcon />}
      className="management-journal-section"
    >
      <div className="management-journal" data-testid="management-journal">
        {isBooting ? (
          <p className="management-journal__status" role="status">
            טוען את יומן הניהול…
          </p>
        ) : null}

        {errorMessage ? (
          <p className="management-journal__error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {journalDate ? (
          <header className="management-journal__date-header">
            <p className="management-journal__day">{hebrewDate}</p>
            <p className="management-journal__date-key">{journalDate}</p>
          </header>
        ) : null}

        <div className="management-journal__type-switch" role="radiogroup" aria-label="סוג דף יומן">
          <button
            type="button"
            role="radio"
            aria-checked={selectedType === 'personal'}
            className={
              selectedType === 'personal'
                ? 'management-journal__type-button is-selected'
                : 'management-journal__type-button'
            }
            onClick={() => {
              void handleSelectType('personal')
            }}
          >
            דף אישי
          </button>
          {showSharedTypeOption ? (
            <button
              type="button"
              role="radio"
              aria-checked={selectedType === 'shared'}
              className={
                selectedType === 'shared'
                  ? 'management-journal__type-button is-selected'
                  : 'management-journal__type-button'
              }
              onClick={() => {
                void handleSelectType('shared')
              }}
            >
              דף משותף
            </button>
          ) : null}
        </div>

        {sharedDenial.visible ? (
          <p className="management-journal__error" role="alert" data-testid="journal-page-exists-denial">
            לא ניתן לפתוח את הדף המשותף להיום.
          </p>
        ) : null}

        {showSharedPicker ? (
          <section
            className="management-journal__picker"
            data-testid="journal-shared-participant-selector"
            aria-label="בחירת משתתפים לדף המשותף"
          >
            <h3 className="management-journal__picker-title">בחירת משתתפים לדף המשותף</h3>
            <ul className="management-journal__candidate-list">
              <li>
                <label className="management-journal__candidate">
                  <input type="checkbox" checked disabled readOnly aria-label={`${actorFullName} יוצרת הדף`} />
                  <span>
                    {actorFullName} <em>יוצרת הדף</em>
                  </span>
                </label>
              </li>
              {pickerCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <label className="management-journal__candidate">
                    <input
                      type="checkbox"
                      checked={selectedCandidateIds.includes(candidate.id)}
                      onChange={() => toggleCandidate(candidate.id)}
                    />
                    <span>
                      {candidate.fullName} · {translateRole(candidate.primaryRole)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="ds-btn ds-btn--primary management-journal__primary"
              disabled={isWorking}
              onClick={() => {
                void handleOpenSharedPage()
              }}
            >
              פתיחת דף משותף להיום
            </button>
          </section>
        ) : null}

        {showNotebook && page ? (
          <article
            className="management-journal__paper"
            data-testid="journal-notebook"
            aria-label="דף יומן ניהול"
          >
            <div className="management-journal__paper-head">
              <span className={`management-journal__badge management-journal__badge--${page.pageType}`}>
                {translateManagementJournalPageType(page.pageType)}
              </span>
              {page.pageType === 'shared' ? (
                <ul className="management-journal__chips" aria-label="משתתפות הדף">
                  {participants.map((participant) => (
                    <li key={participant.userId} className="management-journal__chip">
                      <span className="management-journal__avatar" aria-hidden="true">
                        {participant.fullName.slice(0, 1)}
                      </span>
                      <span>{participant.fullName}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {page.pageType === 'shared' && canAddParticipant && !pageReadOnly ? (
              <div className="management-journal__add" data-testid="journal-add-participant">
                <label className="management-journal__add-label" htmlFor="journal-add-participant-select">
                  הוספת משתתפת
                </label>
                <div className="management-journal__add-row">
                  <select
                    id="journal-add-participant-select"
                    value={userToAdd}
                    onChange={(event) => setUserToAdd(event.target.value)}
                  >
                    <option value="">בחירת משתתפת להוספה</option>
                    {remainingCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.fullName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary ds-btn--compact management-journal__primary"
                    disabled={!userToAdd || isWorking}
                    onClick={() => {
                      void handleAddParticipant()
                    }}
                  >
                    הוספה
                  </button>
                </div>
              </div>
            ) : null}

            {pageReadOnly ? (
              <p className="management-journal__frozen" role="status" data-testid="journal-frozen-banner">
                {MANAGEMENT_JOURNAL_FROZEN_LABEL}
              </p>
            ) : canCreateManagementJournalTaskUi(actorRole, page.pageType) ? (
              <ManagementJournalTaskComposer
                pageType={page.pageType}
                actorUserId={actorUserId}
                actorRole={actorRole}
                participants={participants}
                disabled={isWorking}
                onCreate={(input) => {
                  void runTaskMutation(page.id, () =>
                    createManagementJournalTask({
                      pageId: page.id,
                      title: input.title,
                      responsibleUserId: input.responsibleUserId,
                      details: input.details || null,
                      targetTime: input.targetTime || null,
                    }),
                  )
                }}
              />
            ) : null}

            <div className="management-journal__ruled" data-testid="journal-ruled-body">
              {tasks.length === 0 ? (
                <>
                  <p className="management-journal__empty" data-testid="journal-empty-tasks">
                    {MANAGEMENT_JOURNAL_EMPTY_TASKS_LABEL}
                  </p>
                  {Array.from({ length: PLACEHOLDER_ROW_COUNT }, (_, index) => (
                    <div key={index} className="management-journal__rule" aria-hidden="true" />
                  ))}
                </>
              ) : (
                sortManagementJournalTasks(tasks).map((task) => (
                  <ManagementJournalTaskRow
                    key={task.id}
                    task={task}
                    actorUserId={actorUserId}
                    actorRole={actorRole}
                    pageType={page.pageType}
                    participants={participants}
                    readOnly={pageReadOnly}
                    busy={isWorking}
                    onUpdateStatus={(current, nextStatus: ManagementJournalTaskStatus) => {
                      void runTaskMutation(page.id, () =>
                        updateManagementJournalTaskStatus({
                          taskId: current.id,
                          expectedStatus: current.status,
                          newStatus: nextStatus,
                        }),
                      )
                    }}
                    onUpdateNote={(current, note) => {
                      void runTaskMutation(page.id, () =>
                        updateManagementJournalTaskNote(current.id, note),
                      )
                    }}
                    onUpdateContent={(current, input) => {
                      void runTaskMutation(page.id, () =>
                        updateManagementJournalTaskContent({
                          taskId: current.id,
                          title: input.title,
                          details: input.details || null,
                          targetTime: input.targetTime || null,
                        }),
                      )
                    }}
                    onAssign={(current, targetUserId) => {
                      void runTaskMutation(page.id, () =>
                        assignManagementJournalTask(current.id, targetUserId),
                      )
                    }}
                  />
                ))
              )}
            </div>

            <div className="management-journal__report-actions">
              <button
                type="button"
                className="ds-btn ds-btn--secondary management-journal__secondary"
                data-testid="journal-daily-summary-open"
                disabled={isWorking}
                onClick={() => {
                  void handleOpenDailySummary()
                }}
              >
                {MANAGEMENT_JOURNAL_DAILY_SUMMARY_BUTTON_LABEL}
              </button>
            </div>
          </article>
        ) : null}

        {summaryOpen && summarySnapshot ? (
          <ManagementJournalDailySummary
            isOpen={summaryOpen}
            page={summarySnapshot.page}
            participants={summarySnapshot.participants}
            tasks={summarySnapshot.tasks}
            onClose={handleCloseDailySummary}
          />
        ) : null}
      </div>
    </DashboardSection>
  )
}
