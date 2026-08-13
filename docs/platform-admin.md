# EduFlow — Platform Admin architecture

## Model

Platform Admin is a **global** operator, not a tenant user.

| Field | Required value |
| ----- | -------------- |
| `primary_role` | `platform_admin` |
| `status` | `active` |
| `institution_id` | **NULL** |

Database invariant (`users_institution_id_role_consistency`):

- `platform_admin` → `institution_id IS NULL`
- `teacher` / `secretary` / `institution_manager` → `institution_id IS NOT NULL`

`public.user_role` includes: `institution_manager`, `secretary`, `teacher`, `platform_admin`.

## Phase 1 (institution management)

Product functionality is approved (list/create/get/edit institutions + logos).

- List / create / get / update institution metadata via SECURITY DEFINER RPCs (`platform_admin_*`).
- Institution logo upload/remove via existing client Storage path + narrow `institutions` UPDATE on `logo_url` / `logo_updated_at`.

Final DB invariants (enum, CHECK, global helpers, Storage, logo grants) are asserted by the forward migration `20250812220000_platform_admin_global_baseline_alignment.sql`.

## Phase 2 (Institution Manager invitation)

- Platform Admin invites **exactly one active** `institution_manager` per school via extended `clever-processor`.
- `institution_id` for the Manager is verified server-side from the opened school (never chosen by the Manager).
- Application-owned onboarding: `public.users.onboarding_completed_at` (`NULL` = awaiting; timestamp = joined).
- Partial unique index: one **active** `institution_manager` per `institution_id` (invited + joined occupy the slot; inactive frees it for replacement).
- Status RPC: `platform_admin_get_institution_manager`.
- Password setup calls `complete_own_user_onboarding()` for the current user only.
- UI: Manager panel in `PlatformAdminSchoolsSection` details (not inside `InstitutionForm`).

## Authorization surfaces

### RPC gate

`platform_admin_require_active()` — active `platform_admin` with `institution_id IS NULL`. Helpers are not executable by `authenticated` clients.

### Storage (`institution-logos`)

- Bucket is **public** (branding URLs).
- INSERT / UPDATE / DELETE: `authenticated` + `bucket_id = 'institution-logos'` + `auth_user_is_active_platform_admin()`.
- SELECT (authenticated API): same bucket scope for authenticated clients.
- Other buckets (request attachments, printing files) are untouched.

### Institutions table (logo metadata)

- Column grant: `UPDATE (logo_url, logo_updated_at)` only — not broad table UPDATE.
- RLS: `institutions_platform_admin_select_all`, `institutions_platform_admin_update_logo` gated by `auth_user_is_active_platform_admin()`.

### Manager invite

- Edge Function `clever-processor` (service role Edge-only).
- Tenant callers ignore/forbid body `institution_id`; PA branch verifies body `institution_id`.
- **Initial invite:** `inviteUserByEmail` with `redirectTo` from Edge secret `APP_URL` (fallbacks: `EDUFLOW_APP_URL`, `SITE_URL`). Supabase Auth delivers the invite email.
- **Awaiting Manager:** status shown in UI; **no resend in Phase 2**. Re-invite attempt returns `manager_invite_pending` (slot stays occupied).
- **Resend / replace:** deferred to **Phase 2B** (requires a coherent invite-link delivery path; do not use password recovery as an invite substitute).

## Repository migrations

| Migration | Role |
| --------- | ---- |
| `20250711100000_institution_logo_fields.sql` | Historical: logo columns |
| `20250711101000_platform_admin_institution_logo_policies.sql` | Historical: helper + logo policies |
| `20250711102000_institution_logos_storage.sql` | Historical: bucket + Storage policies |
| `20250812180000_platform_admin_institution_management_phase1.sql` | Historical: contact fields + admin RPCs |
| `20250812220000_platform_admin_global_baseline_alignment.sql` | Global Platform Admin baseline |
| `20250813010000_platform_admin_manager_invitation_phase2.sql` | Phase 2 onboarding + one-active-manager + RPCs |

## Out of scope (later)

- Manager invite **resend** and deactivate/replace Manager UI (**Phase 2B**) — DB slot model already supports inactive → re-invite; resend needs proper invite-link email delivery (not password recovery)
- Platform Admin staff directory across tenants
- Broad authenticated writes to Storage or institutions
