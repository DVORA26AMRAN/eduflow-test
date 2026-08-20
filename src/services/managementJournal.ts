import type {
  AddManagementJournalParticipantResult,
  ManagementJournalCandidate,
  ManagementJournalErrorCode,
  ManagementJournalPage,
  ManagementJournalParticipant,
  ManagementJournalRole,
  ManagementJournalTask,
  ManagementJournalTaskStatus,
  MutateManagementJournalTaskResult,
  OpenManagementJournalPageResult,
} from '../types/managementJournal'
import {
  filterEligibleJournalParticipantCandidates,
  isManagementJournalPageType,
  isManagementJournalRole,
  isManagementJournalTaskStatus,
  MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_ERROR,
  MANAGEMENT_JOURNAL_MESSAGES,
  parseManagementJournalDateKey,
  sortManagementJournalTasks,
} from '../utils/managementJournalDisplay'
import { supabase, supabaseUrl } from './supabase'

const USERS_JOURNAL_SELECT = 'id, full_name, primary_role, status, institution_id'
const PAGES_SELECT =
  'id, institution_id, journal_date, page_type, owner_user_id, created_by_user_id, created_at, updated_at'
const PARTICIPANTS_SELECT = 'page_id, user_id, added_by_user_id, added_automatically, added_at'
const TASKS_SELECT =
  'id, page_id, institution_id, title, details, note, target_time, responsible_user_id, status, sort_order, created_by_user_id, created_at, updated_at, origin_task_id, origin_page_id, carried_forward'

function mapJournalError(
  error: { message?: string; code?: string } | null,
): ManagementJournalErrorCode {
  const message = `${error?.message ?? ''} ${error?.code ?? ''}`.toLowerCase()

  if (message.includes('journal_page_exists') || message.includes('23505')) {
    return 'JOURNAL_PAGE_EXISTS'
  }

  if (message.includes('journal_page_frozen')) {
    return 'JOURNAL_PAGE_FROZEN'
  }

  if (message.includes('journal_stale_status')) {
    return 'JOURNAL_STALE_STATUS'
  }

  if (message.includes('journal_invalid_argument') || message.includes('22023')) {
    return 'JOURNAL_INVALID_ARGUMENT'
  }

  if (message.includes('inactive')) {
    return 'INACTIVE_PROFILE'
  }

  if (
    message.includes('permission denied') ||
    message.includes('42501') ||
    message.includes('unauthorized')
  ) {
    return 'PERMISSION_DENIED'
  }

  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    error?.code === 'ECONNABORTED'
  ) {
    return 'NETWORK'
  }

  return 'UNKNOWN'
}

function failOpen(error: { message?: string; code?: string } | null): {
  ok: false
  errorCode: ManagementJournalErrorCode
  errorMessage: string
} {
  const errorCode = mapJournalError(error)
  return { ok: false, errorCode, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[errorCode] }
}

