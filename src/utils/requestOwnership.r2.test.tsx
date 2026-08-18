import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canAdministrativelyOverrideHandler,
  canOrdinaryStatusUpdate,
  canShowClaimAction,
  canShowHandlerStatusSelect,
  canShowReleaseAction,
  canTransferOrReleaseAsActor,
  filterEligibleHandlersForRequest,
  formatHandlerHistoryMessage,
} from '../domain/requestOwnership'
import { ManagerRecentRequestsTable } from '../components/manager/ManagerRecentRequestsTable'
import { SecretaryRequestsTable } from '../components/secretary/SecretaryRequestsTable'
import { EMPTY_REQUEST_ASSIGNMENT } from '../types/requestOwnership'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

afterEach(() => {
  cleanup()
})

const PHASE3_PATHS = [
  'src/services/schoolRegistrationQuotation.ts',
  'src/utils/schoolRegistrationQuotation.ts',
  'src/components/platform/quotation/QuotationBuilderWorkspace.tsx',
  'src/components/platform/quotation/QuotationDocumentPreview.tsx',
  'src/components/platform/PlatformAdminRegistrationQuotationPanel.tsx',
]

const R2_FRONTEND_PATHS = [
  'src/services/requestOwnership.ts',
  'src/components/requests/RequestHandlerCell.tsx',
  'src/components/requests/RequestHandlerAssignmentDialog.tsx',
  'src/components/manager/ManagerRecentRequestsSection.tsx',
  'src/components/secretary/SecretaryRequestsInbox.tsx',
  'src/components/requests/RequestDetailsModal.tsx',
]

const unassignedRequest = {
  id: 'req-1',
  teacher_full_name: 'מורה א',
  request_type: 'absence' as const,
  description: 'תיאור',
  status: 'new' as const,
  created_at: '2026-07-01T10:00:00.000Z',
  ...EMPTY_REQUEST_ASSIGNMENT,
}

const assignedRequest = {
  ...unassignedRequest,
  status: 'in_progress' as const,
  handled_by_user_id: 'handler-1',
  handled_by_full_name: 'יעל כהן',
  handled_by_primary_role: 'deputy' as const,
}

const tableHandlers = {
  onArchive: vi.fn(),
  onOpenDetails: vi.fn(),
  onClaim: vi.fn(),
  onHandlerAssigned: vi.fn(),
  onHandlerReleased: vi.fn(),
  onHandlerError: vi.fn(),
}

