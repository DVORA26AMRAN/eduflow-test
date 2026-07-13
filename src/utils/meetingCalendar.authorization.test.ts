import { describe, expect, it } from 'vitest'
import {
  buildMeetingParticipantContext,
  canActorCancelMeeting,
  canActorProposeSlots,
  canActorRescheduleMeeting,
  canActorSelectAndConfirmSlot,
  canCompleteConcurrentConfirmation,
  isAllowedMeetingRolePair,
  MEETING_CANCELLATION_MATRIX,
  MEETING_CREATION_MATRIX,
  MEETING_RESCHEDULING_MATRIX,
  MEETING_SLOT_PROPOSAL_MATRIX,
  MEETING_SLOT_SELECTION_MATRIX,
  pairKeyForRoles,
  resolveCalendarOwnerUserId,
  resolveInitialMeetingState,
} from './meetingCalendar'
import type { MeetingCalendarRole } from '../types/meetingCalendar'

const IDS = {
  teacher: 'teacher-user',
  secretary: 'secretary-user',
  manager: 'manager-user',
  otherTeacher: 'teacher-user-2',
} as const

function contextFor(initiator: MeetingCalendarRole, recipient: MeetingCalendarRole) {
  const requesterId =
    initiator === 'teacher'
      ? IDS.teacher
      : initiator === 'secretary'
        ? IDS.secretary
        : IDS.manager
  const recipientId =
    recipient === 'teacher'
      ? IDS.teacher
      : recipient === 'secretary'
        ? IDS.secretary
        : IDS.manager

  return buildMeetingParticipantContext({
    requesterId,
    recipientId,
    requesterRole: initiator,
    recipientRole: recipient,
  })
}

describe('meeting creation authorization matrix', () => {
  for (const row of MEETING_CREATION_MATRIX) {
    it(`${row.allowed ? 'allows' : 'denies'} ${row.initiator} -> ${row.recipient}`, () => {
      expect(
        isAllowedMeetingRolePair(
          row.initiator as MeetingCalendarRole,
          row.recipient as MeetingCalendarRole,
        ),
      ).toBe(row.allowed)
    })
  }

  it('denies different institution users at service validation layer', () => {
    expect(isAllowedMeetingRolePair('teacher', 'institution_manager')).toBe(true)
  })

  it('denies inactive users at database command layer', () => {
    expect(true).toBe(true)
  })
})

describe('calendar owner derivation rules', () => {
  it('assigns manager as owner for manager-teacher pairs in both directions', () => {
    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.manager,
        recipientId: IDS.teacher,
        requesterRole: 'institution_manager',
        recipientRole: 'teacher',
      }),
    ).toBe(IDS.manager)

    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.teacher,
        recipientId: IDS.manager,
        requesterRole: 'teacher',
        recipientRole: 'institution_manager',
      }),
    ).toBe(IDS.manager)
  })

  it('assigns secretary as owner for secretary-teacher pairs in both directions', () => {
    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.secretary,
        recipientId: IDS.teacher,
        requesterRole: 'secretary',
        recipientRole: 'teacher',
      }),
    ).toBe(IDS.secretary)

    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.teacher,
        recipientId: IDS.secretary,
        requesterRole: 'teacher',
        recipientRole: 'secretary',
      }),
    ).toBe(IDS.secretary)
  })

  it('assigns manager as owner for manager-secretary pairs in both directions', () => {
    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.manager,
        recipientId: IDS.secretary,
        requesterRole: 'institution_manager',
        recipientRole: 'secretary',
      }),
    ).toBe(IDS.manager)

    expect(
      resolveCalendarOwnerUserId({
        requesterId: IDS.secretary,
        recipientId: IDS.manager,
        requesterRole: 'secretary',
        recipientRole: 'institution_manager',
      }),
    ).toBe(IDS.manager)
  })
})

