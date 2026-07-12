import type { ManagerRecentRequest } from './analytics'
import type { SecretaryInboxRequest, TeacherRequest } from './request'

export type RequestDetailsRole = 'teacher' | 'secretary' | 'manager'

export type RequestDetailsTeacherRequest = TeacherRequest & {
  role: 'teacher'
}

export type RequestDetailsSecretaryRequest = SecretaryInboxRequest & {
  role: 'secretary'
}

export type RequestDetailsManagerRequest = ManagerRecentRequest & {
  role: 'manager'
}

export type RequestDetailsRequest =
  | RequestDetailsTeacherRequest
  | RequestDetailsSecretaryRequest
  | RequestDetailsManagerRequest
