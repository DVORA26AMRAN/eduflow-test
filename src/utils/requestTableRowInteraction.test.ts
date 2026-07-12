import type { KeyboardEvent, MouseEvent } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleRequestRowActivate,
  isRequestRowActionTarget,
  shouldOpenRequestRowDetails,
} from './requestTableRowInteraction'

function createRowWithButton() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(
        'table',
        null,
        createElement(
          'tbody',
          null,
          createElement(
            'tr',
            { 'data-testid': 'row' },
            createElement('td', null, 'תיאור'),
            createElement(
              'td',
              null,
              createElement(
                'div',
                { className: 'ds-table__row-actions' },
                createElement('button', { type: 'button' }, 'פעולה'),
              ),
            ),
          ),
        ),
      ),
    )
  })

  const row = container.querySelector('tr') as HTMLTableRowElement
  const button = container.querySelector('button') as HTMLButtonElement

  return {
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
    row,
    button,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isRequestRowActionTarget', () => {
  it('returns true for buttons inside row actions', () => {
    const { button, cleanup } = createRowWithButton()
    expect(isRequestRowActionTarget(button)).toBe(true)
    cleanup()
  })

  it('returns false for plain row cells', () => {
    const { row, cleanup } = createRowWithButton()
    const cell = row.querySelector('td') as HTMLTableCellElement
    expect(isRequestRowActionTarget(cell)).toBe(false)
    cleanup()
  })
})

describe('shouldOpenRequestRowDetails', () => {
  it('opens on Enter and Space', () => {
    const { row, cleanup } = createRowWithButton()

    expect(
      shouldOpenRequestRowDetails({
        key: 'Enter',
        currentTarget: row,
        target: row,
      } as unknown as KeyboardEvent<HTMLTableRowElement>),
    ).toBe(true)

    expect(
      shouldOpenRequestRowDetails({
        key: ' ',
        currentTarget: row,
        target: row,
      } as unknown as KeyboardEvent<HTMLTableRowElement>),
    ).toBe(true)

    cleanup()
  })

  it('does not open on click when the target is an action control', () => {
    const { button, cleanup } = createRowWithButton()

    expect(
      shouldOpenRequestRowDetails({
        target: button,
        currentTarget: button.closest('tr'),
      } as unknown as MouseEvent<HTMLTableRowElement>),
    ).toBe(false)

    cleanup()
  })
})

describe('handleRequestRowActivate', () => {
  it('calls onOpen with the row element for row clicks', () => {
    const { row, cleanup } = createRowWithButton()
    const onOpen = vi.fn()

    handleRequestRowActivate(
      {
        target: row.querySelector('td'),
        currentTarget: row,
      } as unknown as MouseEvent<HTMLTableRowElement>,
      onOpen,
    )

    expect(onOpen).toHaveBeenCalledWith(row)
    cleanup()
  })

  it('does not call onOpen when an action button is clicked', () => {
    const { button, cleanup } = createRowWithButton()
    const onOpen = vi.fn()

    handleRequestRowActivate(
      {
        target: button,
        currentTarget: button.closest('tr'),
      } as unknown as MouseEvent<HTMLTableRowElement>,
      onOpen,
    )

    expect(onOpen).not.toHaveBeenCalled()
    cleanup()
  })
})