function parsePage(row: Record<string, unknown>): ManagementJournalPage | null {
  if (typeof row.id !== 'string' || typeof row.institution_id !== 'string') {
    return null
  }
  const journalDate = parseManagementJournalDateKey(row.journal_date)
  if (!journalDate || !isManagementJournalPageType(row.page_type)) {
    return null
  }
  if (
    typeof row.owner_user_id !== 'string' ||
    typeof row.created_by_user_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null
  }

  return {
    id: row.id,
    institutionId: row.institution_id,
    journalDate,
    pageType: row.page_type,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseSortOrder(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseTask(row: Record<string, unknown>): ManagementJournalTask | null {
  const sortOrder = parseSortOrder(row.sort_order)
  if (
    typeof row.id !== 'string' ||
    typeof row.page_id !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.title !== 'string' ||
    sortOrder === null ||
    typeof row.created_by_user_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string' ||
    !isManagementJournalTaskStatus(row.status)
  ) {
    return null
  }

  return {
    id: row.id,
    pageId: row.page_id,
    institutionId: row.institution_id,
    title: row.title,
    details: typeof row.details === 'string' ? row.details : null,
    note: typeof row.note === 'string' ? row.note : null,
    targetTime: typeof row.target_time === 'string' ? row.target_time : null,
    responsibleUserId: typeof row.responsible_user_id === 'string' ? row.responsible_user_id : null,
    status: row.status,
    sortOrder,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originTaskId: typeof row.origin_task_id === 'string' ? row.origin_task_id : null,
    originPageId: typeof row.origin_page_id === 'string' ? row.origin_page_id : null,
    carriedForward: row.carried_forward === true,
  }
}

function parseCandidate(row: Record<string, unknown>): ManagementJournalCandidate | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.full_name !== 'string' ||
    typeof row.institution_id !== 'string' ||
    typeof row.status !== 'string' ||
    !isManagementJournalRole(row.primary_role)
  ) {
    return null
  }

  return {
    id: row.id,
    fullName: row.full_name,
    primaryRole: row.primary_role,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    institutionId: row.institution_id,
  }
}

export async function loadManagementJournalCurrentDate(): Promise<
  { ok: true; journalDate: string } | { ok: false; errorCode: ManagementJournalErrorCode; errorMessage: string }
> {
  const { data, error } = await supabase.rpc('management_journal_current_date')

  if (error) {
    return failOpen(error)
  }

  const journalDate = parseManagementJournalDateKey(data)
  if (!journalDate) {
    return failOpen({ message: 'invalid date' })
  }

  return { ok: true, journalDate }
}

export async function loadManagementJournalPageById(
  pageId: string,
): Promise<
  { ok: true; page: ManagementJournalPage | null } | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('management_journal_pages')
    .select(PAGES_SELECT)
    .eq('id', pageId)
    .maybeSingle()

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  if (!data) {
    return { ok: true, page: null }
  }

  const page = parsePage(data as Record<string, unknown>)
  return { ok: true, page }
}

export async function loadTodayManagementJournalPage(input: {
  journalDate: string
  pageType: 'personal' | 'shared'
}): Promise<
  { ok: true; page: ManagementJournalPage | null } | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('management_journal_pages')
    .select(PAGES_SELECT)
    .eq('journal_date', input.journalDate)
    .eq('page_type', input.pageType)
    .maybeSingle()

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  if (!data) {
    return { ok: true, page: null }
  }

  const page = parsePage(data as Record<string, unknown>)
  return { ok: true, page }
}

export async function loadManagementJournalParticipants(
  pageId: string,
): Promise<
  { ok: true; participants: ManagementJournalParticipant[] } | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('management_journal_page_participants')
    .select(PARTICIPANTS_SELECT)
    .eq('page_id', pageId)

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const userIds = rows
    .map((row) => (typeof row.user_id === 'string' ? row.user_id : null))
    .filter((id): id is string => id !== null)

  const namesById = new Map<string, { fullName: string; primaryRole: ManagementJournalRole | null; status: string }>()

  if (userIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select(USERS_JOURNAL_SELECT)
      .in('id', userIds)

    if (usersError) {
      return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(usersError)] }
    }

    for (const row of (usersData ?? []) as Record<string, unknown>[]) {
      if (typeof row.id !== 'string' || typeof row.full_name !== 'string') {
        continue
      }
      namesById.set(row.id, {
        fullName: row.full_name,
        primaryRole: isManagementJournalRole(row.primary_role) ? row.primary_role : null,
        status: typeof row.status === 'string' ? row.status : 'active',
      })
    }
  }

  const participants: ManagementJournalParticipant[] = []
  for (const row of rows) {
    if (typeof row.page_id !== 'string' || typeof row.user_id !== 'string') {
      continue
    }
    const profile = namesById.get(row.user_id)
    participants.push({
      pageId: row.page_id,
      userId: row.user_id,
      addedByUserId: typeof row.added_by_user_id === 'string' ? row.added_by_user_id : null,
      addedAutomatically: row.added_automatically === true,
      addedAt: typeof row.added_at === 'string' ? row.added_at : '',
      fullName: profile?.fullName ?? 'משתתף',
      primaryRole: profile?.primaryRole ?? null,
      status: profile?.status ?? 'active',
    })
  }

  return { ok: true, participants }
}

export async function loadManagementJournalTasks(
  pageId: string,
): Promise<{ ok: true; tasks: ManagementJournalTask[] } | { ok: false; errorMessage: string }> {
  const { data, error } = await supabase
    .from('management_journal_tasks')
    .select(TASKS_SELECT)
    .eq('page_id', pageId)
    .order('sort_order', { ascending: true })

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  const tasks: ManagementJournalTask[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const task = parseTask(row)
    if (task) {
      tasks.push(task)
    }
  }

  return { ok: true, tasks: sortManagementJournalTasks(tasks) }
}

