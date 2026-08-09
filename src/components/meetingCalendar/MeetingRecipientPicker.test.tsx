import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MeetingRecipientPicker } from './MeetingRecipientPicker'
import type { MeetingUserDirectoryEntry } from '../../utils/meetingCalendarDisplay'

const recipients: MeetingUserDirectoryEntry[] = [
  { id: 's1', fullName: 'רותי מזכירה', primaryRole: 'secretary', status: 'active' },
  { id: 'm1', fullName: 'נועה מנהלת', primaryRole: 'institution_manager', status: 'active' },
]

describe('MeetingRecipientPicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('supports searchable single selection', () => {
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

    // fireEvent.change avoids userEvent Hebrew/RTL keystroke nondeterminism under load.
    fireEvent.change(screen.getByLabelText('חיפוש לפי שם'), { target: { value: 'נועה' } })
    expect(screen.queryByText('רותי מזכירה')).not.toBeInTheDocument()
    expect(screen.getByText('נועה מנהלת')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /נועה מנהלת/i }))
    expect(onSelect).toHaveBeenCalledWith(recipients[1])
  })
})
