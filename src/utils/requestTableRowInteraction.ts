import type { KeyboardEvent, MouseEvent } from 'react'

export function isRequestRowActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  return Boolean(
    target.closest(
      '.ds-table__row-actions, button, select, textarea, input, a, [role="button"], label',
    ),
  )
}

export function shouldOpenRequestRowDetails(
  event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>,
): boolean {
  if ('key' in event) {
    return event.key === 'Enter' || event.key === ' '
  }

  return !isRequestRowActionTarget(event.target)
}

export function handleRequestRowActivate(
  event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>,
  onOpen: (rowElement: HTMLTableRowElement) => void,
): void {
  if (!shouldOpenRequestRowDetails(event)) {
    return
  }

  if ('key' in event) {
    event.preventDefault()
  }

  onOpen(event.currentTarget)
}