export async function loadEligibleManagementJournalParticipants(
  institutionId: string,
): Promise<
  { ok: true; candidates: ManagementJournalCandidate[] } | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('users')
    .select(USERS_JOURNAL_SELECT)
    .in('primary_role', ['institution_manager', 'deputy', 'secretary'])
    .eq('status', 'active')
    .eq('institution_id', institutionId)
    .order('full_name', { ascending: true })

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  const parsed: ManagementJournalCandidate[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const candidate = parseCandidate(row)
    if (candidate) {
      parsed.push(candidate)
    }
  }

  return {
    ok: true,
    candidates: filterEligibleJournalParticipantCandidates(parsed, institutionId),
  }
}

function parseOpenResult(data: unknown): OpenManagementJournalPageResult {
  if (!data || typeof data !== 'object') {
    return failOpen(null)
  }

  const payload = data as Record<string, unknown>
  if (payload.ok !== true) {
    return failOpen({ message: typeof payload.error === 'string' ? payload.error : 'unknown' })
  }

  const pageId = typeof payload.page_id === 'string' ? payload.page_id : null
  const journalDate = parseManagementJournalDateKey(payload.journal_date)
  if (!pageId || !journalDate || !isManagementJournalPageType(payload.page_type)) {
    return failOpen(null)
  }

  return {
    ok: true,
    unchanged: payload.unchanged === true,
    pageId,
    pageType: payload.page_type,
    journalDate,
    carriedTaskCount: typeof payload.carried_task_count === 'number' ? payload.carried_task_count : 0,
  }
}

export async function openPersonalManagementJournalPage(): Promise<OpenManagementJournalPageResult> {
  const { data, error } = await supabase.rpc('create_management_journal_personal_page')

  if (error) {
    return failOpen(error)
  }

  return parseOpenResult(data)
}

export async function openSharedManagementJournalPage(
  participantUserIds: string[],
): Promise<OpenManagementJournalPageResult> {
  const { data, error } = await supabase.rpc('create_management_journal_shared_page', {
    p_participant_user_ids: participantUserIds,
  })

  if (error) {
    return failOpen(error)
  }

  return parseOpenResult(data)
}

export async function addManagementJournalPageParticipant(
  pageId: string,
  userId: string,
): Promise<AddManagementJournalParticipantResult> {
  const { data, error } = await supabase.rpc('add_management_journal_page_participant', {
    p_page_id: pageId,
    p_user_id: userId,
  })

  if (error) {
    return failOpen(error)
  }

  if (!data || typeof data !== 'object') {
    return failOpen(null)
  }

  const payload = data as Record<string, unknown>
  if (payload.ok !== true || typeof payload.page_id !== 'string' || typeof payload.user_id !== 'string') {
    return failOpen({ message: typeof payload.error === 'string' ? payload.error : 'unknown' })
  }

  return {
    ok: true,
    pageId: payload.page_id,
    userId: payload.user_id,
    added: payload.added === true,
  }
}

export async function loadManagementJournalNewerPageExists(
  page: ManagementJournalPage,
): Promise<{ ok: true; exists: boolean } | { ok: false; errorMessage: string }> {
  let query = supabase
    .from('management_journal_pages')
    .select('id')
    .eq('page_type', page.pageType)
    .eq('institution_id', page.institutionId)
    .gt('journal_date', page.journalDate)

  if (page.pageType === 'personal') {
    query = query.eq('owner_user_id', page.ownerUserId)
  }

  const { data, error } = await query.limit(1)

  if (error) {
    return { ok: false, errorMessage: MANAGEMENT_JOURNAL_MESSAGES[mapJournalError(error)] }
  }

  return { ok: true, exists: Array.isArray(data) && data.length > 0 }
}

function parseTaskMutation(data: unknown, error: { message?: string; code?: string } | null): MutateManagementJournalTaskResult {
  if (error) {
    return failOpen(error)
  }
  if (!data || typeof data !== 'object') {
    return failOpen(null)
  }
  const payload = data as Record<string, unknown>
  if (payload.ok !== true || typeof payload.task_id !== 'string') {
    return failOpen({ message: typeof payload.error === 'string' ? payload.error : 'unknown' })
  }
  return { ok: true, taskId: payload.task_id }
}