describe('Request ownership R2 domain and UX contracts', () => {
  it('6. unassigned new request has no ordinary in_progress status control', () => {
    expect(
      canOrdinaryStatusUpdate({
        actorUserId: 'mgr-1',
        handledByUserId: null,
        currentStatus: 'new',
        nextStatus: 'in_progress',
      }),
    ).toBe(false)
    expect(
      canShowHandlerStatusSelect({ actorUserId: 'mgr-1', handledByUserId: null }),
    ).toBe(false)
  })

  it('7. assigned current handler can status-update', () => {
    expect(
      canShowHandlerStatusSelect({ actorUserId: 'handler-1', handledByUserId: 'handler-1' }),
    ).toBe(true)
    expect(
      canOrdinaryStatusUpdate({
        actorUserId: 'handler-1',
        handledByUserId: 'handler-1',
        currentStatus: 'in_progress',
        nextStatus: 'completed',
      }),
    ).toBe(true)
  })

  it('8/9. assigned non-handler and Manager have no ordinary-status override', () => {
    expect(
      canShowHandlerStatusSelect({ actorUserId: 'mgr-1', handledByUserId: 'handler-1' }),
    ).toBe(false)
    expect(
      canOrdinaryStatusUpdate({
        actorUserId: 'mgr-1',
        handledByUserId: 'handler-1',
        currentStatus: 'in_progress',
        nextStatus: 'completed',
      }),
    ).toBe(false)
    expect(canAdministrativelyOverrideHandler('institution_manager')).toBe(true)
    expect(
      canTransferOrReleaseAsActor({
        actorRole: 'institution_manager',
        actorUserId: 'mgr-1',
        handledByUserId: 'handler-1',
      }),
    ).toBe(true)
  })

  it('14-19. picker keeps only active eligible lane roles', () => {
    const users = [
      {
        id: 'inactive-sec',
        fullName: 'לא פעילה',
        primaryRole: 'secretary' as const,
        status: 'inactive',
      },
      {
        id: 'mgr-1',
        fullName: 'מנהלת',
        primaryRole: 'institution_manager' as const,
        status: 'active',
      },
      {
        id: 'dep-1',
        fullName: 'סגנית',
        primaryRole: 'deputy' as const,
        status: 'active',
      },
      {
        id: 'sec-1',
        fullName: 'מזכירה',
        primaryRole: 'secretary' as const,
        status: 'active',
      },
    ]

    const overlapping = filterEligibleHandlersForRequest({
      users,
      requestType: 'absence',
    })
    expect(overlapping.map((user) => user.id).sort()).toEqual(['dep-1', 'mgr-1', 'sec-1'])

    const inactiveExcluded = filterEligibleHandlersForRequest({
      users,
      requestType: 'absence',
    })
    expect(inactiveExcluded.some((user) => user.id === 'inactive-sec')).toBe(false)

    const managerGeneral = filterEligibleHandlersForRequest({
      users: users.filter((user) => user.status === 'active'),
      requestType: 'general_request',
      recipientRole: 'institution_manager',
    })
    expect(managerGeneral.map((user) => user.primaryRole).sort()).toEqual([
      'deputy',
      'institution_manager',
    ])

    const secretaryGeneral = filterEligibleHandlersForRequest({
      users: users.filter((user) => user.status === 'active'),
      requestType: 'general_request',
      recipientRole: 'secretary',
    })
    expect(secretaryGeneral.map((user) => user.primaryRole)).toEqual(['secretary'])
  })

  it('explicitly excludes Teacher and Platform Admin from claim and the picker query', () => {
    expect(
      canShowClaimAction({
        actorRole: 'teacher',
        handledByUserId: null,
        status: 'new',
        requestType: 'absence',
      }),
    ).toBe(false)
    expect(
      canShowClaimAction({
        actorRole: 'platform_admin',
        handledByUserId: null,
        status: 'new',
        requestType: 'absence',
      }),
    ).toBe(false)
    const picker = read('src/services/requestOwnership.ts')
    expect(picker).toContain(".in('primary_role', ['institution_manager', 'deputy', 'secretary'])")
    expect(picker).toContain(".eq('status', 'active')")
    expect(picker).not.toContain('get_staff_directory')
  })

  it('22. completed/rejected do not show release', () => {
    expect(
      canShowReleaseAction({
        actorRole: 'institution_manager',
        actorUserId: 'mgr-1',
        handledByUserId: 'handler-1',
        status: 'completed',
      }),
    ).toBe(false)
    expect(
      canShowReleaseAction({
        actorRole: 'deputy',
        actorUserId: 'handler-1',
        handledByUserId: 'handler-1',
        status: 'rejected',
      }),
    ).toBe(false)
  })

  it('formats assignment history separately from status history', () => {
    expect(
      formatHandlerHistoryMessage({
        action: 'claim',
        actorFullName: 'יעל',
        previousHandlerFullName: null,
        newHandlerFullName: 'יעל',
      }),
    ).toBe('נלקחה לטיפול על ידי יעל')
    expect(
      formatHandlerHistoryMessage({
        action: 'transfer',
        actorFullName: 'מנהלת',
        previousHandlerFullName: 'יעל',
        newHandlerFullName: 'דנה',
      }),
    ).toBe('הטיפול הועבר מ-יעל ל-דנה')
    expect(
      formatHandlerHistoryMessage({
        action: 'release',
        actorFullName: 'מנהלת',
        previousHandlerFullName: 'יעל',
        newHandlerFullName: null,
      }),
    ).toBe('הטיפול שוחרר על ידי מנהלת')
  })
})

describe('Request ownership R2 lists and details', () => {
  it('24. handler is visible in Manager/Deputy list', () => {
    render(
      <ManagerRecentRequestsTable
        requests={[assignedRequest]}
        actorUserId="mgr-1"
        actorRole="institution_manager"
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set()}
        reminderSummariesByRequestId={new Map()}
        {...tableHandlers}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'בטיפול של' })).toBeInTheDocument()
    expect(screen.getByText('יעל כהן · סגנית')).toBeInTheDocument()
  })

  it('25. handler is visible in Secretary list', () => {
    render(
      <SecretaryRequestsTable
        requests={[assignedRequest]}
        actorUserId="sec-1"
        actorRole="secretary"
        emptyMessage="אין"
        updatingRequestId={null}
        archivingRequestId={null}
        requestIdsWithAttachments={new Set()}
        unreadReminderRequestIds={new Set()}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set()}
        reminderSummariesByRequestId={new Map()}
        onStatusChange={vi.fn()}
        {...tableHandlers}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'בטיפול של' })).toBeInTheDocument()
    expect(screen.getByText('יעל כהן · סגנית')).toBeInTheDocument()
  })

  it('6. unassigned manager row has no in_progress status select', () => {
    render(
      <ManagerRecentRequestsTable
        requests={[unassignedRequest]}
        actorUserId="mgr-1"
        actorRole="institution_manager"
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set()}
        reminderSummariesByRequestId={new Map()}
        onStatusChange={vi.fn()}
        {...tableHandlers}
      />,
    )
    expect(screen.queryByLabelText('סטטוס בקשה של מורה א')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'לקחת לטיפול' })).toBeInTheDocument()
  })

  it('8. assigned non-handler cannot status-update in the manager list', () => {
    render(
      <ManagerRecentRequestsTable
        requests={[assignedRequest]}
        actorUserId="mgr-1"
        actorRole="institution_manager"
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set()}
        reminderSummariesByRequestId={new Map()}
        onStatusChange={vi.fn()}
        {...tableHandlers}
      />,
    )
    expect(screen.queryByLabelText('סטטוס בקשה של מורה א')).not.toBeInTheDocument()
  })

  it('7. assigned current handler can status-update in the manager list', () => {
    render(
      <ManagerRecentRequestsTable
        requests={[assignedRequest]}
        actorUserId="handler-1"
        actorRole="deputy"
        archivingRequestId={null}
        unreadReminderRequestIds={new Set()}
        unreadMessageRequestIds={new Set()}
        requestIdsWithMessages={new Set()}
        reminderSummariesByRequestId={new Map()}
        onStatusChange={vi.fn()}
        {...tableHandlers}
      />,
    )
    expect(screen.getByLabelText('סטטוס בקשה של מורה א')).toBeInTheDocument()
  })

  it('26. handler identity is in operator details and omitted from Teacher details', () => {
    const details = read('src/components/requests/RequestDetailsModal.tsx')
    expect(details).toContain('RequestHandlerCell')
    expect(details).toContain('RequestHandlerHistorySection')
    expect(details).toContain("request.role !== 'teacher'")
    expect(read('src/components/teacher/TeacherRequestsList.tsx')).not.toContain('בטיפול של')
  })
})

