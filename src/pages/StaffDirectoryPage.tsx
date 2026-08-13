import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StaffDirectoryMember } from '../types/staffDirectory'
import type { UserRole } from '../types/user'
import { loadStaffDirectory } from '../services/staffDirectory'
import { StaffDirectoryFilters } from '../components/staff/StaffDirectoryFilters'
import { StaffDirectoryTable } from '../components/staff/StaffDirectoryTable'
import { StaffMemberDetailsModal } from '../components/staff/StaffMemberDetailsModal'
import { CreateUserForm } from '../components/manager/CreateUserForm'
import { NavClipboardIcon } from '../components/dashboard/dashboardNav'
import { DashboardSection } from '../components/dashboard/DashboardSection'
import {
  STAFF_DIRECTORY_EMPTY_MESSAGE,
  STAFF_DIRECTORY_ERROR_MESSAGE,
  STAFF_DIRECTORY_LOADING_MESSAGE,
  STAFF_DIRECTORY_NAV_LABEL,
  filterStaffDirectoryMembers,
  sortStaffDirectoryMembers,
  type StaffDirectorySortDirection,
  type StaffDirectorySortKey,
} from '../utils/staffDirectoryDisplay'
import '../components/staff/StaffDirectory.css'
import './StaffDirectoryPage.css'

export type StaffDirectoryTeacherOnboardingProps = {
  newUserName: string
  newUserEmail: string
  newUserRole: UserRole
  newUserPhone: string
  newUserNationalId: string
  newUserJobTitle: string
  newUserWeeklyHours: string
  createUserMessage: string
  allowedRoles: readonly UserRole[]
  onNewUserNameChange: (value: string) => void
  onNewUserEmailChange: (value: string) => void
  onNewUserRoleChange: (value: UserRole) => void
  onNewUserPhoneChange: (value: string) => void
  onNewUserNationalIdChange: (value: string) => void
  onNewUserJobTitleChange: (value: string) => void
  onNewUserWeeklyHoursChange: (value: string) => void
  onCreateUser: () => void
}

type StaffDirectoryPageProps = {
  canEdit: boolean
  institutionName: string
  teacherOnboarding?: StaffDirectoryTeacherOnboardingProps
}

export function StaffDirectoryPage({
  canEdit,
  institutionName,
  teacherOnboarding,
}: StaffDirectoryPageProps) {
  const [members, setMembers] = useState<StaffDirectoryMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<StaffDirectorySortKey>('fullName')
  const [sortDirection, setSortDirection] = useState<StaffDirectorySortDirection>('asc')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const refreshDirectory = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    const result = await loadStaffDirectory()

    if (!result.ok) {
      setMembers([])
      setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
      setIsLoading(false)
      return
    }

    setMembers(result.members)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    if (import.meta.env.DEV) {
      console.debug('[StaffDirectoryPage] mounted')
    }

    void (async () => {
      try {
        const result = await loadStaffDirectory()
        if (cancelled) {
          return
        }

        if (!result.ok) {
          setMembers([])
          setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
          setIsLoading(false)
          return
        }

        setMembers(result.members)
        setIsLoading(false)
      } catch (error) {
        if (cancelled) {
          return
        }

        console.error('[StaffDirectoryPage] loadStaffDirectory() threw', error)
        setMembers([])
        setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
        setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const visibleMembers = useMemo(() => {
    const filtered = filterStaffDirectoryMembers(members, searchQuery)
    return sortStaffDirectoryMembers(filtered, sortKey, sortDirection)
  }, [members, searchQuery, sortKey, sortDirection])

  function handleSortChange(nextSortKey: StaffDirectorySortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(nextSortKey)
    setSortDirection('asc')
  }

  function handleMemberSelect(memberId: string) {
    setSelectedMemberId(memberId)
    setIsDetailsOpen(true)
  }

  function handleDetailsClose() {
    setIsDetailsOpen(false)
    setSelectedMemberId(null)
  }

  return (
    <section className="ds-card staff-directory-page" data-testid="staff-directory">
      <DashboardSection
        title={STAFF_DIRECTORY_NAV_LABEL}
        icon={<NavClipboardIcon />}
        className="dashboard-section--flush-header"
      >
        <StaffDirectoryFilters searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />

        {isLoading ? <p className="ds-form-message">{STAFF_DIRECTORY_LOADING_MESSAGE}</p> : null}

        {!isLoading && errorMessage ? (
          <p className="ds-form-message ds-form-message--error">{errorMessage}</p>
        ) : null}

        {!isLoading && !errorMessage && visibleMembers.length === 0 ? (
          <p className="ds-form-message">{STAFF_DIRECTORY_EMPTY_MESSAGE}</p>
        ) : null}

        {!isLoading && !errorMessage && visibleMembers.length > 0 ? (
          <StaffDirectoryTable
            members={visibleMembers}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onMemberSelect={handleMemberSelect}
          />
        ) : null}

        {teacherOnboarding ? (
          <CreateUserForm
            newUserName={teacherOnboarding.newUserName}
            newUserEmail={teacherOnboarding.newUserEmail}
            newUserRole={teacherOnboarding.newUserRole}
            newUserPhone={teacherOnboarding.newUserPhone}
            newUserNationalId={teacherOnboarding.newUserNationalId}
            newUserJobTitle={teacherOnboarding.newUserJobTitle}
            newUserWeeklyHours={teacherOnboarding.newUserWeeklyHours}
            message={teacherOnboarding.createUserMessage}
            allowedRoles={teacherOnboarding.allowedRoles}
            onNewUserNameChange={teacherOnboarding.onNewUserNameChange}
            onNewUserEmailChange={teacherOnboarding.onNewUserEmailChange}
            onNewUserRoleChange={teacherOnboarding.onNewUserRoleChange}
            onNewUserPhoneChange={teacherOnboarding.onNewUserPhoneChange}
            onNewUserNationalIdChange={teacherOnboarding.onNewUserNationalIdChange}
            onNewUserJobTitleChange={teacherOnboarding.onNewUserJobTitleChange}
            onNewUserWeeklyHoursChange={teacherOnboarding.onNewUserWeeklyHoursChange}
            onCreateUser={teacherOnboarding.onCreateUser}
          />
        ) : null}
      </DashboardSection>

      <StaffMemberDetailsModal
        isOpen={isDetailsOpen}
        memberId={selectedMemberId}
        canEdit={canEdit}
        institutionName={institutionName}
        onUpdated={refreshDirectory}
        onClose={handleDetailsClose}
      />
    </section>
  )
}
