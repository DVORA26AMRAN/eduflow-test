import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestDescriptionCell } from './RequestDescriptionCell'

afterEach(() => {
  cleanup()
})

describe('RequestDescriptionCell', () => {
  it('renders the request description text', () => {
    render(<RequestDescriptionCell description="בקשה לציוד כיתתי" />)

    expect(screen.getByText('בקשה לציוד כיתתי')).toHaveClass('ds-table__description')
  })

  it('shows a graceful placeholder for empty descriptions', () => {
    render(<RequestDescriptionCell description="   " />)

    expect(screen.getByText('—')).toHaveClass('ds-table__description--empty')
  })
})
