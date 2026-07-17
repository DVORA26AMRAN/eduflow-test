import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffDirectoryPage } from './StaffDirectoryPage'

const { loadDirectoryMock } = vi.hoisted(() => ({
  loadDirectoryMock: vi.fn(),
}))

vi.mock('../services/staffDirectory', () => ({
  loadStaffDirectory: loadDirectoryMock,
  loadStaffMemberDetails: vi.fn(),
  updateStaffMember: vi.fn(),
}))

describe('StaffDirectoryPage loading', () => {
  beforeEach(() => {
    loadDirectoryMock.mockReset()
  })

  it('mounts and calls loadStaffDirectory from its loading effect', async () => {
    loadDirectoryMock.mockResolvedValue({ ok: true, members: [] })

    render(<StaffDirectoryPage canEdit institutionName="בית ספר" />)

    await waitFor(() => {
      expect(loadDirectoryMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('לא נמצאו אנשי צוות.')).toBeInTheDocument()
  })
})
