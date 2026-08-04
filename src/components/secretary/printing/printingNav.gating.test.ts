import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PRINTING_WORKSPACE_NAV_LABEL,
  PRINTING_WORKSPACE_SECTION_ID,
} from '../../../utils/secretaryPrinting'

describe('Printing workspace navigation gating', () => {
  it('exposes Hebrew Printing nav for secretary and manager dashboards only', () => {
    const secretary = readFileSync(
      resolve(__dirname, '../../../pages/SecretaryDashboardPage.tsx'),
      'utf8',
    )
    const manager = readFileSync(
      resolve(__dirname, '../../../pages/ManagerDashboardPage.tsx'),
      'utf8',
    )
    const teacher = readFileSync(
      resolve(__dirname, '../../../pages/TeacherDashboardPage.tsx'),
      'utf8',
    )

    expect(PRINTING_WORKSPACE_NAV_LABEL).toBe('הדפסות')
    expect(PRINTING_WORKSPACE_SECTION_ID).toBe('printingWorkspace')

    expect(secretary).toContain('PRINTING_WORKSPACE_SECTION_ID')
    expect(secretary).toContain('SecretaryPrintingWorkspace')
    expect(manager).toContain('PRINTING_WORKSPACE_SECTION_ID')
    expect(manager).toContain('SecretaryPrintingWorkspace')

    expect(teacher).not.toContain('PRINTING_WORKSPACE_SECTION_ID')
    expect(teacher).not.toContain('SecretaryPrintingWorkspace')
    expect(teacher).not.toContain('listInstitutionPrintingRequests')
  })
})
