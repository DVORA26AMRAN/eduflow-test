# EduFlow MVP — Smoke Test Checklist

Manual QA checklist for verifying core EduFlow functionality before release or after significant changes.

**How to use this document**

1. Run the app locally (`npm run dev`) against a Supabase project with all migrations applied.
2. Use test accounts for each role (manager, teacher, secretary) within the same institution.
3. Execute each test in order where dependencies exist (e.g. create users before testing teacher workflow).
4. Mark **Pass** or **Fail** for each item. Add notes in the **Notes** column if a test fails.

**Test environment**

| Field | Value |
|-------|-------|
| Date | |
| Tester | |
| App URL | |
| Supabase project | |
| Browser | |

---

## 1. Authentication

### 1.1 Manager login

**Test steps**

1. Open the app login page.
2. Enter a valid institution manager email and password.
3. Submit the login form.

**Expected result**

- Login succeeds without error.
- User is routed to the **Manager Dashboard** (team management, analytics cards, recent requests/activity).
- Hebrew RTL layout is displayed.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 1.2 Teacher login

**Test steps**

1. Log out if already signed in.
2. Enter a valid teacher email and password.
3. Submit the login form.

**Expected result**

- Login succeeds without error.
- User is routed to the **Teacher Dashboard** (create request form, requests list, notifications).
- Hebrew RTL layout is displayed.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 1.3 Secretary login

**Test steps**

1. Log out if already signed in.
2. Enter a valid secretary email and password.
3. Submit the login form.

**Expected result**

- Login succeeds without error.
- User is routed to the **Secretary Dashboard** (requests inbox, filters, status controls).
- Hebrew RTL layout is displayed.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 1.4 Logout

**Test steps**

1. Sign in as any role (manager, teacher, or secretary).
2. Click the logout button on the dashboard.
3. Attempt to use the browser back button or refresh while logged out.

**Expected result**

- Session ends and user returns to the login page.
- Dashboard content is not accessible without signing in again.
- No authenticated data is shown after logout.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 2. User management

### 2.1 Manager creates teacher

**Test steps**

1. Sign in as an institution manager.
2. Open the create-user form in team management.
3. Enter a new teacher name and email, select role **מורה** (teacher).
4. Submit the form.

**Expected result**

- Form submits without a client-side error.
- Success message is shown (or user appears in the team list after refresh).
- New user row appears in the team table with the correct name, email, and role.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 2.2 Manager creates secretary

**Test steps**

1. Remain signed in as manager (or sign in again).
2. Open the create-user form.
3. Enter a new secretary name and email, select role **מזכירות** (secretary).
4. Submit the form.

**Expected result**

- Form submits without a client-side error.
- Success message is shown (or user appears in the team list).
- New user row appears with secretary role.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 2.3 Invitation email is sent

**Test steps**

1. After creating a new user (teacher or secretary), check the email inbox for the address used.
2. Confirm the invite email from Supabase / EduFlow arrives within a reasonable time.

**Expected result**

- Invitation email is received.
- Email contains a link to complete account setup / set password.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 2.4 Invited user sets password

**Test steps**

1. Open the invitation link from the email in a browser (incognito recommended).
2. Complete the password setup form with a valid password.
3. Confirm password and save.
4. Verify the user lands on the correct role dashboard.

**Expected result**

- Password setup page loads from the invite link.
- Password is accepted and saved.
- User is authenticated and routed to the dashboard matching their role (teacher or secretary).
- Subsequent logins work with the new password.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 3. Teacher workflow

### 3.1 Teacher creates request without attachment

**Test steps**

1. Sign in as a teacher.
2. Open the create-request form (**פתיחת בקשה חדשה**).
3. Select a request type and enter a description.
4. Leave **קובץ מצורף** empty.
5. Click **שליחת בקשה**.

**Expected result**

- Request is created successfully.
- Success message **בקשה נשלחה בהצלחה.** is shown.
- New request appears in the teacher's request list with status **חדש** (new).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 3.2 Teacher creates request with image attachment

**Test steps**

1. Sign in as a teacher.
2. Create a new request with type and description.
3. Attach a valid PNG or JPEG image under 5 MB.
4. Submit the form.

**Expected result**

- Request is created successfully.
- Success message **בקשה נשלחה בהצלחה.** is shown.
- No upload error message appears.
- Request appears in the teacher's list.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 3.3 Teacher creates request with PDF attachment

**Test steps**