export async function createManagementJournalTask(input: {
  pageId: string
  title: string
  responsibleUserId: string
  details?: string | null
  targetTime?: string | null
}): Promise<MutateManagementJournalTaskResult> {
  const { data, error } = await supabase.rpc('create_management_journal_task', {
    p_page_id: input.pageId,
    p_title: input.title,
    p_responsible_user_id: input.responsibleUserId,
    p_details: input.details ?? null,
    p_target_time: input.targetTime || null,
  })

  return parseTaskMutation(data, error)
}

export async function updateManagementJournalTaskContent(input: {
  taskId: string
  title: string
  details?: string | null
  targetTime?: string | null
}): Promise<MutateManagementJournalTaskResult> {
  const { data, error } = await supabase.rpc('update_management_journal_task_content', {
    p_task_id: input.taskId,
    p_title: input.title,
    p_details: input.details ?? null,
    p_target_time: input.targetTime || null,
  })

  return parseTaskMutation(data, error)
}

export async function updateManagementJournalTaskNote(
  taskId: string,
  note: string | null,
): Promise<MutateManagementJournalTaskResult> {
  const { data, error } = await supabase.rpc('update_management_journal_task_note', {
    p_task_id: taskId,
    p_note: note,
  })

  return parseTaskMutation(data, error)
}

export async function assignManagementJournalTask(
  taskId: string,
  targetUserId: string,
): Promise<MutateManagementJournalTaskResult> {
  const { data, error } = await supabase.rpc('assign_management_journal_task', {
    p_task_id: taskId,
    p_target_user_id: targetUserId,
  })

  return parseTaskMutation(data, error)
}

export async function updateManagementJournalTaskStatus(input: {
  taskId: string
  expectedStatus: ManagementJournalTaskStatus
  newStatus: ManagementJournalTaskStatus
}): Promise<MutateManagementJournalTaskResult> {
  const { data, error } = await supabase.rpc('update_management_journal_task_status', {
    p_task_id: input.taskId,
    p_expected_status: input.expectedStatus,
    p_new_status: input.newStatus,
  })

  return parseTaskMutation(data, error)
}

export type DownloadManagementJournalDailySummaryPdfResult =
  | { ok: true; filename: string }
  | { ok: false; errorMessage: string; errorCode?: string }

function triggerPdfBytesDownload(filename: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], { type: 'application/pdf' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim())
    } catch {
      return utfMatch[1].trim()
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header)
  return plainMatch?.[1]?.trim() ?? null
}

/**
 * Request a transient daily-summary PDF for a readable journal page.
 * Sends page_id only — server reloads authoritative data under J1 RLS.
 */
export async function downloadManagementJournalDailySummaryPdf(
  pageId: string,
): Promise<DownloadManagementJournalDailySummaryPdfResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (sessionError || !accessToken) {
    return {
      ok: false,
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.PERMISSION_DENIED,
      errorCode: 'unauthorized',
    }
  }

  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/management-journal-daily-summary-pdf`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_id: pageId }),
    })
  } catch {
    return {
      ok: false,
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.NETWORK,
      errorCode: 'network',
    }
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  if (response.ok && contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (bytes.byteLength < 5) {
      return {
        ok: false,
        errorMessage: MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_ERROR,
        errorCode: 'invalid_pdf',
      }
    }
    const filename =
      parseContentDispositionFilename(response.headers.get('Content-Disposition')) ??
      'management-journal.pdf'
    triggerPdfBytesDownload(filename, bytes)
    return { ok: true, filename }
  }

  let body: Record<string, unknown>
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const code = typeof body.error === 'string' ? body.error : ''
  if (code === 'unauthorized' || response.status === 401) {
    return {
      ok: false,
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.PERMISSION_DENIED,
      errorCode: code || 'unauthorized',
    }
  }
  if (code === 'forbidden' || code === 'inactive' || response.status === 403) {
    return {
      ok: false,
      errorMessage: MANAGEMENT_JOURNAL_MESSAGES.PERMISSION_DENIED,
      errorCode: code || 'forbidden',
    }
  }
  if (code.startsWith('pdf_')) {
    return {
      ok: false,
      errorMessage: MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_ERROR,
      errorCode: code,
    }
  }
  return {
    ok: false,
    errorMessage: MANAGEMENT_JOURNAL_DAILY_SUMMARY_PDF_ERROR,
    errorCode: code || undefined,
  }
}
