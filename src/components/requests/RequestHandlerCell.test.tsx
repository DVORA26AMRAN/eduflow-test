import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestHandlerCell } from './RequestHandlerCell'
import type { RequestHandlerView } from './RequestHandlerCell'

afterEach(() => {
  cleanup()
})

const unassigned: RequestHandlerView = {
  id: 'req-1',
  request_type: 'absence',
  status: 'new',
  handled_by_user_id: null,
  handled_by_full_name: null,
  handled_by_primary_role: null,
  recipient_role: null,
}

function renderCell(
  request: RequestHandlerView,
  actor: { id?: string; role?: RequestHandlerCellActorRole } = {},
) {
  const onClaim = vi.fn()
  const onAssigned = vi.fn()
  const onReleased = vi.fn()
  const onError = vi.fn()
  const view = render(
    <RequestHandlerCell
      request={request}
      actorUserId={actor.id ?? 'actor-1'}
      actorRole={actor.role ?? 'institution_manager'}
      isBusy={false}
      onClaim={onClaim}
      onAssigned={onAssigned}
      onReleased={onReleased}
      onError={onError}
    />,
  )

  return { ...view, onClaim, onAssigned, onReleased, onError }
}

type RequestHandlerCellActorRole =
  | 'institution_manager'
  | 'deputy'
  | 'secretary'
  | 'teacher'
  | 'platform_admin'

describe('RequestHandlerCell', () => {
  it('1. unassigned new request shows לא הוקצתה מטפלת', () => {
    renderCell(unassigned)
    expect(screen.getByText('בטיפול של')).toBeInTheDocument()
    expect(screen.getByText('לא הוקצתה מטפלת')).toBeInTheDocument()
  })

  it('2. eligible actor sees לקחת לטיפול', () => {
    renderCell(unassigned, { role: 'deputy' })
    expect(screen.getByRole('button', { name: 'לקחת לטיפול' })).toBeInTheDocument()
  })

  it('3. Teacher does not see claim', () => {
    renderCell(unassigned, { role: 'teacher' })
    expect(screen.queryByRole('button', { name: 'לקחת לטיפול' })).not.toBeInTheDocument()
  })

  it('4. claim click notifies parent to call claim_request', () => {
    const { onClaim } = renderCell(unassigned)
    fireEvent.click(screen.getByRole('button', { name: 'לקחת לטיפול' }))
    expect(onClaim).toHaveBeenCalledWith('req-1')
  })

  it('5/26. successful assigned state shows handler name in details-style cell', () => {
    renderCell({
      ...unassigned,
      status: 'in_progress',
      handled_by_user_id: 'actor-1',
      handled_by_full_name: 'יעל כהן',
      handled_by_primary_role: 'deputy',
    })
    expect(screen.getByText('יעל כהן · סגנית')).toBeInTheDocument()
    expect(screen.queryByText('לא הוקצתה מטפלת')).not.toBeInTheDocument()
  })
})
