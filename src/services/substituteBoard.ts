import type {
  CreateSubstituteBoardPostInput,
  SubstituteBoardPendingApproval,
  SubstituteBoardPost,
  SubstituteBoardResponse,
} from '../types/substituteBoard'
import {
  SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
  SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
} from '../types/substituteBoard'
import {
  isSubstituteBoardPostStatus,
  isSubstituteBoardPostType,
  formatSubstituteBoardDate,
  normalizeOptionalText,
  normalizeOptionalTime,
} from '../utils/substituteBoard'
import type { SubstituteBoardApprovedNotificationRole } from '../types/notification'
import { NOTIFICATION_TYPE_SUBSTITUTE_BOARD_APPROVED } from '../types/notification'
import { supabase } from './supabase'

type SubstituteBoardPostApprovalDetails = {
  id: string
  institution_id: string
  created_by_user_id: string
  selected_teacher_user_id: string
  date: string
}

export type LoadSubstituteBoardPostsResult =
  | { ok: true; posts: SubstituteBoardPost[]; currentUserId: string }
  | { ok: false; errorMessage: string }

export type CreateSubstituteBoardPostResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type CreateSubstituteBoardResponseResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type LoadSubstituteBoardResponsePostIdsResult =
  | { ok: true; postIds: ReadonlySet<string> }
  | { ok: false; errorMessage: string }

export type LoadSubstituteBoardPostResponsesResult =
  | { ok: true; responses: SubstituteBoardResponse[] }
  | { ok: false; errorMessage: string }

export type SubmitSubstituteBoardPostForApprovalResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export type LoadPendingSubstituteBoardApprovalsResult =
  | { ok: true; approvals: SubstituteBoardPendingApproval[] }
  | { ok: false; errorMessage: string }

export type ApproveSubstituteBoardPostResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

async function loadCurrentUserInstitutionId(
  userId: string,
): Promise<{ ok: true; institutionId: string } | { ok: false }> {
  const { data, error } = await supabase
    .from('users')
    .select('institution_id')
    .eq('id', userId)
    .single()

  if (error || typeof data?.institution_id !== 'string') {
    console.error('[substituteBoard] failed to load institution_id', error)
    return { ok: false }
  }

  return { ok: true, institutionId: data.institution_id }
}

function extractTeacherFullName(users: unknown): string | null {
  if (Array.isArray(users)) {
    const first = users[0] as { full_name?: unknown } | undefined
    return typeof first?.full_name === 'string' ? first.full_name : null
  }

  if (users && typeof users === 'object' && 'full_name' in users) {
    const fullName = (users as { full_name: unknown }).full_name
    return typeof fullName === 'string' ? fullName : null
  }

  return null
}

function parseSubstituteBoardPost(row: {
  id: unknown
  post_type: unknown
  status: unknown
  date: unknown
  start_time: unknown
  end_time: unknown
  class_name: unknown
  subject: unknown
  description: unknown
  created_by_user_id: unknown
  created_at: unknown
  users: unknown
}): SubstituteBoardPost | null {
  const teacherFullName = extractTeacherFullName(row.users)

  if (
    typeof row.id !== 'string' ||
    typeof row.date !== 'string' ||
    typeof row.created_by_user_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.post_type !== 'string' ||
    typeof row.status !== 'string' ||
    teacherFullName === null ||
    !isSubstituteBoardPostType(row.post_type) ||
    !isSubstituteBoardPostStatus(row.status)
  ) {
    return null
  }

  return {
    id: row.id,
    post_type: row.post_type,
    status: row.status,
    date: row.date,
    start_time: typeof row.start_time === 'string' ? row.start_time : null,
    end_time: typeof row.end_time === 'string' ? row.end_time : null,
    class_name: typeof row.class_name === 'string' ? row.class_name : null,
    subject: typeof row.subject === 'string' ? row.subject : null,
    description: typeof row.description === 'string' ? row.description : null,
    created_by_user_id: row.created_by_user_id,
    teacher_full_name: teacherFullName,
    created_at: row.created_at,
  }
}

