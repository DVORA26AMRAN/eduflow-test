import { describe, expect, it } from 'vitest'
import { isConversationListAtBottom } from './requestMessageDisplay'

describe('isConversationListAtBottom', () => {
  it('returns true when the scroll position is near the bottom', () => {
    const element = {
      scrollHeight: 500,
      scrollTop: 452,
      clientHeight: 48,
    } as HTMLElement

    expect(isConversationListAtBottom(element)).toBe(true)
  })

  it('returns false when the user scrolled up to read history', () => {
    const element = {
      scrollHeight: 500,
      scrollTop: 100,
      clientHeight: 48,
    } as HTMLElement

    expect(isConversationListAtBottom(element)).toBe(false)
  })
})
