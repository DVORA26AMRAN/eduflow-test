import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StaffDirectoryMember } from '../types/staffDirectory'
import { loadStaffDirectory } from '../services/staffDirectory'
import { StaffDirectoryFilters } from '../components/staff/StaffDirectoryFilters'
import { StaffDirectoryTable } from '../components/staff/StaffDirectoryTable'
import { StaffMemberDetailsModal } from '../components/staff/StaffMemberDetailsModal'
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

export function StaffDirectoryPage() {
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
    void refreshDirectory()
  }, [refreshDirectory])

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
      </DashboardSection>

      <StaffMemberDetailsModal
        isOpen={isDetailsOpen}
        memberId={selectedMemberId}
        onClose={handleDetailsClose}
      />
    </section>
  )
}
