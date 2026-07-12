export function getRequestMessageAuthorRoleLabel(primaryRole: string | null): string {
  switch (primaryRole) {
    case 'teacher':
      return 'מורה'
    case 'secretary':
      return 'מזכירה'
    case 'institution_manager':
      return 'מנהלת'
    default:
      return ''
  }
}

export function formatRequestMessageDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return date.toLocaleDateString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatRequestMessageTime(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isConversationListAtBottom(element: HTMLElement, threshold = 48): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}
