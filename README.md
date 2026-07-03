# EduFlow  
## Project Status



- Version: EduFlow MVP v1

- Status: Feature Complete

- Date: July 2026

EduFlow is a multi-tenant school operations web application for managing institutional service requests. Each school (institution) operates in an isolated tenant boundary. Users authenticate through Supabase Auth and interact with role-specific dashboards in Hebrew with right-to-left (RTL) layout.

The frontend is a React + TypeScript single-page application backed by Supabase (PostgreSQL, Row Level Security, Auth, and Edge Functions).

---

## Project overview

EduFlow supports the full lifecycle of internal school requests—from a teacher submitting a need, through secretary processing, to manager oversight of team and activity.

**Key characteristics:**

- **Multi-tenant by institution** — All data is scoped to an `institution_id`. Users belong to exactly one institution.
- **Role-based dashboards** — Managers, teachers, and secretaries each see a tailored experience after login.
- **Database-enforced security** — Row Level Security (RLS) policies restrict reads and writes at the PostgreSQL layer.
- **Hebrew-first UI** — Labels, messages, and layout are designed for Hebrew-speaking users (RTL).

---



## Main user roles



### Institution Manager

- Views institution-wide analytics (active staff counts, request totals by status).
- Sees recent requests and recent status-change activity.
- Manages the institution team: search users, invite teachers and secretaries.
- Read-only access to institution requests (no request status updates from the manager dashboard).



### Teacher

- Creates service requests (equipment, maintenance, pedagogical, other).
- Views their own submitted requests and current statuses.
- Receives in-app notifications when a secretary updates request status.
- Marks notifications as read.



### Secretary

- Views all requests within the institution (inbox).
- Filters requests by teacher name, type, and status.
- Updates request status (`new` → `in_progress` → `completed` / `rejected`).
- Views per-request status history in a history panel.

---



## Core workflows



### User invitation

1. An institution manager fills out the create-user form (name, email, role).
2. The frontend calls the `clever-processor` Supabase Edge Function with the manager's session token.
3. The Edge Function invites the user by email and creates a corresponding row in `public.users` for the manager's institution.



### Password setup

1. The invited user opens the email link (Supabase Auth invite / recovery callback).
2. The app detects the auth callback and routes to the password setup page.
3. The user sets a password; `password_setup_complete` is stored in user metadata.
4. After setup, the app loads the user profile and routes to the role-appropriate dashboard.



### Teacher creates request

1. The teacher opens the create-request form on their dashboard.
2. They select a request type and enter a description.
3. `createTeacherRequest()` inserts a row into `requests` with the teacher's `institution_id` and `created_by_user_id`.
4. RLS ensures teachers can only create requests for their own institution and read their own submissions.



### Secretary processes request

1. The secretary opens the requests inbox (all institution requests, newest first).
2. They filter or search as needed.
3. They change status via an inline dropdown; `updateRequestStatus()` persists the change.
4. RLS allows secretaries to read and update status for requests in their institution only.



### Request status history

1. On every `requests.status` update, a database trigger appends a row to `request_status_history` (previous status, new status, actor, timestamp).
2. Secretaries open **היסטוריה** on a request to view the full timeline.
3. Managers see the five most recent status changes institution-wide on their dashboard.



### Teacher notifications

1. On status change, a database trigger inserts a Hebrew notification into `notifications` for the request creator.
2. Teachers see unread/read notifications on their dashboard.
3. Clicking an unread notification marks it as read (`is_read = true`).



### Manager analytics

1. On dashboard load, `loadManagerAnalytics()` aggregates active teachers, active secretaries, and request counts by status.
2. `loadRecentRequests()` fetches the five newest institution requests with teacher names.
3. `loadRecentRequestActivity()` fetches the five newest rows from `request_status_history`.
4. All queries rely on RLS to return only the manager's institution data.

---



## Tech stack


| Layer          | Technology                                                        |
| -------------- | ----------------------------------------------------------------- |
| UI             | React 19, TypeScript                                              |
| Build          | Vite                                                              |
| Styling        | Custom design system (`src/design-system/`), component-scoped CSS |
| Auth           | Supabase Auth (email / invite flow)                               |
| Database       | Supabase PostgreSQL                                               |
| Access control | Supabase Row Level Security (RLS)                                 |
| Server logic   | Supabase Edge Functions (`clever-processor` for user creation)    |
| Client SDK     | `@supabase/supabase-js`                                           |


---



## Project structure

```
eduflow-test/
├── src/
│   ├── App.tsx                 # Auth orchestration, role routing
│   ├── main.tsx
│   ├── design-system/          # Shared tokens, buttons, forms, cards, tables
│   ├── components/
│   │   ├── manager/            # Header, stats, team, recent requests/activity
│   │   ├── teacher/            # Header, requests, notifications
│   │   └── secretary/          # Header, inbox, filters, table, history panel
│   ├── pages/                  # Login, PasswordSetup, role dashboards
│   ├── services/
│   │   ├── supabase.ts         # Supabase client
│   │   ├── auth.ts             # Auth callback / password-setup helpers
│   │   ├── profile.ts          # Current user role loading
│   │   ├── institutionUsers.ts # Manager team list
│   │   ├── requests.ts         # Request CRUD, secretary inbox, history
│   │   ├── notifications.ts    # Teacher notifications
│   │   └── analytics.ts        # Manager analytics and insights
│   ├── types/                  # user, request, notification, analytics
│   └── utils/                  # roles, request labels/filters
├── supabase/
│   └── migrations/             # Versioned SQL migrations (schema, RLS, triggers)
├── package.json
└── README.md
```

