export type ManagementJournalPageType = 'personal' | 'shared'

export type ManagementJournalTaskStatus = 'new' | 'in_progress' | 'completed' | 'blocked'

export type ManagementJournalRole = 'institution_manager' | 'deputy' | 'secretary'

export type ManagementJournalPage = {
  id: string
  institutionId: string
  journalDate: string
  pageType: ManagementJournalPageType
  ownerUserId: string
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export type ManagementJournalParticipant = {
  pageId: string
  userId: string
  addedByUserId: string | null
  addedAutomatically: boolean
  addedAt: string
  fullName: string
  primaryRole: ManagementJournalRole | null
  status: string
}

export type ManagementJournalTask = {
  id: string
  pageId: string
  institutionId: string
  title: string
  details: string | null
  note: string | null
  targetTime: string | null
  responsibleUserId: string | null
  status: ManagementJournalTaskStatus
  sortOrder: number
  createdByUserId: string
  createdAt: string
  updatedAt: string
  originTaskId: string | null
  originPageId: string | null
  carriedForward: boolean
}

export type ManagementJournalCandidate = {
  id: string
  fullName: string
  primaryRole: ManagementJournalRole
  status: 'active' | 'inactive'
  institutionId: string
}

export type ManagementJournalErrorCode =
  | 'PERMISSION_DENIED'
  | 'JOURNAL_PAGE_EXISTS'
  | 'JOURNAL_PAGE_FROZEN'
  | 'JOURNAL_STALE_STATUS'
  | 'JOURNAL_INVALID_ARGUMENT'
  | 'INACTIVE_PROFILE'
  | 'NETWORK'
  | 'UNKNOWN'

export type MutateManagementJournalTaskResult =
  | { ok: true; taskId: string }
  | { ok: false; errorCode: ManagementJournalErrorCode; errorMessage: string }

export type OpenManagementJournalPageResult =
  | {
      ok: true
      unchanged: boolean
      pageId: string
      pageType: ManagementJournalPageType
      journalDate: string
      carriedTaskCount: number
    }
  | { ok: false; errorCode: ManagementJournalErrorCode; errorMessage: string }

export type AddManagementJournalParticipantResult =
  | { ok: true; pageId: string; userId: string; added: boolean }
  | { ok: false; errorCode: ManagementJournalErrorCode; errorMessage: string }
