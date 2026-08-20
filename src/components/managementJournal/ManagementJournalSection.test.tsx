import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagementJournalSection } from './ManagementJournalSection'

const {
  loadDateMock,
  loadEligibleMock,
  openPersonalMock,
  openSharedMock,
  loadPageMock,
  loadParticipantsMock,
  loadTasksMock,
  loadTodayMock,
  addParticipantMock,
  loadNewerMock,
  createTaskMock,
  updateContentMock,
  updateNoteMock,
  assignTaskMock,
  updateStatusMock,
} = vi.hoisted(() => ({
  loadDateMock: vi.fn(),
  loadEligibleMock: vi.fn(),
  openPersonalMock: vi.fn(),
  openSharedMock: vi.fn(),
  loadPageMock: vi.fn(),
  loadParticipantsMock: vi.fn(),
  loadTasksMock: vi.fn(),
  loadTodayMock: vi.fn(),
  addParticipantMock: vi.fn(),
  loadNewerMock: vi.fn(),
  createTaskMock: vi.fn(),
  updateContentMock: vi.fn(),
  updateNoteMock: vi.fn(),
  assignTaskMock: vi.fn(),
  updateStatusMock: vi.fn(),
}))

vi.mock('../../services/managementJournal', () => ({
  loadManagementJournalCurrentDate: loadDateMock,
  loadEligibleManagementJournalParticipants: loadEligibleMock,
  openPersonalManagementJournalPage: openPersonalMock,
  openSharedManagementJournalPage: openSharedMock,
  loadManagementJournalPageById: loadPageMock,
  loadManagementJournalParticipants: loadParticipantsMock,
  loadManagementJournalTasks: loadTasksMock,
  loadTodayManagementJournalPage: loadTodayMock,
  addManagementJournalPageParticipant: addParticipantMock,
  loadManagementJournalNewerPageExists: loadNewerMock,
  createManagementJournalTask: createTaskMock,
  updateManagementJournalTaskContent: updateContentMock,
  updateManagementJournalTaskNote: updateNoteMock,
  assignManagementJournalTask: assignTaskMock,
  updateManagementJournalTaskStatus: updateStatusMock,
}))

const personalPage = {
  id: 'personal-1',
  institutionId: 'inst-1',
  journalDate: '2026-08-19',
  pageType: 'personal' as const,
  ownerUserId: 'mgr-1',
  createdByUserId: 'mgr-1',
  createdAt: '2026-08-19T07:00:00.000Z',
  updatedAt: '2026-08-19T07:00:00.000Z',
}

const sharedPage = {
  ...personalPage,
  id: 'shared-1',
  pageType: 'shared' as const,
}

function mockPersonalOpen() {
  loadDateMock.mockResolvedValue({ ok: true, journalDate: '2026-08-19' })
  loadEligibleMock.mockResolvedValue({
    ok: true,
    candidates: [
      {
        id: 'mgr-1',
        fullName: 'מנהלת כהן',
        primaryRole: 'institution_manager',
        status: 'active',
        institutionId: 'inst-1',
      },
      {
        id: 'sec-1',
        fullName: 'מזכירה לוי',
        primaryRole: 'secretary',
        status: 'active',
        institutionId: 'inst-1',
      },
    ],
  })
  openPersonalMock.mockResolvedValue({
    ok: true,
    unchanged: false,
    pageId: 'personal-1',
    pageType: 'personal',
    journalDate: '2026-08-19',
    carriedTaskCount: 0,
  })
  openSharedMock.mockResolvedValue({
    ok: true,
    unchanged: false,
    pageId: 'shared-1',
    pageType: 'shared',
    journalDate: '2026-08-19',
    carriedTaskCount: 0,
  })
  loadPageMock.mockImplementation(async (pageId: string) => ({
    ok: true,
    page: pageId === 'shared-1' ? sharedPage : personalPage,
  }))
  loadParticipantsMock.mockResolvedValue({ ok: true, participants: [] })
  loadTasksMock.mockResolvedValue({ ok: true, tasks: [] })
  loadTodayMock.mockResolvedValue({ ok: true, page: null })
  loadNewerMock.mockResolvedValue({ ok: true, exists: false })
  createTaskMock.mockResolvedValue({ ok: true, taskId: 'task-1' })
  updateContentMock.mockResolvedValue({ ok: true, taskId: 'task-1' })
  updateNoteMock.mockResolvedValue({ ok: true, taskId: 'task-1' })
  assignTaskMock.mockResolvedValue({ ok: true, taskId: 'task-1' })
  updateStatusMock.mockResolvedValue({ ok: true, taskId: 'task-1' })
}