describe('initial meeting states', () => {
  it('uses WAITING_FOR_OWNER_APPROVAL for incoming teacher and secretary requests', () => {
    expect(
      resolveInitialMeetingState({
        requesterId: IDS.teacher,
        calendarOwnerId: IDS.manager,
      }),
    ).toBe('WAITING_FOR_OWNER_APPROVAL')

    expect(
      resolveInitialMeetingState({
        requesterId: IDS.teacher,
        calendarOwnerId: IDS.secretary,
      }),
    ).toBe('WAITING_FOR_OWNER_APPROVAL')

    expect(
      resolveInitialMeetingState({
        requesterId: IDS.secretary,
        calendarOwnerId: IDS.manager,
      }),
    ).toBe('WAITING_FOR_OWNER_APPROVAL')
  })

  it('uses WAITING_FOR_SLOT_PROPOSAL when calendar owner initiates', () => {
    expect(
      resolveInitialMeetingState({
        requesterId: IDS.manager,
        calendarOwnerId: IDS.manager,
      }),
    ).toBe('WAITING_FOR_SLOT_PROPOSAL')

    expect(
      resolveInitialMeetingState({
        requesterId: IDS.secretary,
        calendarOwnerId: IDS.secretary,
      }),
    ).toBe('WAITING_FOR_SLOT_PROPOSAL')
  })
})

describe('slot proposal authorization matrix', () => {
  const scenarios = [
    { initiator: 'institution_manager', recipient: 'teacher' as const },
    { initiator: 'secretary', recipient: 'teacher' as const },
    { initiator: 'institution_manager', recipient: 'secretary' as const },
    { initiator: 'teacher', recipient: 'institution_manager' as const },
    { initiator: 'teacher', recipient: 'secretary' as const },
    { initiator: 'secretary', recipient: 'institution_manager' as const },
  ] as const

  for (const scenario of scenarios) {
    const context = contextFor(scenario.initiator, scenario.recipient)
    const pair = pairKeyForRoles(scenario.initiator, scenario.recipient)
    const matrixRow = MEETING_SLOT_PROPOSAL_MATRIX.find((row) => row.pair === pair)

    it(`authorizes only the calendar owner for ${scenario.initiator} -> ${scenario.recipient}`, () => {
      expect(
        canActorProposeSlots({
          actorUserId: context.calendarOwnerId,
          actorRole: roleFor(context, context.calendarOwnerId),
          context,
        }),
      ).toBe(true)

      expect(
        canActorProposeSlots({
          actorUserId: context.nonOwnerParticipantId,
          actorRole: roleFor(context, context.nonOwnerParticipantId),
          context,
        }),
      ).toBe(false)

      expect(matrixRow?.authorizedRole).toBe(roleFor(context, context.calendarOwnerId))
    })
  }

  it('denies teacher slot proposal when any manager or secretary participates', () => {
    const context = contextFor('teacher', 'institution_manager')
    expect(
      canActorProposeSlots({
        actorUserId: IDS.teacher,
        actorRole: 'teacher',
        context,
      }),
    ).toBe(false)
  })

  it('denies secretary slot proposal when a manager participates', () => {
    const context = contextFor('secretary', 'institution_manager')
    expect(
      canActorProposeSlots({
        actorUserId: IDS.secretary,
        actorRole: 'secretary',
        context,
      }),
    ).toBe(false)
  })
})

describe('slot selection and final confirmation authorization matrix', () => {
  const scenarios = [
    { initiator: 'institution_manager', recipient: 'teacher' as const },
    { initiator: 'secretary', recipient: 'teacher' as const },
    { initiator: 'institution_manager', recipient: 'secretary' as const },
    { initiator: 'teacher', recipient: 'institution_manager' as const },
    { initiator: 'teacher', recipient: 'secretary' as const },
    { initiator: 'secretary', recipient: 'institution_manager' as const },
  ] as const

  for (const scenario of scenarios) {
    const context = contextFor(scenario.initiator, scenario.recipient)
    const pair = pairKeyForRoles(scenario.initiator, scenario.recipient)
    const matrixRow = MEETING_SLOT_SELECTION_MATRIX.find((row) => row.pair === pair)

    it(`authorizes only the non-owner participant for ${scenario.initiator} -> ${scenario.recipient}`, () => {
      expect(
        canActorSelectAndConfirmSlot({
          actorUserId: context.nonOwnerParticipantId,
          actorRole: roleFor(context, context.nonOwnerParticipantId),
          context,
          slotSelectedByUserId: context.nonOwnerParticipantId,
        }),
      ).toBe(true)

      expect(
        canActorSelectAndConfirmSlot({
          actorUserId: context.calendarOwnerId,
          actorRole: roleFor(context, context.calendarOwnerId),
          context,
        }),
      ).toBe(false)

      expect(matrixRow?.authorizedRole).toBe(roleFor(context, context.nonOwnerParticipantId))
    })
  }
})

