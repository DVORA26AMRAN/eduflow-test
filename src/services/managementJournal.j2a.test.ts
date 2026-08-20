import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}))

import {
  addManagementJournalPageParticipant,
  assignManagementJournalTask,
  createManagementJournalTask,
  loadEligibleManagementJournalParticipants,
  loadManagementJournalCurrentDate,
  loadManagementJournalNewerPageExists,
  openPersonalManagementJournalPage,
  openSharedManagementJournalPage,
  updateManagementJournalTaskContent,
  updateManagementJournalTaskNote,
  updateManagementJournalTaskStatus,
} from './managementJournal'
import { MANAGEMENT_JOURNAL_MESSAGES } from '../utils/managementJournalDisplay'

function selectChain(result: { data: unknown; error: { message?: string; code?: string } | null }) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.gt = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(result))
  chain.order = vi.fn(() => Promise.resolve(result))
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  return chain
}

describe('management journal J2A service', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it('loads the authoritative journal date from the J1 RPC', async () => {
    rpcMock.mockResolvedValue({ data: '2026-08-19', error: null })
    await expect(loadManagementJournalCurrentDate()).resolves.toEqual({
      ok: true,
      journalDate: '2026-08-19',
    })
    expect(rpcMock).toHaveBeenCalledWith('management_journal_current_date')
    expect(rpcMock.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('opens a personal page with the zero-argument public RPC', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        unchanged: true,
        page_id: 'page-1',
        page_type: 'personal',
        journal_date: '2026-08-19',
        carried_task_count: 0,
      },
      error: null,
    })

    await expect(openPersonalManagementJournalPage()).resolves.toMatchObject({
      ok: true,
      pageId: 'page-1',
      pageType: 'personal',
      unchanged: true,
    })
    expect(rpcMock).toHaveBeenCalledWith('create_management_journal_personal_page')
    expect(rpcMock.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('opens a shared page with participant ids only', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        unchanged: false,
        page_id: 'page-2',
        page_type: 'shared',
        journal_date: '2026-08-19',
        carried_task_count: 1,
      },
      error: null,
    })

    await expect(openSharedManagementJournalPage(['u1', 'u2'])).resolves.toMatchObject({
      ok: true,
      pageId: 'page-2',
      pageType: 'shared',
    })
    expect(rpcMock).toHaveBeenCalledWith('create_management_journal_shared_page', {
      p_participant_user_ids: ['u1', 'u2'],
    })
    expect(JSON.stringify(rpcMock.mock.calls[0]?.[1])).not.toContain('journal_date')
  })

  it('maps journal_page_exists without returning page data', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'journal_page_exists', code: '23505' },
    })

    const result = await openSharedManagementJournalPage(['u1'])
    expect(result).toEqual({
      ok: false,
      errorCode: 'JOURNAL_PAGE_EXISTS',
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_PAGE_EXISTS,
    })
    expect(result).not.toHaveProperty('pageId')
    expect(result).not.toHaveProperty('participants')
  })

  it('adds a participant through the intended RPC', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, page_id: 'page-2', user_id: 'sec-1', added: true },
      error: null,
    })

    await expect(addManagementJournalPageParticipant('page-2', 'sec-1')).resolves.toEqual({
      ok: true,
      pageId: 'page-2',
      userId: 'sec-1',
      added: true,
    })
    expect(rpcMock).toHaveBeenCalledWith('add_management_journal_page_participant', {
      p_page_id: 'page-2',
      p_user_id: 'sec-1',
    })
  })

  it('loads eligible active management users with the users SELECT ACL', async () => {
    fromMock.mockReturnValue(
      selectChain({
        data: [
          {
            id: 'mgr',
            full_name: 'מנהלת',
            primary_role: 'institution_manager',
            status: 'active',
            institution_id: 'inst-1',
          },
          {
            id: 'teacher-1',
            full_name: 'מורה',
            primary_role: 'teacher',
            status: 'active',
            institution_id: 'inst-1',
          },
        ],
        error: null,
      }),
    )

    const result = await loadEligibleManagementJournalParticipants('inst-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates.map((row) => row.id)).toEqual(['mgr'])
    }
    expect(fromMock).toHaveBeenCalledWith('users')
  })
})