1. Sign in as a teacher.
2. Create a new request with type and description.
3. Attach a valid PDF file under 5 MB.
4. Submit the form.

**Expected result**

- Request is created successfully.
- Success message **בקשה נשלחה בהצלחה.** is shown.
- No upload error message appears.
- Request appears in the teacher's list.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 3.4 Teacher sees own requests only

**Test steps**

1. Sign in as **Teacher A**.
2. Note the requests visible in **רשימת בקשות**.
3. Sign out and sign in as **Teacher B** (same institution, different teacher).
4. Compare visible requests.
5. Optionally verify in Supabase that Teacher A's requests exist but are not listed for Teacher B.

**Expected result**

- Each teacher sees only requests they created.
- Teacher B does not see Teacher A's requests in the UI.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 3.5 Teacher sees notifications

**Test steps**

1. Sign in as a secretary and change the status of a request created by a specific teacher.
2. Sign out and sign in as that teacher.
3. Open the notifications section on the teacher dashboard.

**Expected result**

- A notification appears related to the status change.
- Notification text is in Hebrew and describes the update.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 3.6 Teacher marks notification as read

**Test steps**

1. Sign in as a teacher with at least one unread notification.
2. Note the unread count or visual unread state.
3. Click the unread notification.

**Expected result**

- Notification is marked as read.
- Unread indicator/count decreases.
- Notification remains visible in the list as read.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 4. Secretary workflow

### 4.1 Secretary sees institution requests

**Test steps**

1. Ensure multiple teachers in the same institution have submitted requests.
2. Sign in as a secretary for that institution.
3. Open the requests inbox (**תיבת בקשות**).

**Expected result**

- All institution requests from all teachers are listed.
- Each row shows teacher name, type, description, status, and date.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 4.2 Secretary filters requests

**Test steps**

1. Sign in as a secretary with multiple requests in the inbox.
2. Use the teacher name search filter.
3. Use the request type filter.
4. Use the status filter.
5. Clear or change filters and verify the list updates.

**Expected result**

- List narrows to matching requests for each filter.
- Combined filters work as expected.
- Empty filter state shows appropriate message when no matches (**לא נמצאו בקשות התואמות לחיפוש.**).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 4.3 Secretary updates request status

**Test steps**

1. Sign in as a secretary.
2. Select a request with status **חדש** (new).
3. Change status to **בטיפול** (in progress) via the status dropdown.
4. Change status again to **הושלם** (completed) or **נדחה** (rejected).

**Expected result**

- Each status change saves successfully.
- Success message **סטטוס הבקשה עודכן בהצלחה.** is shown.
- Updated status persists after page refresh.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 4.4 Secretary views status history

**Test steps**

1. Sign in as a secretary.
2. Find a request whose status was changed at least once.
3. Click **היסטוריה** on that row.
4. Review the history panel.

**Expected result**

- History panel opens.
- Previous status, new status, and date/time are shown for each transition.
- Entries are ordered newest first.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 4.5 Secretary opens attachment

**Test steps**

1. Ensure a request exists with a file attachment (created by a teacher).
2. Sign in as a secretary.
3. Locate the request in the inbox (**קובץ מצורף** column).
4. Click **צפייה בקובץ**.

**Expected result**

- Row shows **צפייה בקובץ** (not **אין קובץ**) for requests with attachments.
- Brief loading state **טוען קובץ...** may appear.
- File opens in a new browser tab (image or PDF renders correctly).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 5. Manager dashboard

### 5.1 Manager sees active teachers count

**Test steps**

1. Sign in as an institution manager.
2. Note the number of active teachers in Supabase (or known test data).
3. Compare with the **מספר מורים פעילים** analytics card.

**Expected result**

- Card displays the correct count of active teachers in the institution.
- Inactive teachers are not included.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 5.2 Manager sees active secretaries count

**Test steps**

1. Remain on the manager dashboard.
2. Note the number of active secretaries in test data.
3. Compare with the **מספר מזכירות פעילות** analytics card.

**Expected result**

- Card displays the correct count of active secretaries in the institution.
- Inactive secretaries are not included.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 5.3 Manager sees request status analytics

**Test steps**

1. Remain on the manager dashboard.
2. Verify analytics cards for:
   - **סך הבקשות**
   - **בקשות חדשות**
   - **בקשות בטיפול**
   - **בקשות שהושלמו**
   - **בקשות שנדחו**
3. Cross-check totals against known request data in the institution.

**Expected result**

