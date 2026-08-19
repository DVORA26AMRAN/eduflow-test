import { useState } from 'react'
import { ConfirmDialog } from '../ui/Modal'
import { deactivateStaffMember } from '../../services/staffDirectory'

type StaffDeactivationConfirmModalProps = {
  isOpen: boolean
  targetUserId: string | null
  targetName: string
  onSuccess: () => Promise<void>
  onClose: () => void
}

export function StaffDeactivationConfirmModal({
  isOpen,
  targetUserId,
  targetName,
  onSuccess,
  onClose,
}: StaffDeactivationConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const confirmMessage =
    `האם להשבית את ${targetName}?\n` +
    'המשתמשת לא תוכל להמשיך לעבוד במערכת. ' +
    'ההיסטוריה והנתונים הקיימים נשמרים. ' +
    'בקשות פעילות שבטיפולה ישוחררו אוטומטית.'

  async function handleConfirm() {
    if (!targetUserId || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    const result = await deactivateStaffMember(targetUserId)

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
        title="השבתת איש צוות"
        message={confirmMessage}
        continueLabel="ביטול"
        confirmLabel="השבתה"
        continueDisabled={isSubmitting}
        confirmDisabled={isSubmitting}
        onContinue={handleCancel}
        onConfirm={() => void handleConfirm()}
      />

      {errorMessage ? (
        <ConfirmDialog
          isOpen={true}
          title="השבתת איש צוות"
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
