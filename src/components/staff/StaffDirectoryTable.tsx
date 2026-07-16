import type { StaffDirectoryMember } from '../../types/staffDirectory'
import type {
  StaffDirectorySortDirection,
  StaffDirectorySortKey,
} from '../../utils/staffDirectoryDisplay'
import {
  formatStaffJobTitle,
  formatWeeklyHours,
  translateStaffMemberStatus,
} from '../../utils/staffDirectoryDisplay'

type StaffDirectoryTableProps = {
  members: StaffDirectoryMember[]
  sortKey: StaffDirectorySortKey
  sortDirection: StaffDirectorySortDirection
  onSortChange: (sortKey: StaffDirectorySortKey) => void
  onMemberSelect: (memberId: string) => void
}

function sortIndicator(
  columnKey: StaffDirectorySortKey,
  activeKey: StaffDirectorySortKey,
  direction: StaffDirectorySortDirection,
): string {
  if (columnKey !== activeKey) {
    return ''
  }
  return direction === 'asc' ? ' ↑' : ' ↓'
}

export function StaffDirectoryTable({
  members,
  sortKey,
  sortDirection,
  onSortChange,
  onMemberSelect,
}: StaffDirectoryTableProps) {
  return (
    <div className="ds-table-wrapper staff-directory__table-wrapper">
      <table className="ds-table staff-directory__table">
        <thead>
          <tr>
            <th scope="col">
              <button
                type="button"
                className="staff-directory__sort-button"
                onClick={() => onSortChange('fullName')}
              >
                שם מלא{sortIndicator('fullName', sortKey, sortDirection)}
              </button>
            </th>
            <th scope="col">
              <button
                type="button"
                className="staff-directory__sort-button"
                onClick={() => onSortChange('jobTitle')}
              >
                תפקיד{sortIndicator('jobTitle', sortKey, sortDirection)}
              </button>
            </th>
            <th scope="col">טלפון</th>
            <th scope="col">
              <button
                type="button"
                className="staff-directory__sort-button"
                onClick={() => onSortChange('weeklyHours')}
              >
                היקף משרה בשעות{sortIndicator('weeklyHours', sortKey, sortDirection)}
              </button>
            </th>
            <th scope="col">מייל</th>
            <th scope="col">סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>
                <button
                  type="button"
                  className="staff-directory__row-button"
                  onClick={() => onMemberSelect(member.id)}
                >
                  {member.fullName}
                </button>
              </td>
              <td>{formatStaffJobTitle(member.jobTitle)}</td>
              <td>{member.phone?.trim() || '—'}</td>
              <td>{formatWeeklyHours(member.weeklyHours)}</td>
              <td>{member.email}</td>
              <td>
                <span
                  className={
                    member.status === 'active'
                      ? 'staff-directory__status staff-directory__status--active'
                      : 'staff-directory__status staff-directory__status--inactive'
                  }
                >
                  {translateStaffMemberStatus(member.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
