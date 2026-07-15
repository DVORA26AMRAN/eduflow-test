# Meeting Calendar — Phase 2 Validation Report

## Status

- Phase 1: Approved and applied
- Phase 2: Implemented (workflow UI)
- Phase 3: **NOT STARTED**
- Calendar views / reminders / cancellation UI / rescheduling UI: **NOT INCLUDED**

---

## 1. Updated folder structure

```
src/components/meetingCalendar/
  MeetingCalendarSection.tsx
  MeetingCalendar.css
  CreateMeetingModal.tsx
  MeetingActionModal.tsx
  MeetingRecipientPicker.tsx
  MeetingRecipientPicker.test.tsx
  MeetingProposeSlotsForm.tsx

src/utils/
  meetingCalendarDisplay.ts
  meetingCalendarForm.ts
  meetingCalendar.phase2.test.ts

src/services/
  meetingRecipients.ts
  meetingCalendar.ts                          (updated error mapping + setDuration + slot payload mapping)
  meetingCalendar.phase2.test.ts

supabase/migrations/
  20250714120000_meeting_calendar_phase2_set_duration.sql   (NEW — not applied)

docs/meeting-calendar-phase2.md
```

Dashboard wiring updated in:

- `src/pages/TeacherDashboardPage.tsx`
- `src/pages/SecretaryDashboardPage.tsx`
- `src/pages/ManagerDashboardPage.tsx`

---

## 2. Screens and components created

| Component | Role |
|---|---|
| `MeetingCalendarSection` | Main Phase 2 screen: create CTA + pending buckets |
| `CreateMeetingModal` | Workflow A and B creation |
| `MeetingRecipientPicker` | Searchable single-select recipient dialog |
| `MeetingProposeSlotsForm` | 1–5 slot drafts with calculated end times |
| `MeetingActionModal` | Approve / propose / select / confirm actions |

---

## 3. Routes added

Section IDs (dashboard panel swap, no React Router paths):

- `meetingCalendar` (`MEETING_CALENDAR_SECTION_ID`)
- Nav label: `יומן פגישות`
- Roles: Teacher, Secretary, Manager only

---

## 4. Recipient-picker implementation

- Loads institution users with `id`, `full_name`, `primary_role`, `status`
- Filters to active users in allowed role pairs using Phase 1 `isAllowedMeetingRolePair`
- Hides self and same-role users
- Search by full name
- Single radio selection
- Role labels via existing `translateRole`

---

## 5. Workflow A implementation

Owner-initiated flows (Manager→Teacher, Secretary→Teacher, Manager→Secretary):

1. Create modal predicts owner initiation from roles
2. Requires duration
3. Requires 1–5 slots
4. Calls `meeting_calendar_create_meeting`
5. Calls `meeting_calendar_propose_slots`
6. Recipient selects + confirms via `MeetingActionModal`

---

## 6. Workflow B implementation

Non-owner-initiated flows (Teacher→Manager/Secretary, Secretary→Manager):

1. Create request with subject + reason only (no slots in UI)
2. Create with `duration_minutes = NULL` (non-owner must not send a duration)
3. Calendar owner approves (`approve_by_owner`)
4. Owner sets duration (`set_duration`) then proposes slots
5. Requester selects and confirms

---

## 7–9. Slot proposal / selection / final confirmation

- Proposal: date + start time, calculated end, add/remove, max 5
- Selection: radio group of active-cycle proposed slots
- Final confirmation: explicit `אישור פגישה` button
  - From `WAITING_FOR_SLOT_SELECTION`: select then confirm RPCs
  - From `WAITING_FOR_FINAL_CONFIRMATION`: confirm RPC only

---

## 10. Pending-section behavior

Buckets:

1. Waiting for my approval
2. Waiting for me to propose times
3. Waiting for me to choose a time
4. Waiting for my final confirmation
5. Waiting for the other participant
6. Confirmed (list only)

---

## 11. RPC functions used

- `meeting_calendar_create_meeting`
- `meeting_calendar_approve_by_owner`
- `meeting_calendar_set_duration` (Phase 2 migration; pending approval)
- `meeting_calendar_propose_slots`
- `meeting_calendar_select_slot`
- `meeting_calendar_confirm_meeting`

Reads: `meetings`, `meeting_slots`, `users` (participant-only / institution RLS)

No direct table writes from the client.

---

## 12. Database migrations created

Created (not applied):

`supabase/migrations/20250714120000_meeting_calendar_phase2_set_duration.sql`

Purpose: make `duration_minutes` nullable; Workflow B creates with NULL; owner-only `set_duration`; propose_slots requires duration already set.

**Do not execute until architecture approval.**

Phase 1 migration files were not modified.

---

## 13. Authorization handling

- Frontend filters recipients for UX only
- All mutations go through Phase 1/Phase 2 SECURITY DEFINER RPCs
- Pending actions gated by calendar-owner / non-owner checks in UI, enforced again in DB

---

## 14. Error mapping

Centralized in `mapMeetingCalendarError`:

- אין הרשאה לבצע פעולה זו
- המשתמש שנבחר אינו זמין לתיאום פגישה
- המועד שנבחר כבר אינו זמין
- קיימת פגישה אחרת בזמן זה
- מצב הפגישה השתנה. רעננו את הרשימה ונסו שוב
- לא ניתן להשלים את הפעולה. נסו שוב

---

## 15. Accessibility evidence

- Modals use shared `Modal` (title, focus trap, Escape)
- Recipient search has a label
- Recipient/slot choices use radiogroup/radio
- Confirm button has accessible name `אישור פגישה`
- Status communicated via Hebrew text labels, not color alone

---

## 16. Test files and test names

| File | Coverage |
|---|---|
| `meetingCalendar.phase2.test.ts` | recipient filtering, ownership prediction, form validation, slot drafts, pending buckets, error mapping |
| `meetingCalendar.phase2.test.ts` (services) | create/approve/setDuration/propose/select/confirm RPC integration mocks |
| `MeetingRecipientPicker.test.tsx` | searchable single selection dialog |

---

## 17–19. Test / lint / build results

Automated execution in this environment hit Vitest worker-pool timeouts (`Timeout waiting for worker to respond`) after extended hangs. Re-run locally when the process pool is healthy:

```bash
npm run test -- src/utils/meetingCalendar.phase2.test.ts src/services/meetingCalendar.phase2.test.ts src/components/meetingCalendar/MeetingRecipientPicker.test.tsx
npm run lint
npm run build
```

IDE diagnostics on Phase 2 files reported no linter issues at authoring time.

---

## 20. Known limitations

1. Phase 2 migration (`nullable duration` + `set_duration`) is created but not applied until architecture approval.
2. Participant names come from institution user directory load; missing directory rows fall back to generic labels.
3. No profile images in recipient picker (optional requirement; not currently a shared meeting primitive).

---

## 21. Architectural deviations

| Item | Notes |
|---|---|
| Nullable `duration_minutes` | Forward-only Phase 2 migration; Workflow B create uses NULL |
| Phase 2 `set_duration` RPC | Owner-only; allowed in approval/proposal-wait states; awaits apply |

No silent weakening of Phase 1 authorization. No provisional duration.

---

## 22. Phase 3 not started

Confirmed — no month/week calendar, reminders, notifications, cancellation UI, or rescheduling UI.
