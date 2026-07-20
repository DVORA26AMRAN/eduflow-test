import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingPage } from './LoadingPage'

describe('LoadingPage', () => {
  it('shows only the decorative MPex logo while announcing loading accessibly', () => {
    const { container } = render(<LoadingPage message="טוען..." />)

    expect(container.firstElementChild).toHaveClass('profile-loading-page')
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('טוען...')
  })
})
