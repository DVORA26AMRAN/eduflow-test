import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginSuccessTransition } from './LoginSuccessTransition'

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  )
}

describe('LoginSuccessTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockReducedMotion(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is decorative and completes after the standard transition duration', () => {
    const onComplete = vi.fn()
    const { container } = render(
      <LoginSuccessTransition onComplete={onComplete} />,
    )

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')

    act(() => {
      vi.advanceTimersByTime(1549)
    })
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('uses a brief timeout when reduced motion is preferred', () => {
    mockReducedMotion(true)
    const onComplete = vi.fn()
    render(<LoginSuccessTransition onComplete={onComplete} />)

    act(() => {
      vi.advanceTimersByTime(450)
    })

    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('continues immediately if the logo asset cannot render', () => {
    const onComplete = vi.fn()
    const { container } = render(
      <LoginSuccessTransition onComplete={onComplete} />,
    )
    const logo = container.querySelector('img')

    expect(logo).not.toBeNull()
    fireEvent.error(logo!)
    act(() => {
      vi.runAllTimers()
    })

    expect(onComplete).toHaveBeenCalledOnce()
  })
})
