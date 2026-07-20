import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MeetingProposeSlotsForm } from './MeetingProposeSlotsForm'
import { createEmptySlotDraft } from '../../utils/meetingCalendarForm'

describe('MeetingProposeSlotsForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders slot fields with design-system inputs on one row', () => {
    const onDraftsChange = vi.fn()
    const draft = { ...createEmptySlotDraft(), id: 'slot-1' }

    render(
      <MeetingProposeSlotsForm
        durationMinutes={30}
        drafts={[draft]}
        onDraftsChange={onDraftsChange}
        validationMessage=""
      />,
    )

    expect(screen.getByRole('group', { name: /הצעת מועדים/i })).toBeInTheDocument()
    expect(screen.getByText('מועד 1')).toBeInTheDocument()
    expect(screen.getByLabelText('תאריך')).toHaveClass('ds-input')
    expect(screen.getByLabelText('שעת התחלה')).toHaveClass('ds-input')
    expect(document.querySelector('.mc-slot-row__fields')).toBeInTheDocument()
  })

  it('uses primary add action and destructive remove action', () => {
    render(
      <MeetingProposeSlotsForm
        durationMinutes={30}
        drafts={[createEmptySlotDraft()]}
        onDraftsChange={vi.fn()}
        validationMessage=""
      />,
    )

    expect(screen.getByRole('button', { name: 'הוספת מועד' })).toHaveClass('ds-btn--primary')
    expect(screen.getByRole('button', { name: /הסרת מועד/i })).toHaveClass('ds-btn--danger')
  })

  it('updates draft values and supports adding another slot', () => {
    const onDraftsChange = vi.fn()
    const draft = { ...createEmptySlotDraft(), id: 'slot-1' }

    render(
      <MeetingProposeSlotsForm
        durationMinutes={30}
        drafts={[draft]}
        onDraftsChange={onDraftsChange}
        validationMessage=""
      />,
    )

    fireEvent.change(screen.getByLabelText('תאריך'), { target: { value: '2026-07-22' } })
    expect(onDraftsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'slot-1', date: '2026-07-22' }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'הוספת מועד' }))
    expect(onDraftsChange).toHaveBeenCalled()
  })

  it('shows validation message when provided', () => {
    render(
      <MeetingProposeSlotsForm
        durationMinutes={30}
        drafts={[createEmptySlotDraft()]}
        onDraftsChange={vi.fn()}
        validationMessage="כל מועד חייב לכלול תאריך ושעת התחלה."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('כל מועד חייב לכלול תאריך ושעת התחלה.')
  })
})
