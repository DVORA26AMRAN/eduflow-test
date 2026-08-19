import { useState } from 'react'
import { ConfirmDialog } from '../ui/Modal'
import { reactivateStaffMember } from '../../services/staffDirectory'

type StaffReactivationConfirmModalProps = {
  isOpen: boolean
  targetUserId: string | null
  targetName: string
  onSuccess: () => Promise<void>
  onClose: () => void
}

export function StaffReactivationConfirmModal({
  isOpen,
  targetUserId,
  targetName,
  onSuccess,
  onClose,
}: StaffReactivationConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const confirmMessage =
    `האם להחזיר את ${targetName} לפעילות?\n` +
    'המשתמשת תוכל להתחבר שוב למערכת ולהמשיך לעבוד. ' +
    'בקשות ששוחררו בזמן ההשבתה לא יוקצו אליה מחדש באופן אוטומטי.'

  async function handleConfirm() {
    if (!targetUserId || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    const result = await reactivateStaffMember(targetUserId)

    if (!result.ok) {
      setIsSubmitting(false)
      setErrorMessage(result.errorMessage)
      return
    }

    setIsSubmitting(false)
    onClose()
    await onSuccess()
  }

  function handleCancel() {
    if (isSubmitting) {
      return
    }
    setErrorMessage('')
    onClose()
  }

  if (!isOpen) {
    return null
  }

  return (
    <>
      <ConfirmDialog
        isOpen={isOpen && !errorMessage}
        title="החזרת איש צוות לפעילות"
        message={confirmMessage}
        continueLabel="ביטול"
        confirmLabel="החזרה לפעילות"
        continueDisabled={isSubmitting}
        confirmDisabled={isSubmitting}
        onContinue={handleCancel}
        onConfirm={() => void handleConfirm()}
      />

      {errorMessage ? (
        <ConfirmDialog
          isOpen={true}
          title="החזרת איש צוות לפעילות"
          message={errorMessage}
          continueLabel="סגירה"
          confirmLabel="ניסיון חוזר"
          onContinue={handleCancel}
          onConfirm={() => {
            setErrorMessage('')
            void handleConfirm()
          }}
        />
      ) : null}
    </>
  )
}
