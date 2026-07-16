import { useEffect, useState } from 'react'
import type { StaffMemberDetails } from '../../types/staffDirectory'
import { loadStaffMemberDetails } from '../../services/staffDirectory'
import {
  STAFF_DIRECTORY_ERROR_MESSAGE,
  STAFF_MEMBER_DETAILS_LOADING_MESSAGE,
  formatStaffJobTitle,
  formatStaffJoinDate,
  formatWeeklyHours,
  translateStaffMemberStatus,
} from '../../utils/staffDirectoryDisplay'
import { Modal } from '../ui/Modal'

type StaffMemberDetailsModalProps = {
  isOpen: boolean
  memberId: string | null
  onClose: () => void
}

export function StaffMemberDetailsModal({
  isOpen,
  memberId,
  onClose,
}: StaffMemberDetailsModalProps) {
  const [member, setMember] = useState<StaffMemberDetails | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!isOpen || !memberId) {
      setMember(null)
      setErrorMessage('')
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage('')
    setMember(null)

    void loadStaffMemberDetails(memberId).then((result) => {
      if (cancelled) {
        return
      }

      setIsLoading(false)
      if (!result.ok) {
        setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
        return
      }

      setMember(result.member)
    })

    return () => {
      cancelled = true
    }
  }, [isOpen, memberId])

  return (
    <Modal isOpen={isOpen} title="פרטי עובד" onClose={onClose} size="medium">
      {isLoading ? (
        <p className="ds-form-message">{STAFF_MEMBER_DETAILS_LOADING_MESSAGE}</p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p className="ds-form-message ds-form-message--error">{errorMessage}</p>
      ) : null}

      {!isLoading && member ? (
        <dl className="staff-directory__details-list">
          <div className="staff-directory__details-row">
            <dt>שם מלא</dt>
            <dd>{member.fullName}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>מייל</dt>
            <dd>{member.email}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>טלפון</dt>
            <dd>{member.phone?.trim() || '—'}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>תפקיד</dt>
            <dd>{formatStaffJobTitle(member.jobTitle)}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>היקף משרה בשעות</dt>
            <dd>{formatWeeklyHours(member.weeklyHours)}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>סטטוס</dt>
            <dd>{translateStaffMemberStatus(member.status)}</dd>
          </div>
          <div className="staff-directory__details-row">
            <dt>תאריך הצטרפות</dt>
            <dd>{formatStaffJoinDate(member.createdAt)}</dd>
          </div>
          {member.nationalId !== null ? (
            <div className="staff-directory__details-row">
              <dt>תעודת זהות</dt>
              <dd>{member.nationalId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Modal>
  )
}
