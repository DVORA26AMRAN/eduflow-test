import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEACHER_REQUEST_CATEGORIES, translateRequestType } from './requests'

describe('Teacher request categories for general_request', () => {
  it('does not offer substitute_teacher as a new-request category card', () => {
    const categoryValues = TEACHER_REQUEST_CATEGORIES.map((category) => category.value)

    expect(categoryValues).not.toContain('substitute_teacher')
    expect(categoryValues).toContain('general_request')
  })

  it('shows בקשה אחרת with the approved description', () => {
    const generalRequestCategory = TEACHER_REQUEST_CATEGORIES.find(
      (category) => category.value === 'general_request',
    )

    expect(generalRequestCategory).toEqual({
      value: 'general_request',
      title: 'בקשה אחרת',
      description: 'פנייה חופשית למזכירה או למנהלת',
      icon: '✉️',
    })
  })

  it('keeps historical substitute_teacher labels intact', () => {
    expect(translateRequestType('substitute_teacher')).toBe('מילוי מקום')
    expect(translateRequestType('general_request')).toBe('בקשה אחרת')
  })
})

describe('substitute teacher board remains separate', () => {
  const teacherDashboardSource = readFileSync(
    resolve(process.cwd(), 'src/pages/TeacherDashboardPage.tsx'),
    'utf8',
  )

  it('still renders the substitute board section', () => {
    expect(teacherDashboardSource).toContain('TeacherSubstituteBoardSection')
    expect(teacherDashboardSource).toContain('teacher-substitute-board')
  })
})
