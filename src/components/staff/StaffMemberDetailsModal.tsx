import { useCallback, useEffect, useState } from 'react'
import type { StaffMemberDetails, UpdateStaffMemberInput } from '../../types/staffDirectory'
import { loadStaffMemberDetails, updateStaffMember } from '../../services/staffDirectory'
import {
  STAFF_DIRECTORY_ERROR_MESSAGE,
  STAFF_MEMBER_DETAILS_LOADING_MESSAGE,
  formatStaffJobTitle,
  formatStaffJoinDate,
  formatWeeklyHours,
  translateStaffMemberStatus,
} from '../../utils/staffDirectoryDisplay'
import { Modal } from '../ui/Modal'
import { StaffMemberEditForm } from './StaffMemberEditForm'

type StaffMemberDetailsModalProps = {
  isOpen: boolean
  memberId: string | null
  canEdit: boolean
  institutionName: string
  onUpdated: () => Promise<void>
  onClose: () => void
}

function StaffMemberDetailsContent({
  memberId,
  canEdit,
  institutionName,
  onUpdated,
}: Omit<StaffMemberDetailsModalProps, 'isOpen' | 'memberId' | 'onClose'> & {
  memberId: string
}) {
  const [member, setMember] = useState<StaffMemberDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const refreshDetails = useCallback(async (targetMemberId: string) => {
    setIsLoading(true)
    setErrorMessage('')

    const result = await loadStaffMemberDetails(targetMemberId)
    setIsLoading(false)

    if (!result.ok) {
      setMember(null)
      setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
      return false
    }

    setMember(result.member)
    return true
  }, [])

  useEffect(() => {
    let cancelled = false

    void loadStaffMemberDetails(memberId).then((result) => {
      if (cancelled) {
        return
      }

      setIsLoading(false)
      if (!result.ok) {
        setMember(null)
        setErrorMessage(STAFF_DIRECTORY_ERROR_MESSAGE)
        return
      }

      setErrorMessage('')
      setMember(result.member)
    })

    return () => {
      cancelled = true
    }
  }, [memberId])

  async function handleSave(input: UpdateStaffMemberInput) {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    const result = await updateStaffMember(input)
    if (!result.ok) {
      setIsSaving(false)
      setErrorMessage('העדכון נכשל.')
      return
    }

    setIsEditing(false)
    const detailsReloaded = await refreshDetails(input.userId)
    await onUpdated()
    setIsSaving(false)

    if (detailsReloaded) {
      setSuccessMessage('פרטי העובד עודכנו.')
    }
  }

  return (
    <>
      {isLoading ? (
        <p className="ds-form-message">{STAFF_MEMBER_DETAILS_LOADING_MESSAGE}</p>
      ) : null}

      {!isLoading && successMessage ? (
        <p className="ds-form-message ds-form-message--success">{successMessage}</p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p className="ds-form-message ds-form-message--error">{errorMessage}</p>
      ) : null}

      {!isLoading && member && isEditing ? (
        <>
          <h3 className="staff-directory__edit-heading">עריכת פרטים</h3>
          <StaffMemberEditForm
            member={member}
            institutionName={institutionName}
            isSaving={isSaving}
            onCancel={() => {
              setIsEditing(false)
              setErrorMessage('')
            }}
            onSave={handleSave}
          />
        </>
      ) : null}

      {!isLoading && member && !isEditing ? (
        <>
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
              <dt>מוסד</dt>
              <dd>{institutionName || '—'}</dd>
            </div>
            <div className="staff-directory__details-row">
              <dt>תאריך הצטרפות</dt>
              <dd>{formatStaffJoinDate(member.createdAt)}</dd>
            </div>
            <div className="staff-directory__details-row">
              <dt>תפקיד במערכת</dt>
              <dd>מורה</dd>
            </div>
            {member.nationalId !== null ? (
              <div className="staff-directory__details-row">
                <dt>תעודת זהות</dt>
                <dd>{member.nationalId}</dd>
              </div>
            ) : null}
          </dl>

          {canEdit ? (
            <div className="ds-form-actions staff-directory__details-actions">
              <button
                type="button"
                className="ds-btn ds-btn--primary"
                onClick={() => {
                  setSuccessMessage('')
                  setErrorMessage('')
                  setIsEditing(true)
                }}
              >
                עריכת פרטים
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}

export function StaffMemberDetailsModal({
  isOpen,
  memberId,
  canEdit,
  institutionName,
  onUpdated,
  onClose,
}: StaffMemberDetailsModalProps) {
  return (
    <Modal isOpen={isOpen} title="פרטי עובד" onClose={onClose} size="medium">
      {isOpen && memberId ? (
        <StaffMemberDetailsContent
          key={memberId}
          memberId={memberId}
          canEdit={canEdit}
          institutionName={institutionName}
          onUpdated={onUpdated}
        />
      ) : null}
    </Modal>
  )
}