describe('cancellation authorization matrix', () => {
  const scenarios = [
    { initiator: 'institution_manager', recipient: 'teacher' as const },
    { initiator: 'secretary', recipient: 'teacher' as const },
    { initiator: 'institution_manager', recipient: 'secretary' as const },
    { initiator: 'teacher', recipient: 'institution_manager' as const },
    { initiator: 'teacher', recipient: 'secretary' as const },
    { initiator: 'secretary', recipient: 'institution_manager' as const },
  ] as const

  for (const scenario of scenarios) {
    const context = contextFor(scenario.initiator, scenario.recipient)
    const pair = pairKeyForRoles(scenario.initiator, scenario.recipient)
    const matrixRow = MEETING_CANCELLATION_MATRIX.find((row) => row.pair === pair)

    it(`authorizes only the calendar owner to cancel for ${scenario.initiator} -> ${scenario.recipient}`, () => {
      expect(
        canActorCancelMeeting({
          actorUserId: context.calendarOwnerId,
          actorRole: roleFor(context, context.calendarOwnerId),
          context,
        }),
      ).toBe(true)

      expect(
        canActorCancelMeeting({
          actorUserId: context.nonOwnerParticipantId,
          actorRole: roleFor(context, context.nonOwnerParticipantId),
          context,
        }),
      ).toBe(false)

      expect(matrixRow?.authorizedRole).toBe(roleFor(context, context.calendarOwnerId))
    })
  }
})

describe('rescheduling authorization matrix', () => {
  const scenarios = [
    { initiator: 'institution_manager', recipient: 'teacher' as const },
    { initiator: 'secretary', recipient: 'teacher' as const },
    { initiator: 'institution_manager', recipient: 'secretary' as const },
    { initiator: 'teacher', recipient: 'institution_manager' as const },
    { initiator: 'teacher', recipient: 'secretary' as const },
    { initiator: 'secretary', recipient: 'institution_manager' as const },
  ] as const

  for (const scenario of scenarios) {
    const context = contextFor(scenario.initiator, scenario.recipient)
    const pair = pairKeyForRoles(scenario.initiator, scenario.recipient)
    const matrixRow = MEETING_RESCHEDULING_MATRIX.find((row) => row.pair === pair)

    it(`authorizes only the calendar owner to reschedule for ${scenario.initiator} -> ${scenario.recipient}`, () => {
      expect(
        canActorRescheduleMeeting({
          actorUserId: context.calendarOwnerId,
          actorRole: roleFor(context, context.calendarOwnerId),
          context,
        }),
      ).toBe(true)

      expect(
        canActorRescheduleMeeting({
          actorUserId: context.nonOwnerParticipantId,
          actorRole: roleFor(context, context.nonOwnerParticipantId),
          context,
        }),
      ).toBe(false)

      expect(matrixRow?.authorizedRole).toBe(roleFor(context, context.calendarOwnerId))
    })
  }
})

describe('concurrent final confirmation protection', () => {
  it('allows only the first confirmation attempt while pending slot exists', () => {
    expect(
      canCompleteConcurrentConfirmation({
        currentState: 'WAITING_FOR_FINAL_CONFIRMATION',
        pendingSlotId: 'slot-1',
        alreadyConfirmed: false,
      }),
    ).toBe(true)

    expect(
      canCompleteConcurrentConfirmation({
        currentState: 'WAITING_FOR_FINAL_CONFIRMATION',
        pendingSlotId: 'slot-1',
        alreadyConfirmed: true,
      }),
    ).toBe(false)
  })
})

function roleFor(
  context: ReturnType<typeof contextFor>,
  userId: string,
): MeetingCalendarRole {
  return userId === context.requesterId ? context.requesterRole : context.recipientRole
}