**Architecture conventions:**

- `App.tsx` handles authentication state and top-level routing only.
- Business logic lives in `src/services/`.
- Dashboard pages compose small, role-specific components.
- Types are centralized under `src/types/`.

---



## Security model



### Tenant isolation

- Every user row references one `institution_id`.
- Tenant-owned tables (`requests`, `notifications`, `request_status_history`, etc.) carry `institution_id` for scoped policies and indexing.



### Row Level Security (RLS)

RLS is enabled on sensitive tables. Policies typically verify:

- The authenticated user is **active** (`status = 'active'`).
- The user's `primary_role` matches the intended operation.
- `institution_id` on the target row matches the user's institution.

**SECURITY DEFINER helper functions** (e.g. `auth_user_is_active_secretary_for_institution`, `auth_user_is_active_institution_manager_for_institution`) read `public.users` without triggering recursive RLS on the users table.

### Role capabilities (summary)


| Role      | Requests                        | Status history             | Notifications   | Team / analytics      |
| --------- | ------------------------------- | -------------------------- | --------------- | --------------------- |
| Teacher   | Create own; read own            | Read own requests          | Read/update own | —                     |
| Secretary | Read institution; update status | Read institution           | —               | —                     |
| Manager   | Read institution                | Read institution (via RLS) | —               | Read users; analytics |




### Triggers (server-side, not client)

- `requests_write_status_history` — Appends to `request_status_history` on status change.
- `requests_create_status_notification` — Creates a teacher notification on status change.

Writes from triggers use `SECURITY DEFINER` so clients do not need broad INSERT policies.

### Edge Functions

- `clever-processor` — Privileged user invitation and `public.users` provisioning. Called only with a valid manager session Bearer token.



### Frontend

- The Supabase **anon** key is used in the browser; authorization is enforced by RLS and Auth session JWTs, not by trusting client-side role checks alone.

---



## Local development



### Prerequisites

- Node.js (LTS recommended)
- npm
- A Supabase project with migrations applied and the `clever-processor` Edge Function deployed



### Setup

```bash
npm install
npm run dev
```

The Vite dev server starts (default: `http://localhost:5173`). Open it in a browser and sign in with a user that exists in both Supabase Auth and `public.users`.

### Other scripts

```bash
npm run build    # Type-check and production build
npm run preview  # Preview production build
npm run lint     # ESLint
```



### Environment

Supabase URL and anon key are configured in `src/services/supabase.ts`. For a different Supabase project, update those values and ensure migrations are applied.

---



## Current project status

**Completed (Phase 1):**


| Area                                                                             | Status |
| -------------------------------------------------------------------------------- | ------ |
| Multi-tenant schema (institutions, users, capabilities, audit logs)              | Done   |
| Supabase Auth login and invite / password setup flow                             | Done   |
| Manager dashboard (team management, analytics cards, recent requests & activity) | Done   |
| Teacher dashboard (create request, list requests, notifications)                 | Done   |
| Secretary dashboard (inbox, filters, status updates, history panel)              | Done   |
| `requests` table with teacher/secretary/manager RLS (in repo + production)       | Done   |
| `request_status_history` with auto-write trigger                                 | Done   |
| `notifications` with auto-create trigger on status change                        | Done   |
| Design system applied to Login, Manager, and Teacher dashboards                  | Done   |
| Hebrew UI and RTL across implemented dashboards                                  | Done   |


**Known gaps / in progress:**

- Secretary dashboard styling has not yet been migrated to the shared design system.
- Manager `request_status_history` read access may require a dedicated RLS policy in production if not yet deployed beyond `requests` SELECT.
- User invitation via Edge Function may fail server-side in some environments (investigate Edge Function logs if invite returns HTTP 500).
- Some early migrations may exist only in the Supabase SQL Editor history; see `supabase/migrations/README.md`.

---



## Future roadmap

Planned or deferred enhancements:

- **Analytics charts** — Visual trends for managers (request volume, status breakdown over time).
- **Real-time updates** — Supabase Realtime subscriptions for inbox and notifications.
- **Secretary UI polish** — Apply design system tokens and components to the secretary dashboard.
- **Expanded manager tools** — Export, reporting, and deeper operational views.
- **Capability grants** — Fine-grained permissions beyond `primary_role` (schema foundation exists).
- **Audit log UI** — Surface `audit_logs` for compliance and troubleshooting.
- **Network / multi-school hierarchy** — Parent organization support above institutions.
- **Edge Function hardening** — Improved error handling and observability for user provisioning.

---



## License

Private project (`package.json`: `"private": true`). All rights reserved unless otherwise specified by the project owner.