describe('management journal J2B task RPCs', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it('creates a task through create_management_journal_task without client status', async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, task_id: 'task-1', page_id: 'page-1', status: 'new', responsible_user_id: 'mgr-1' },
      error: null,
    })

    await expect(
      createManagementJournalTask({
        pageId: 'page-1',
        title: 'משימה',
        responsibleUserId: 'mgr-1',
        details: 'פרטים',
        targetTime: '09:30',
      }),
    ).resolves.toEqual({ ok: true, taskId: 'task-1' })

    expect(rpcMock).toHaveBeenCalledWith('create_management_journal_task', {
      p_page_id: 'page-1',
      p_title: 'משימה',
      p_responsible_user_id: 'mgr-1',
      p_details: 'פרטים',
      p_target_time: '09:30',
    })
    expect(JSON.stringify(rpcMock.mock.calls[0]?.[1])).not.toContain('p_status')
    expect(JSON.stringify(rpcMock.mock.calls[0]?.[1])).not.toContain('created_by')
  })

  it('updates content, note, assignment, and status through public RPCs', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, task_id: 'task-1' }, error: null })

    await updateManagementJournalTaskContent({
      taskId: 'task-1',
      title: 'כותרת',
      details: null,
      targetTime: null,
    })
    expect(rpcMock).toHaveBeenCalledWith('update_management_journal_task_content', {
      p_task_id: 'task-1',
      p_title: 'כותרת',
      p_details: null,
      p_target_time: null,
    })

    await updateManagementJournalTaskNote('task-1', 'הערה')
    expect(rpcMock).toHaveBeenCalledWith('update_management_journal_task_note', {
      p_task_id: 'task-1',
      p_note: 'הערה',
    })

    await assignManagementJournalTask('task-1', 'sec-1')
    expect(rpcMock).toHaveBeenCalledWith('assign_management_journal_task', {
      p_task_id: 'task-1',
      p_target_user_id: 'sec-1',
    })

    await updateManagementJournalTaskStatus({
      taskId: 'task-1',
      expectedStatus: 'new',
      newStatus: 'blocked',
    })
    expect(rpcMock).toHaveBeenCalledWith('update_management_journal_task_status', {
      p_task_id: 'task-1',
      p_expected_status: 'new',
      p_new_status: 'blocked',
    })
  })

  it('maps frozen and stale errors to Hebrew without raw postgres text', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'journal_page_frozen', code: 'P0001' },
    })
    await expect(assignManagementJournalTask('task-1', 'sec-1')).resolves.toMatchObject({
      ok: false,
      errorCode: 'JOURNAL_PAGE_FROZEN',
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_PAGE_FROZEN,
    })

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'journal_stale_status', code: 'P0001' },
    })
    await expect(
      updateManagementJournalTaskStatus({
        taskId: 'task-1',
        expectedStatus: 'new',
        newStatus: 'completed',
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'JOURNAL_STALE_STATUS',
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.JOURNAL_STALE_STATUS,
    })
  })

  it('detects freeze from a newer shared page in the same institution stream only', async () => {
    const chain = selectChain({ data: [{ id: 'newer' }], error: null })
    fromMock.mockReturnValue(chain)

    await expect(
      loadManagementJournalNewerPageExists({
        id: 'shared-old',
        institutionId: 'inst-1',
        journalDate: '2026-08-18',
        pageType: 'shared',
        ownerUserId: 'mgr-1',
        createdByUserId: 'mgr-1',
        createdAt: '2026-08-18T07:00:00.000Z',
        updatedAt: '2026-08-18T07:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: true, exists: true })

    expect(fromMock).toHaveBeenCalledWith('management_journal_pages')
    expect(chain.eq).toHaveBeenCalledWith('page_type', 'shared')
    expect(chain.eq).toHaveBeenCalledWith('institution_id', 'inst-1')
    expect(chain.gt).toHaveBeenCalledWith('journal_date', '2026-08-18')
    expect(chain.eq).not.toHaveBeenCalledWith('owner_user_id', 'mgr-1')
  })

  it('detects freeze from a newer personal page for the same owner only', async () => {
    const chain = selectChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await expect(
      loadManagementJournalNewerPageExists({
        id: 'personal-old',
        institutionId: 'inst-1',
        journalDate: '2026-08-18',
        pageType: 'personal',
        ownerUserId: 'mgr-1',
        createdByUserId: 'mgr-1',
        createdAt: '2026-08-18T07:00:00.000Z',
        updatedAt: '2026-08-18T07:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: true, exists: false })

    expect(chain.eq).toHaveBeenCalledWith('page_type', 'personal')
    expect(chain.eq).toHaveBeenCalledWith('institution_id', 'inst-1')
    expect(chain.eq).toHaveBeenCalledWith('owner_user_id', 'mgr-1')
    expect(chain.gt).toHaveBeenCalledWith('journal_date', '2026-08-18')
  })
})
