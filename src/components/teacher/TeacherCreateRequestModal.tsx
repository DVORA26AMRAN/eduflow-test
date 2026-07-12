import { useState } from 'react'
import type { RequestType } from '../../types/request'
import { TEACHER_REQUEST_CATEGORIES } from '../../utils/requests'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { CreateRequestForm } from './CreateRequestForm'

type TeacherCreateRequestModalProps = {
  requestType: RequestType
  formKey: number
  isSubmitting: boolean
  submitMessage: string
  onClose: () => void
  onSubmit: Parameters<typeof CreateRequestForm>[0]['onSubmit']
}

function getRequestTypeTitle(requestType: RequestType) {
  return (
    TEACHER_REQUEST_CATEGORIES.find((category) => category.value === requestType)?.title ??
    'בקשה חדשה'
  )
}

export function TeacherCreateRequestModal({
  requestType,
  formKey,
  isSubmitting,
  submitMessage,
  onClose,
  onSubmit,
}: TeacherCreateRequestModalProps) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  function attemptClose() {
    if (isSubmitting) {
      return
    }

    if (isDirty) {
      setShowCloseConfirm(true)
      return
    }

    onClose()
  }

  function handleConfirmClose() {
    setShowCloseConfirm(false)
    onClose()
  }

  return (
    <>
      <Modal
        isOpen
        title={getRequestTypeTitle(requestType)}
        onClose={attemptClose}
        closeLabel="סגירת טופס בקשה"
      >
        <CreateRequestForm
          key={`${requestType}-${formKey}`}
          initialRequestType={requestType}
          hideCategorySelector
          isSubmitting={isSubmitting}
          submitMessage={submitMessage}
          onCancel={attemptClose}
          onDirtyChange={setIsDirty}
          onSubmit={onSubmit}
        />
      </Modal>

      <ConfirmDialog
        isOpen={showCloseConfirm}
        title="לסגור את הטופס?"
        message="יש שינויים שלא נשמרו. האם לסגור את הטופס?"
        continueLabel="המשך עריכה"
        confirmLabel="סגור ללא שמירה"
        onContinue={() => setShowCloseConfirm(false)}
        onConfirm={handleConfirmClose}
      />
    </>
  )
}
