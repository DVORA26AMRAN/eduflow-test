import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusRequestRow } from './requestRowNavigation'

describe('requestRowNavigation', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('scrolls to and focuses the matching request row', async () => {
    document.body.innerHTML = `
      <table>
        <tr data-request-id="req-1"><td>בקשה</td></tr>
      </table>
    `

    const row = document.querySelector<HTMLElement>('[data-request-id="req-1"]')
    const scrollIntoView = vi.fn()
    const focus = vi.fn()

    if (row) {
      row.scrollIntoView = scrollIntoView
      row.focus = focus
    }

    const focused = focusRequestRow('req-1')

    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(focused).toBe(true)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(row?.classList.contains('request-row--reminder-navigated')).toBe(true)
  })
})