describe('ManagementJournalSection J2A', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadDateMock.mockReset()
    loadEligibleMock.mockReset()
    openPersonalMock.mockReset()
    openSharedMock.mockReset()
    loadPageMock.mockReset()
    loadParticipantsMock.mockReset()
    loadTasksMock.mockReset()
    loadTodayMock.mockReset()
    addParticipantMock.mockReset()
    loadNewerMock.mockReset()
    createTaskMock.mockReset()
    updateContentMock.mockReset()
    updateNoteMock.mockReset()
    assignTaskMock.mockReset()
    updateStatusMock.mockReset()
    mockPersonalOpen()
  })

  it('opens today personal page through the public RPC and shows the notebook shell', async () => {
    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    expect(await screen.findByText('דף אישי')).toBeInTheDocument()
    expect(await screen.findByTestId('journal-notebook')).toBeInTheDocument()
    expect(screen.getByTestId('journal-empty-tasks')).toHaveTextContent('אין עדיין משימות בדף זה')
    expect(screen.queryByTestId('journal-shared-participant-selector')).not.toBeInTheDocument()
    expect(openPersonalMock).toHaveBeenCalledWith()
    expect(loadDateMock).toHaveBeenCalledWith()
  })

  it('lets manager and deputy choose shared, and keeps the creator selected', async () => {
    const user = userEvent.setup({ delay: null })
    loadTodayMock.mockResolvedValue({ ok: true, page: null })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))

    const picker = await screen.findByTestId('journal-shared-participant-selector')
    const creator = picker.querySelector('input[type="checkbox"][disabled]')
    expect(creator).toBeTruthy()
    expect(creator).toBeChecked()
    expect(screen.queryByRole('button', { name: /הסר/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'פתיחת דף משותף להיום' }))
    expect(openSharedMock).toHaveBeenCalledWith(['mgr-1'])
  })

  it('does not show shared-page creation to secretary when she is not a participant', async () => {
    loadTodayMock.mockResolvedValue({ ok: true, page: null })
    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    expect(screen.getByRole('radio', { name: 'דף אישי' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'דף משותף' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-participant')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-shared-participant-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-assignee-picker')).not.toBeInTheDocument()
    expect(screen.getByTestId('journal-personal-self-assignee')).toBeInTheDocument()
    expect(openSharedMock).not.toHaveBeenCalled()
  })

  it('lets a participating secretary open today shared page via RLS SELECT without create RPC', async () => {
    const user = userEvent.setup({ delay: null })
    loadTodayMock.mockResolvedValue({ ok: true, page: sharedPage })
    loadPageMock.mockImplementation(async (pageId: string) => ({
      ok: true,
      page: pageId === 'shared-1' ? sharedPage : { ...personalPage, ownerUserId: 'sec-1', createdByUserId: 'sec-1' },
    }))
    loadParticipantsMock.mockImplementation(async (pageId: string) => {
      if (pageId === 'shared-1') {
        return {
          ok: true,
          participants: [
            {
              pageId: 'shared-1',
              userId: 'mgr-1',
              addedByUserId: null,
              addedAutomatically: true,
              addedAt: '2026-08-19T07:00:00.000Z',
              fullName: 'מנהלת כהן',
              primaryRole: 'institution_manager',
              status: 'active',
            },
            {
              pageId: 'shared-1',
              userId: 'sec-1',
              addedByUserId: 'mgr-1',
              addedAutomatically: false,
              addedAt: '2026-08-19T07:00:00.000Z',
              fullName: 'מזכירה לוי',
              primaryRole: 'secretary',
              status: 'active',
            },
          ],
        }
      }
      return { ok: true, participants: [] }
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    expect(screen.getByRole('radio', { name: 'דף אישי' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'דף משותף' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByText('דף משותף', { selector: '.management-journal__badge' })).toBeInTheDocument()
    expect(screen.queryByTestId('journal-shared-participant-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-participant')).not.toBeInTheDocument()
    expect(openSharedMock).not.toHaveBeenCalled()
    expect(loadTodayMock).toHaveBeenCalled()
    expect(createTaskMock).not.toHaveBeenCalled()

    expect(screen.queryByTestId('journal-add-task-composer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הוספת משימה' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-assignee-picker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-reassign')).not.toBeInTheDocument()
  })

  it('keeps personal add-task UI for secretary on her own personal page', async () => {
    openPersonalMock.mockResolvedValue({
      ok: true,
      unchanged: false,
      pageId: 'personal-sec',
      pageType: 'personal',
      journalDate: '2026-08-19',
      carriedTaskCount: 0,
    })
    loadPageMock.mockResolvedValue({
      ok: true,
      page: {
        ...personalPage,
        id: 'personal-sec',
        ownerUserId: 'sec-1',
        createdByUserId: 'sec-1',
      },
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    expect(await screen.findByTestId('journal-add-task-composer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספת משימה' })).toBeInTheDocument()
    expect(screen.getByTestId('journal-personal-self-assignee')).toBeInTheDocument()
  })

  it('displays existing shared participants and adds via the intended RPC', async () => {
    const user = userEvent.setup({ delay: null })
    loadTodayMock.mockResolvedValue({ ok: true, page: sharedPage })
    loadPageMock.mockImplementation(async (pageId: string) => ({
      ok: true,
      page: pageId === 'shared-1' ? sharedPage : personalPage,
    }))
    loadParticipantsMock.mockImplementation(async (pageId: string) => {
      if (pageId === 'shared-1') {
        return {
          ok: true,
          participants: [
            {
              pageId: 'shared-1',
              userId: 'mgr-1',
              addedByUserId: null,
              addedAutomatically: true,
              addedAt: '2026-08-19T07:00:00.000Z',
              fullName: 'מנהלת כהן',
              primaryRole: 'institution_manager',
              status: 'active',
            },
          ],
        }
      }
      return { ok: true, participants: [] }
    })
    addParticipantMock.mockResolvedValue({
      ok: true,
      pageId: 'shared-1',
      userId: 'sec-1',
      added: true,
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="deputy"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect((await screen.findAllByText('מנהלת כהן')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('journal-add-participant')).toBeInTheDocument()
    expect(openSharedMock).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('הוספת משתתפת'), 'sec-1')
    await user.click(screen.getByRole('button', { name: 'הוספה' }))
    expect(addParticipantMock).toHaveBeenCalledWith('shared-1', 'sec-1')
  })

  it('handles journal_page_exists without leaking page or participant data', async () => {
    const user = userEvent.setup({ delay: null })
    loadTodayMock.mockResolvedValue({ ok: true, page: null })
    openSharedMock.mockResolvedValue({
      ok: false,
      errorCode: 'JOURNAL_PAGE_EXISTS',
      errorMessage: 'לא ניתן לפתוח את הדף המשותף להיום.',
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    await user.click(await screen.findByRole('button', { name: 'פתיחת דף משותף להיום' }))

    expect(await screen.findByTestId('journal-page-exists-denial')).toHaveTextContent(
      'לא ניתן לפתוח את הדף המשותף להיום.',
    )
    expect(screen.queryByTestId('journal-notebook')).not.toBeInTheDocument()
    expect(screen.queryByText('מזכירה לוי')).not.toBeInTheDocument()
  })

  it('shows a Hebrew error when the date RPC fails', async () => {
    loadDateMock.mockResolvedValue({
      ok: false,
      errorCode: 'NETWORK',
      errorMessage: 'לא ניתן להתחבר ליומן הניהול כרגע.',
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('לא ניתן להתחבר ליומן הניהול כרגע.')
    await waitFor(() => {
      expect(openPersonalMock).not.toHaveBeenCalled()
    })
  })
})
const baseTask = {
  id: 'task-1',
  pageId: 'shared-1',
  institutionId: 'inst-1',
  title: 'לבדוק מערכת',
  details: 'הנחיות מקור',
  note: 'הערה קיימת',
  targetTime: '09:30:00',
  responsibleUserId: 'sec-1',
  status: 'new' as const,
  sortOrder: 2,
  createdByUserId: 'mgr-1',
  createdAt: '2026-08-19T07:00:00.000Z',
  updatedAt: '2026-08-19T07:00:00.000Z',
  originTaskId: null,
  originPageId: null,
  carriedForward: false,
}

const sharedMembers = [
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
    userId: 'dep-1',
    addedByUserId: 'mgr-1',
    addedAutomatically: false,
    addedAt: '2026-08-19T07:00:00.000Z',
    fullName: 'סגנית פרץ',
    primaryRole: 'deputy' as const,
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
  {
    pageId: 'shared-1',
    userId: 'inactive-1',
    addedByUserId: 'mgr-1',
    addedAutomatically: false,
    addedAt: '2026-08-19T07:00:00.000Z',
    fullName: 'לא פעילה',
    primaryRole: 'secretary' as const,
    status: 'inactive',
  },
]

function mockSharedWorkspace() {
  loadTodayMock.mockResolvedValue({ ok: true, page: sharedPage })
  openSharedMock.mockResolvedValue({
    ok: true,
    unchanged: true,
    pageId: 'shared-1',
    pageType: 'shared',
    journalDate: '2026-08-19',
    carriedTaskCount: 0,
  })
  loadPageMock.mockImplementation(async (pageId: string) => ({
    ok: true,
    page: pageId === 'shared-1' ? sharedPage : personalPage,
  }))
  loadParticipantsMock.mockResolvedValue({ ok: true, participants: sharedMembers })
}

describe('ManagementJournalSection J2B task workflow', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadDateMock.mockReset()
    loadEligibleMock.mockReset()
    openPersonalMock.mockReset()
    openSharedMock.mockReset()
    loadPageMock.mockReset()
    loadParticipantsMock.mockReset()
    loadTasksMock.mockReset()
    loadTodayMock.mockReset()
    addParticipantMock.mockReset()
    loadNewerMock.mockReset()
    createTaskMock.mockReset()
    updateContentMock.mockReset()
    updateNoteMock.mockReset()
    assignTaskMock.mockReset()
    updateStatusMock.mockReset()
    mockPersonalOpen()
  })

  it('keeps status and note read-only for secretary on another responsible user task', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({
      ok: true,
      tasks: [{ ...baseTask, responsibleUserId: 'mgr-1', createdByUserId: 'mgr-1', note: 'הערת מנהלת' }],
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-status-readonly')).toHaveTextContent('חדש')
    expect(screen.queryByLabelText('סטטוס משימה')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('הערת טיפול')).not.toBeInTheDocument()
    expect(screen.getByText(/הערת מנהלת/)).toBeInTheDocument()
    expect(screen.queryByTestId('journal-reassign')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-task-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-participant')).not.toBeInTheDocument()
    expect(openSharedMock).not.toHaveBeenCalled()
  })

  it('lets secretary update status and note on own shared assignment without create/reassign UI', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({
      ok: true,
      tasks: [{ ...baseTask, note: null }],
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-task-task-1')).toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-task-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-reassign')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('סטטוס משימה'), 'in_progress')
    expect(updateStatusMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedStatus: 'new',
      newStatus: 'in_progress',
    })

    await user.type(screen.getByLabelText('הערת טיפול'), 'בטיפול מול ספק')
    await user.click(screen.getByRole('button', { name: 'שמירת הערה' }))
    expect(updateNoteMock).toHaveBeenCalledWith('task-1', 'בטיפול מול ספק')
  })

  it('keeps manager shared create UI available', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [] })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-add-task-composer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספת משימה' })).toBeInTheDocument()
    expect(screen.getByTestId('journal-assignee-picker')).toBeInTheDocument()
  })

  it('keeps deputy shared create UI available', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [] })

    render(
      <ManagementJournalSection
        actorUserId="dep-1"
        actorFullName="סגנית פרץ"
        actorRole="deputy"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-add-task-composer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספת משימה' })).toBeInTheDocument()
  })

  it('creates a personal task assigned to self through the public RPC', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-add-task-composer')
    expect(screen.getByTestId('journal-personal-self-assignee')).toBeInTheDocument()
    expect(screen.queryByTestId('journal-assignee-picker')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('טקסט המשימה'), 'לסכם יום')
    await user.click(screen.getByRole('button', { name: 'הוספת משימה' }))

    expect(createTaskMock).toHaveBeenCalledWith({
      pageId: 'personal-1',
      title: 'לסכם יום',
      responsibleUserId: 'mgr-1',
      details: null,
      targetTime: null,
    })
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty('status')
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty('createdByUserId')
  })

  it('lets the responsible user update status with CAS expected status', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [baseTask] })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.selectOptions(screen.getByLabelText('סטטוס משימה'), 'in_progress')
    expect(updateStatusMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedStatus: 'new',
      newStatus: 'in_progress',
    })
  })

  it('keeps status read-only for a non-responsible manager (no override)', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [baseTask] })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-status-readonly')).toHaveTextContent('חדש')
    expect(screen.queryByLabelText('סטטוס משימה')).not.toBeInTheDocument()
  })

  it('lets the responsible user save an operational note and blocks content edit for non-creator', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({
      ok: true,
      tasks: [{ ...baseTask, note: null }],
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByLabelText('הערת טיפול')
    expect(screen.queryByRole('button', { name: 'עריכת תוכן המשימה' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('הערת טיפול'), 'בטיפול מול ספק')
    await user.click(screen.getByRole('button', { name: 'שמירת הערה' }))
    expect(updateNoteMock).toHaveBeenCalledWith('task-1', 'בטיפול מול ספק')
  })

  it('lets the creator edit original content', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [baseTask] })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    const task = await screen.findByTestId('journal-task-task-1')
    await user.click(within(task).getByRole('button', { name: 'עריכת תוכן המשימה' }))
    await user.clear(within(task).getByLabelText('טקסט המשימה'))
    await user.type(within(task).getByLabelText('טקסט המשימה'), 'כותרת מעודכנת')
    await user.click(within(task).getByRole('button', { name: 'שמירת תוכן' }))
    expect(updateContentMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      title: 'כותרת מעודכנת',
      details: 'הנחיות מקור',
      targetTime: '09:30',
    })
  })

  it('reassigns through assign_management_journal_task and excludes inactive users', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [baseTask] })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await user.click(screen.getByRole('radio', { name: 'דף משותף' }))
    const reassign = await screen.findByTestId('journal-reassign')
    expect(reassign).not.toHaveTextContent('לא פעילה')
    await user.selectOptions(screen.getByLabelText('העברת אחריות'), 'dep-1')
    await user.click(screen.getByRole('button', { name: 'עדכון אחראית' }))
    expect(assignTaskMock).toHaveBeenCalledWith('task-1', 'dep-1')
  })

  it('shows carried-forward and unassigned labels without fabricating extra tasks', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({
      ok: true,
      tasks: [
        {
          ...baseTask,
          id: 'task-2',
          sortOrder: 1,
          carriedForward: true,
          responsibleUserId: null,
          originTaskId: 'old-1',
        },
      ],
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    expect(await screen.findByTestId('journal-carried-label')).toHaveTextContent('הועבר מיום קודם')
    expect(screen.getByTestId('journal-unassigned-label')).toHaveTextContent(
      'ללא אחראית — האחראית הקודמת אינה פעילה',
    )
    expect(screen.getAllByTestId(/^journal-task-/)).toHaveLength(1)
  })

  it('hides mutation controls when a newer same-stream page exists', async () => {
    loadNewerMock.mockResolvedValue({ ok: true, exists: true })
    loadTasksMock.mockResolvedValue({ ok: true, tasks: [{ ...baseTask, pageId: 'personal-1' }] })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    expect(await screen.findByTestId('journal-frozen-banner')).toHaveTextContent(
      'דף זה נשמר בהיסטוריה ואינו ניתן לעריכה.',
    )
    expect(screen.queryByTestId('journal-add-task-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-participant')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('סטטוס משימה')).not.toBeInTheDocument()
  })

  it('does not freeze a past-dated page when no newer same-stream page exists', async () => {
    loadPageMock.mockResolvedValue({
      ok: true,
      page: { ...personalPage, journalDate: '2026-08-18' },
    })
    loadNewerMock.mockResolvedValue({ ok: true, exists: false })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    expect(await screen.findByTestId('journal-add-task-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('journal-frozen-banner')).not.toBeInTheDocument()
  })

  it('switches to read-only when a mutation returns journal_page_frozen', async () => {
    const user = userEvent.setup({ delay: null })
    createTaskMock.mockResolvedValue({
      ok: false,
      errorCode: 'JOURNAL_PAGE_FROZEN',
      errorMessage: 'דף זה נשמר בהיסטוריה ואינו ניתן לעריכה.',
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-add-task-composer')
    await user.type(screen.getByLabelText('טקסט המשימה'), 'משימה')
    await user.click(screen.getByRole('button', { name: 'הוספת משימה' }))
    expect(await screen.findByTestId('journal-frozen-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('journal-add-task-composer')).not.toBeInTheDocument()
  })

  it('refreshes on stale status without sending an overwrite', async () => {
    const user = userEvent.setup({ delay: null })
    mockSharedWorkspace()
    loadTasksMock
      .mockResolvedValueOnce({ ok: true, tasks: [baseTask] })
      .mockResolvedValue({ ok: true, tasks: [{ ...baseTask, status: 'in_progress' as const }] })
    updateStatusMock.mockResolvedValue({
      ok: false,
      errorCode: 'JOURNAL_STALE_STATUS',
      errorMessage: 'המשימה עודכנה במקום אחר. הנתונים רועננו.',
    })

    render(
      <ManagementJournalSection
        actorUserId="sec-1"
        actorFullName="מזכירה לוי"
        actorRole="secretary"
        institutionId="inst-1"
      />,
    )

    await screen.findByLabelText('סטטוס משימה')
    await user.selectOptions(screen.getByLabelText('סטטוס משימה'), 'completed')
    expect(await screen.findByRole('alert')).toHaveTextContent('המשימה עודכנה במקום אחר. הנתונים רועננו.')
    expect(updateStatusMock).toHaveBeenCalledTimes(1)
  })

  it('renders tasks in persisted sort_order', async () => {
    mockSharedWorkspace()
    loadTasksMock.mockResolvedValue({
      ok: true,
      tasks: [
        { ...baseTask, id: 'later', title: 'שנייה', sortOrder: 2 },
        { ...baseTask, id: 'first', title: 'ראשונה', sortOrder: 1, note: null },
      ],
    })

    render(
      <ManagementJournalSection
        actorUserId="mgr-1"
        actorFullName="מנהלת כהן"
        actorRole="institution_manager"
        institutionId="inst-1"
      />,
    )

    await screen.findByTestId('journal-notebook')
    await userEvent.setup({ delay: null }).click(screen.getByRole('radio', { name: 'דף משותף' }))
    const titles = await screen.findAllByRole('heading', { level: 4 })
    expect(titles.map((node) => node.textContent)).toEqual(['ראשונה', 'שנייה'])
  })
})
