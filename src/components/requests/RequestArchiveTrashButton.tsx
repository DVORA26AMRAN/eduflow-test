import { NavTrashIcon } from '../dashboard/dashboardNav'
import './RequestArchiveTrashButton.css'

type RequestArchiveTrashButtonProps = {
  teacherName: string
  isArchiving: boolean
  isDisabled?: boolean
  onArchive: () => void
}

export function RequestArchiveTrashButton({
  teacherName,
  isArchiving,
  isDisabled = false,
  onArchive,
}: RequestArchiveTrashButtonProps) {
  const isButtonDisabled = isDisabled || isArchiving

  return (
    <button
      type="button"
      className="request-archive-trash-button"
      onClick={onArchive}
      disabled={isButtonDisabled}
      aria-label={`העבר לארכיון אישי בקשה של ${teacherName}`}
      title="העבר לארכיון אישי"
    >
      <span className="request-archive-trash-button__icon" aria-hidden="true">
        <NavTrashIcon />
      </span>
      <span className="request-archive-trash-button__label">
        {isArchiving ? 'מעביר...' : 'העבר לארכיון'}
      </span>
    </button>
  )
}