- All seven analytics cards load without error.
- Counts match institution request data by status.
- Loading shows **טוען נתונים...**; failures show **טעינת הנתונים נכשלה.**

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 5.4 Manager sees recent requests

**Test steps**

1. Remain on the manager dashboard.
2. Review the **בקשות אחרונות** section.
3. Create a new teacher request and refresh the manager dashboard.

**Expected result**

- Up to 5 most recent institution requests are shown.
- Each row shows teacher name, request type, status, and date.
- Newest requests appear first.
- New request appears after refresh (if among the 5 most recent).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 5.5 Manager sees recent activity

**Test steps**

1. Remain on the manager dashboard.
2. Review the **פעילות אחרונה** section.
3. As secretary, update a request status, then refresh the manager dashboard.

**Expected result**

- Up to 5 most recent status changes are shown.
- Each entry shows previous status → new status and date/time.
- Newest activity appears first.
- Latest status change appears after refresh (if among the 5 most recent).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 6. Security checks

> These tests verify authorization boundaries. Use browser devtools or Supabase client only if UI does not expose the action; the expected result is always **denied** or **not visible**.

### 6.1 Teacher cannot see other teachers' requests

**Test steps**

1. Sign in as Teacher A.
2. Attempt to view Teacher B's requests via the UI.
3. Optionally query `requests` as Teacher A via Supabase client with RLS (should return only own rows).

**Expected result**

- Teacher A's dashboard lists only their own requests.
- No UI path exposes other teachers' requests.
- Direct API access returns only own requests (RLS enforced).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 6.2 Teacher cannot update request status

**Test steps**

1. Sign in as a teacher.
2. Confirm there is no status dropdown or status-update control on the teacher dashboard.
3. Optionally attempt `UPDATE` on `requests.status` via Supabase client as the teacher.

**Expected result**

- No status update UI is available to teachers.
- Direct update attempt fails (RLS / permissions denied).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 6.3 Secretary cannot create users

**Test steps**

1. Sign in as a secretary.
2. Confirm there is no create-user form or team management UI.
3. Optionally attempt to call the `clever-processor` Edge Function with the secretary's session token.

**Expected result**

- Secretary dashboard has no user-creation capability.
- Edge Function call is rejected (unauthorized / not manager).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 6.4 Secretary cannot delete requests

**Test steps**

1. Sign in as a secretary.
2. Confirm there is no delete-request control in the inbox.
3. Optionally attempt `DELETE` on `requests` via Supabase client as the secretary.

**Expected result**

- No delete UI is available.
- Direct delete attempt fails (RLS / permissions denied).

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 6.5 Manager sees only institution data

**Test steps**

1. Sign in as a manager for **Institution A**.
2. Review analytics, recent requests, recent activity, and team list.
3. Compare with data known to belong to **Institution B** (different tenant).

**Expected result**

- All manager dashboard data belongs to Institution A only.
- No users, requests, or activity from Institution B appear.
- Counts match Institution A data only.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## 7. File attachment checks

### 7.1 Unsupported file type is rejected

**Test steps**

1. Sign in as a teacher.
2. Open the create-request form.
3. Attempt to attach an unsupported file (e.g. `.docx`, `.txt`, or `.gif`).
4. Submit or observe validation on file selection.

**Expected result**

- File is rejected before or on submit.
- Error message **סוג הקובץ אינו נתמך.** is displayed.
- Request is not created with the invalid attachment.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 7.2 File larger than 5MB is rejected

**Test steps**

1. Sign in as a teacher.
2. Open the create-request form.
3. Attempt to attach a valid type (PNG, JPEG, or PDF) larger than 5 MB.
4. Submit or observe validation on file selection.

**Expected result**

- File is rejected before or on submit.
- Error message **גודל הקובץ חייב להיות עד 5MB.** is displayed.
- Request is not created with the oversized file.

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

### 7.3 Valid file opens for secretary

**Test steps**

1. Create a request with a valid PNG, JPEG, or PDF under 5 MB (as teacher).
2. Sign in as secretary.
3. Click **צפייה בקובץ** for that request.

**Expected result**

- File opens in a new tab without error.
- Content matches the uploaded file (image displays or PDF loads).
- No error message **טעינת הקובץ נכשלה.**

**Result**

- [ ] Pass
- [ ] Fail

**Notes:**

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| QA tester | | | |
| Product / owner | | | |

**Overall result**

- [ ] All critical tests passed — MVP ready for next stage
- [ ] Failures documented — not ready

**Summary of failures:**

```
(list failed test IDs and brief description)
```
