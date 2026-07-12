export const REMINDER_ROW_HIGHLIGHT_DURATION_MS = 3000

export function focusRequestRow(requestId: string): boolean {
  const row = document.querySelector<HTMLElement>(`[data-request-id="${requestId}"]`)
  if (!row) {
    return false
  }

  row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  row.classList.add('request-row--reminder-navigated')

  if (!row.hasAttribute('tabindex')) {
    row.setAttribute('tabindex', '-1')
  }

  window.setTimeout(() => {
    row.classList.remove('request-row--reminder-navigated')
  }, REMINDER_ROW_HIGHLIGHT_DURATION_MS)

  requestAnimationFrame(() => {
    row.focus({ preventScroll: true })
  })

  return true
}

export function buildReminderNavigationAnnouncement(teacherName?: string): string {
  if (teacherName) {
    return `הגעת לבקשה של ${teacherName} עם תזכורת חדשה`
  }

  return 'הגעת לבקשה עם תזכורת חדשה'
}