describe('Request ownership R2 source contracts', () => {
  it('27. Manager/Deputy inbox is not limited to five rows', () => {
    const section = read('src/components/manager/ManagerRecentRequestsSection.tsx')
    const service = read('src/services/requests.ts')
    expect(section).toContain('loadOperatorInboxRequests')
    expect(section).not.toContain('loadRecentRequests')
    expect(service).toContain('export async function loadOperatorInboxRequests')
    const start = service.indexOf('export async function loadOperatorInboxRequests')
    const next = service.indexOf('export async function loadSecretaryArchivedRequests')
    const inboxFn = service.slice(start, next)
    expect(inboxFn).not.toContain('.limit(5)')
  })

  it('23. claim conflicts refresh authoritative state and do not retry', () => {
    const section = read('src/components/manager/ManagerRecentRequestsSection.tsx')
    expect(section).toContain('claimRequest')
    expect(section).toContain('isRequestOwnershipConflictCode')
    expect(section).toContain('fetchRequests')
    expect(section).not.toContain('claimRequest(requestId)\n      await claimRequest')
  })

  it('28. mobile handler layout stacks and table wrappers already scroll instead of overflowing', () => {
    const css = read('src/components/requests/RequestHandlerControls.css')
    const tables = read('src/design-system/tables.css')
    expect(css).toContain('flex-direction: column')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('@media (max-width: 48rem)')
    expect(tables).toContain('overflow-x: auto')
  })

  it('29. frontend never directly UPDATEs handled_by', () => {
    for (const relativePath of [
      'src/services/requestOwnership.ts',
      'src/services/requests.ts',
      'src/services/analytics.ts',
      'src/components/manager/ManagerRecentRequestsSection.tsx',
      'src/components/secretary/SecretaryRequestsInbox.tsx',
    ]) {
      const source = read(relativePath)
      expect(source).not.toMatch(/\.update\(\s*\{[^}]*handled_by/)
      expect(source).not.toMatch(/from\('requests'\)\s*\n?\s*\.update\(\s*\{[^}]*handled_by/)
    }
    expect(read('src/services/requestOwnership.ts')).toContain("rpc('claim_request'")
    expect(read('src/App.tsx')).not.toContain('handled_by')
  })

  it('30. Phase 3 quotation files are untouched by R2 sources', () => {
    for (const path of PHASE3_PATHS) {
      expect(existsSync(resolve(root, path))).toBe(true)
    }
    for (const relativePath of R2_FRONTEND_PATHS) {
      const source = read(relativePath)
      expect(source).not.toContain('schoolRegistrationQuotation')
      expect(source).not.toContain('quotationPdf')
      expect(source).not.toContain('QuotationBuilderWorkspace')
    }
    expect(read('src/App.tsx')).not.toContain('claim_request')
  })

  it('does not use get_staff_directory for the handler picker', () => {
    expect(read('src/services/requestOwnership.ts')).not.toContain('get_staff_directory')
    expect(read('src/services/requestOwnership.ts')).toContain(".from('users')")
    expect(read('src/services/requestOwnership.ts')).toContain(
      "select('id, full_name, primary_role, status, institution_id')",
    )
  })

  it('11. Teacher request views stay free of handler identity', () => {
    expect(read('src/components/teacher/TeacherRequestsList.tsx')).not.toContain('RequestHandlerCell')
    expect(read('src/components/teacher/TeacherRequestsList.tsx')).not.toContain('בטיפול של')
    expect(read('src/components/requests/RequestDetailsModal.tsx')).toContain(
      "request.role !== 'teacher'",
    )
  })
})