export async function loadSubstituteBoardPosts(): Promise<LoadSubstituteBoardPostsResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for load', sessionError)
    return {
      ok: false,
      errorMessage: 'טעינת לוח מילויי מקום נכשלה.',
    }
  }

  const currentUserId = sessionData.session.user.id

  const { data, error } = await supabase
    .from('substitute_board_posts')
    .select(
      'id, post_type, status, date, start_time, end_time, class_name, subject, description, created_by_user_id, created_at, users!created_by_user_id(full_name)',
    )
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[substituteBoard] failed to load posts', error)
    return {
      ok: false,
      errorMessage: 'טעינת לוח מילויי מקום נכשלה.',
    }
  }

  const posts = (data ?? [])
    .map(parseSubstituteBoardPost)
    .filter((post): post is SubstituteBoardPost => post !== null)

  return { ok: true, posts, currentUserId }
}

export async function loadSubstituteBoardResponsePostIds(): Promise<LoadSubstituteBoardResponsePostIdsResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for responses', sessionError)
    return {
      ok: false,
      errorMessage: 'טעינת לוח מילויי מקום נכשלה.',
    }
  }

  const { data, error } = await supabase
    .from('substitute_board_responses')
    .select('post_id')
    .eq('teacher_user_id', sessionData.session.user.id)

  if (error) {
    console.error('[substituteBoard] failed to load response post ids', error)
    return {
      ok: false,
      errorMessage: 'טעינת לוח מילויי מקום נכשלה.',
    }
  }

  const postIds = new Set<string>()

  for (const row of data ?? []) {
    if (typeof row.post_id === 'string') {
      postIds.add(row.post_id)
    }
  }

  return { ok: true, postIds }
}

export async function createSubstituteBoardPost(
  input: CreateSubstituteBoardPostInput,
): Promise<CreateSubstituteBoardPostResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for create', sessionError)
    return {
      ok: false,
      errorMessage: 'יצירת הפרסום נכשלה.',
    }
  }

  const userId = sessionData.session.user.id
  const institutionResult = await loadCurrentUserInstitutionId(userId)

  if (!institutionResult.ok) {
    return {
      ok: false,
      errorMessage: 'יצירת הפרסום נכשלה.',
    }
  }

  const { error } = await supabase.from('substitute_board_posts').insert({
    institution_id: institutionResult.institutionId,
    created_by_user_id: userId,
    post_type: input.postType,
    date: input.date,
    start_time: normalizeOptionalTime(input.startTime),
    end_time: normalizeOptionalTime(input.endTime),
    class_name: normalizeOptionalText(input.className),
    subject: normalizeOptionalText(input.subject),
    description: normalizeOptionalText(input.description),
  })

  if (error) {
    console.error('[substituteBoard] failed to create post', error)
    return {
      ok: false,
      errorMessage: 'יצירת הפרסום נכשלה.',
    }
  }

  return { ok: true }
}

export async function createSubstituteBoardResponse(
  postId: string,
): Promise<CreateSubstituteBoardResponseResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for response', sessionError)
    return {
      ok: false,
      errorMessage: 'שליחת התגובה נכשלה.',
    }
  }

  const userId = sessionData.session.user.id
  const institutionResult = await loadCurrentUserInstitutionId(userId)

  if (!institutionResult.ok) {
    return {
      ok: false,
      errorMessage: 'שליחת התגובה נכשלה.',
    }
  }

  const { error } = await supabase.from('substitute_board_responses').insert({
    post_id: postId,
    institution_id: institutionResult.institutionId,
    teacher_user_id: userId,
    response_text: null,
  })

  if (error) {
    console.error('[substituteBoard] failed to create response', error)
    return {
      ok: false,
      errorMessage: 'שליחת התגובה נכשלה.',
    }
  }

  return { ok: true }
}

function parseSubstituteBoardResponse(row: {
  id: unknown
  post_id: unknown
  teacher_user_id: unknown
  response_text: unknown
  created_at: unknown
  users: unknown
}): SubstituteBoardResponse | null {
  const teacherFullName = extractTeacherFullName(row.users)

  if (
    typeof row.id !== 'string' ||
    typeof row.post_id !== 'string' ||
    typeof row.teacher_user_id !== 'string' ||
    typeof row.created_at !== 'string' ||
    teacherFullName === null
  ) {
    return null
  }

  return {
    id: row.id,
    post_id: row.post_id,
    teacher_user_id: row.teacher_user_id,
    teacher_full_name: teacherFullName,
    response_text: typeof row.response_text === 'string' ? row.response_text : null,
    created_at: row.created_at,
  }
}

