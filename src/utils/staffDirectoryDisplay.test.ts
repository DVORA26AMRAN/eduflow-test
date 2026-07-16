import { describe, expect, it } from 'vitest'
import type { StaffDirectoryMember } from '../types/staffDirectory'
import {
  filterStaffDirectoryMembers,
  sortStaffDirectoryMembers,
} from './staffDirectoryDisplay'

const members: StaffDirectoryMember[] = [
  {
    id: '1',
    fullName: 'דני כהן',
    email: 'danny@school.com',
    phone: '050-1111111',
    jobTitle: 'מחנך',
    weeklyHours: 30,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '2',
    fullName: 'יעל לוי',
    email: 'yael@school.com',
    phone: '052-2222222',
    jobTitle: null,
    weeklyHours: 22,
    status: 'inactive',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
]

describe('staff directory display utilities', () => {
  it('filters by full name, email, and phone', () => {
    expect(filterStaffDirectoryMembers(members, 'יעל').map((member) => member.id)).toEqual(['2'])
    expect(filterStaffDirectoryMembers(members, 'danny@').map((member) => member.id)).toEqual(['1'])
    expect(filterStaffDirectoryMembers(members, '050-111').map((member) => member.id)).toEqual(['1'])
  })

  it('sorts by full name and weekly hours', () => {
    expect(
      sortStaffDirectoryMembers(members, 'fullName', 'asc').map((member) => member.fullName),
    ).toEqual(['דני כהן', 'יעל לוי'])

    expect(
      sortStaffDirectoryMembers(members, 'weeklyHours', 'desc').map((member) => member.id),
    ).toEqual(['1', '2'])
  })
})
