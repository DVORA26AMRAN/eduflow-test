import { RequestDescriptionCell } from './RequestDescriptionCell'
import { extractGeneralRequestMessage } from '../../utils/generalRequestDisplay'

type RequestSubjectMessagePreviewProps = {
  subject: string
  requestPayload?: unknown
}

export function RequestSubjectMessagePreview({
  subject,
  requestPayload,
}: RequestSubjectMessagePreviewProps) {
  const message = extractGeneralRequestMessage(requestPayload)

  return (
    <div className="ds-table__request-preview">
      <RequestDescriptionCell description={subject} />
      {message?.trim() ? (
        <p className="ds-table__message-preview">{message}</p>
      ) : null}
    </div>
  )
}
