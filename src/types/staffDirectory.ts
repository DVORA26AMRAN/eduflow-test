export type StaffMemberStatus = 'active' | 'inactive' | string

export type StaffDirectoryMember = {
  id: string
  fullName: string
  email: string
  phone: string | null
  jobTitle: string | null
  weeklyHours: number | null
  status: StaffMemberStatus
  createdAt: string
}

export type StaffMemberDetails = StaffDirectoryMember & {
  nationalId: string | null
}

export type UpdateStaffMemberInput = {
  userId: string
  fullName: string
  phone: string | null
  jobTitle: string | null
  weeklyHours: number | null
  nationalId: string | null
}

export type LoadStaffDirectoryResult =
  | { ok: true; members: StaffDirectoryMember[] }
  | { ok: false; errorMessage: string }

export type LoadStaffMemberDetailsResult =
  | { ok: true; member: StaffMemberDetails }
  | { ok: false; errorMessage: string }

export type UpdateStaffMemberResult =
  | { ok: true }
  | { ok: false; errorMessage: string }