export async function loadSubstituteBoardPostResponses(
  postId: string,
): Promise<LoadSubstituteBoardPostResponsesResult> {
  const { data, error } = await supabase
    .from('substitute_board_responses')
    .select(
      'id, post_id, teacher_user_id, response_text, created_at, users!teacher_user_id(full_name)',
    )
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[substituteBoard] failed to load post responses', error)
    return {
      ok: false,
      errorMessage: SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const responses = (data ?? [])
    .map(parseSubstituteBoardResponse)
    .filter((response): response is SubstituteBoardResponse => response !== null)

  return { ok: true, responses }
}

export async function submitSubstituteBoardPostForApproval(input: {
  postId: string
  selectedTeacherUserId: string
}): Promise<SubmitSubstituteBoardPostForApprovalResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for approval', sessionError)
    return {
      ok: false,
      errorMessage: SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const currentUserId = sessionData.session.user.id

  if (input.selectedTeacherUserId === currentUserId) {
    return {
      ok: false,
      errorMessage: SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const { error } = await supabase
    .from('substitute_board_posts')
    .update({
      selected_teacher_user_id: input.selectedTeacherUserId,
      status: 'pending_secretary_approval',
    })
    .eq('id', input.postId)
    .eq('created_by_user_id', currentUserId)
    .eq('status', 'open')

  if (error) {
    console.error('[substituteBoard] failed to submit post for approval', error)
    return {
      ok: false,
      errorMessage: SUBSTITUTE_BOARD_APPROVAL_FAILURE_MESSAGE,
    }
  }

  return { ok: true }
}

function parseSubstituteBoardPendingApproval(row: {
  id: unknown
  date: unknown
  start_time: unknown
  end_time: unknown
  class_name: unknown
  subject: unknown
  description: unknown
  created_by_user: unknown
  selected_teacher_user: unknown
}): SubstituteBoardPendingApproval | null {
  const createdByFullName = extractTeacherFullName(row.created_by_user)
  const selectedTeacherFullName = extractTeacherFullName(row.selected_teacher_user)

  if (
    typeof row.id !== 'string' ||
    typeof row.date !== 'string' ||
    createdByFullName === null ||
    selectedTeacherFullName === null
  ) {
    return null
  }

  return {
    id: row.id,
    date: row.date,
    start_time: typeof row.start_time === 'string' ? row.start_time : null,
    end_time: typeof row.end_time === 'string' ? row.end_time : null,
    class_name: typeof row.class_name === 'string' ? row.class_name : null,
    subject: typeof row.subject === 'string' ? row.subject : null,
    description: typeof row.description === 'string' ? row.description : null,
    created_by_full_name: createdByFullName,
    selected_teacher_full_name: selectedTeacherFullName,
  }
}

export async function loadPendingSubstituteBoardApprovals(): Promise<LoadPendingSubstituteBoardApprovalsResult> {
  const { data, error } = await supabase
    .from('substitute_board_posts')
    .select(
      'id, date, start_time, end_time, class_name, subject, description, created_by_user:users!created_by_user_id(full_name), selected_teacher_user:users!selected_teacher_user_id(full_name)',
    )
    .eq('status', 'pending_secretary_approval')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[substituteBoard] failed to load pending approvals', error)
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const approvals = (data ?? [])
    .map(parseSubstituteBoardPendingApproval)
    .filter((approval): approval is SubstituteBoardPendingApproval => approval !== null)

  return { ok: true, approvals }
}

function parseSubstituteBoardPostApprovalDetails(
  row: unknown,
): SubstituteBoardPostApprovalDetails | null {
  if (!row || typeof row !== 'object') {
    return null
  }

  const candidate = row as {
    id?: unknown
    institution_id?: unknown
    created_by_user_id?: unknown
    selected_teacher_user_id?: unknown
    date?: unknown
  }

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.institution_id !== 'string' ||
    typeof candidate.created_by_user_id !== 'string' ||
    typeof candidate.selected_teacher_user_id !== 'string' ||
    typeof candidate.date !== 'string'
  ) {
    return null
  }

  return {
    id: candidate.id,
    institution_id: candidate.institution_id,
    created_by_user_id: candidate.created_by_user_id,
    selected_teacher_user_id: candidate.selected_teacher_user_id,
    date: candidate.date,
  }
}

async function loadSubstituteBoardPostApprovalDetails(
  postId: string,
): Promise<
  | { ok: true; post: SubstituteBoardPostApprovalDetails }
  | { ok: false; errorMessage: string }
> {
  const { data, error } = await supabase
    .from('substitute_board_posts')
    .select('id, institution_id, created_by_user_id, selected_teacher_user_id, date')
    .eq('id', postId)
    .eq('status', 'pending_secretary_approval')
    .maybeSingle()

  if (error) {
    console.error('[substituteBoard] failed to load post for approval notifications', error)
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const post = parseSubstituteBoardPostApprovalDetails(data)

  if (!post) {
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  return { ok: true, post }
}

function buildSubstituteBoardApprovalNotificationContent(
  date: string,
  role: SubstituteBoardApprovedNotificationRole,
): { title: string; message: string } {
  const formattedDate = formatSubstituteBoardDate(date)

  if (role === 'requester') {
    return {
      title: 'מילוי המקום אושר',
      message: `מילוי המקום שלך ליום ${formattedDate} אושר.`,
    }
  }

  return {
    title: 'אושרת כמחליפה',
    message: `אושרת כמחליפה ליום ${formattedDate}.`,
  }
}

async function insertSubstituteBoardApprovalNotification(input: {
  institutionId: string
  userId: string
  postId: string
  date: string
  role: SubstituteBoardApprovedNotificationRole
}): Promise<void> {
  const { title, message } = buildSubstituteBoardApprovalNotificationContent(
    input.date,
    input.role,
  )

  const { error } = await supabase.from('notifications').insert({
    institution_id: input.institutionId,
    user_id: input.userId,
    notification_type: NOTIFICATION_TYPE_SUBSTITUTE_BOARD_APPROVED,
    title,
    message,
    metadata: {
      substitute_board_post_id: input.postId,
      notification_role: input.role,
    },
  })

  if (error) {
    console.error('[substituteBoard] failed to create approval notification', {
      error,
      postId: input.postId,
      userId: input.userId,
      role: input.role,
    })
  }
}

async function createSubstituteBoardApprovalNotifications(
  post: SubstituteBoardPostApprovalDetails,
): Promise<void> {
  await insertSubstituteBoardApprovalNotification({
    institutionId: post.institution_id,
    userId: post.created_by_user_id,
    postId: post.id,
    date: post.date,
    role: 'requester',
  })

  if (post.selected_teacher_user_id !== post.created_by_user_id) {
    await insertSubstituteBoardApprovalNotification({
      institutionId: post.institution_id,
      userId: post.selected_teacher_user_id,
      postId: post.id,
      date: post.date,
      role: 'substitute',
    })
  }
}

export async function approveSubstituteBoardPost(
  postId: string,
): Promise<ApproveSubstituteBoardPostResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.user) {
    console.error('[substituteBoard] no authenticated session for secretary approval', sessionError)
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  const postDetailsResult = await loadSubstituteBoardPostApprovalDetails(postId)

  if (!postDetailsResult.ok) {
    return {
      ok: false,
      errorMessage: postDetailsResult.errorMessage,
    }
  }

  const currentUserId = sessionData.session.user.id

  const { data: updatedPost, error } = await supabase
    .from('substitute_board_posts')
    .update({
      status: 'approved',
      approved_by_user_id: currentUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .eq('status', 'pending_secretary_approval')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[substituteBoard] failed to approve post', error)
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  if (!updatedPost) {
    console.error('[substituteBoard] approval update did not match a pending post', { postId })
    return {
      ok: false,
      errorMessage: SECRETARY_SUBSTITUTE_APPROVAL_FAILURE_MESSAGE,
    }
  }

  await createSubstituteBoardApprovalNotifications(postDetailsResult.post)

  return { ok: true }
}
