import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MeetingRecipientPicker } from './MeetingRecipientPicker'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'

const recipients: MeetingUserDirectoryEntry[] = [
  { id: 's1', fullName: 'רותי מזכירה', primaryRole: 'secretary', status: 'active' },
  { id: 'm1', fullName: 'נועה מנהלת', primaryRole: 'institution_manager', status: 'active' },
]

describe('MeetingRecipientPicker', () => {
  it('supports searchable single selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <MeetingRecipientPicker
        isOpen
        recipients={recipients}
        selectedRecipientId={null}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'בחירת נמען לפגישה' })).toBeInTheDocument()
    expect(screen.getByLabelText('חיפוש לפי שם')).toBeInTheDocument()

    await user.type(screen.getByLabelText('חיפוש לפי שם'), 'נועה')
    expect(screen.queryByText('רותי מזכירה')).not.toBeInTheDocument()
    expect(screen.getByText('נועה מנהלת')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /נועה מנהלת/i }))
    expect(onSelect).toHaveBeenCalledWith(recipients[1])
  })
})
