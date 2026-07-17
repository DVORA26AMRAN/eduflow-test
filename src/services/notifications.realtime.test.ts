import { beforeEach, describe, expect, it, vi } from 'vitest'

const { channelNames, channels, channelMock, removeChannelMock } = vi.hoisted(() => {
  const names: string[] = []
  const createdChannels: Array<{
    name: string
    operations: string[]
    on: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
  }> = []

  const createChannel = vi.fn((name: string) => {
    const operations: string[] = []
    const channel = {
      name,
      operations,
      on: vi.fn(function (this: unknown) {
        operations.push('on')
        return this
      }),
      subscribe: vi.fn(function (this: unknown) {
        operations.push('subscribe')
        return this
      }),
    }
    names.push(name)
    createdChannels.push(channel)
    return channel
  })

  return {
    channelNames: names,
    channels: createdChannels,
    channelMock: createChannel,
    removeChannelMock: vi.fn().mockResolvedValue('ok'),
  }
})

vi.mock('./supabase', () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}))

import {
  subscribeToUserNotifications,
  unsubscribeFromUserNotifications,
} from './notifications'

describe('notification realtime subscriptions', () => {
  beforeEach(() => {
    channelNames.length = 0
    channels.length = 0
    channelMock.mockClear()
    removeChannelMock.mockClear()
  })

  it('creates a unique channel per consumer instance and binds before subscribing', () => {
    subscribeToUserNotifications('user-1', vi.fn(), 'request-message-hook')
    subscribeToUserNotifications('user-1', vi.fn(), 'request-message-hook')

    expect(channelNames).toHaveLength(2)
    expect(channelNames[0]).not.toBe(channelNames[1])
    expect(channelNames[0]).toContain('request-message-hook')
    expect(channels[0]?.operations).toEqual(['on', 'subscribe'])
    expect(channels[1]?.operations).toEqual(['on', 'subscribe'])
  })

  it('removes the exact channel passed by the effect cleanup', async () => {
    const first = subscribeToUserNotifications('user-1', vi.fn(), 'first')
    const second = subscribeToUserNotifications('user-1', vi.fn(), 'second')

    await unsubscribeFromUserNotifications(first)

    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(removeChannelMock).toHaveBeenCalledWith(first)
    expect(removeChannelMock).not.toHaveBeenCalledWith(second)
  })

  it('contains cleanup failures instead of rejecting the effect cleanup', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    removeChannelMock.mockRejectedValueOnce(new Error('socket closed'))
    const channel = subscribeToUserNotifications('user-1', vi.fn(), 'cleanup-failure')

    await expect(unsubscribeFromUserNotifications(channel)).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      '[notifications] realtime cleanup failed',
      expect.objectContaining({ channelName: expect.stringContaining('cleanup-failure') }),
    )

    consoleError.mockRestore()
  })
})
