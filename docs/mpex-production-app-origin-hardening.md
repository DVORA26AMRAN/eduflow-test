# MPEX Production App-Origin Hardening

## Incident

Production manager invitation redirected to localhost because hosted `APP_URL`
was misconfigured while localhost was Auth allow-listed.

## Root Cause

Server-generated manager invite redirect trusted configured `APP_URL` without
production canonical-origin validation.

## Production Invariant

Production project:
`kkafmsvntwqweudallty`

Canonical application origin:
`https://mpex.school`

Production server-generated user links must fail closed if configured app
origin differs from the canonical origin.

## Environment Detection

Production detection uses the `SUPABASE_URL` hostname
(`kkafmsvntwqweudallty.supabase.co`), not `APP_URL`.

Shared resolver:
`supabase/functions/_shared/mpexAppUrl.ts`

- Production accepts only exact origin `https://mpex.school`.
- Localhost / `127.0.0.1` / `::1` are rejected in production.
- Malformed or unexpected external origins fail closed (no silent rewrite).
- Non-production Supabase URL may intentionally accept loopback origins.

## Protected Flows

- manager invitation (`clever-processor` → `inviteUserByEmail` `redirectTo`)
- substitute-board CTA (`substitute-board-email-dispatcher` → `APP_URL` +
  `/?section=substituteBoard`)

## Non-Goals

- password recovery
- tenant invite redesign
- `www.mpex.school` support

## Deployment Status

| Function | Hardening deploy | Manual production validation |
| --- | --- | --- |
| `clever-processor` | **PASS** (deployed to `kkafmsvntwqweudallty` with `_shared/mpexAppUrl.ts`) | **PASS** — new institution-manager invite opened `https://mpex.school` |
| `substitute-board-email-dispatcher` | **PASS** (deployed to `kkafmsvntwqweudallty` with `_shared/mpexAppUrl.ts`) | **PENDING** |

`APP_URL` was not changed during either hardening deployment; production secret
remains `https://mpex.school` (operator-corrected earlier).

### Manager invitation — completed manual checks

1. Opened MPEX production as Platform Admin.
2. Sent a **new** institution-manager invitation.
3. Opened the **new** email.
4. Invitation link opened under `https://mpex.school`.
5. Manager could continue normal password/setup/login.

### Substitute-board — manual validation still required

Confirm a production substitute-board email CTA opens under `https://mpex.school`
(board section path unchanged: `/?section=substituteBoard`).

Negative localhost protection is covered by automated tests + deployed code
inspection; do **not** corrupt production `APP_URL` to prove failure.
