# Substitute Board email dispatcher (N1 / N1A / N1B)

Async outbox worker for **new** `substitute_board_posts` INSERT notifications.

## Invocation

- **Cron / backend only** with `Authorization: Bearer <service_role JWT>`
- `requireServiceRoleJwt` rejects anon/authenticated JWTs even when `verify_jwt = true`
- Request body must **not** include recipients, `to`, or authoritative email content
- Ordinary Teacher / Secretary / Deputy / Manager / anon cannot process the outbox

## Production scheduler (N1B)

Migration: `20250820109100_substitute_board_email_dispatcher_cron_n1b.sql`

```text
pg_cron (* * * * *)
  → net.http_post
  → /functions/v1/substitute-board-email-dispatcher
```

Vault secret **names** (values never in source):

| Vault name | Header |
|------------|--------|
| `PROJECT_PUBLISHABLE_KEY` | `apikey` |
| `CRON_SERVICE_ROLE_KEY` | `Authorization: Bearer …` |

Overlapping cron ticks are safe under N1A `SKIP LOCKED` + 5-minute leases.

**Apply order:** deploy the Edge Function **before** applying the scheduler
migration so cron never calls a missing function.

## Secrets (Edge Function)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected; worker DB access |
| `RESEND_API_KEY` | Resend HTTP API |
| `SUBSTITUTE_BOARD_SENDER_EMAIL` | Verified From address (see below) |
| `APP_URL` | Production must be `https://mpex.school` |

### Sender format

`SUBSTITUTE_BOARD_SENDER_EMAIL` is passed to Resend `from` as a string.

Accepted:

- raw address: `notifications@your-verified-domain.com`
- display name: `MPEX <notifications@your-verified-domain.com>`

Must use a Resend-verified domain/address. Do **not** hardcode a sender and do
**not** reuse Phase 3 `QUOTATION_SENDER_EMAIL`.

### CEO Resend checklist (before production apply)

1. Confirm Resend account API key for production.
2. Verify the sending domain (DNS) in Resend.
3. Confirm the exact From address (or display-name form) is allowed for that domain.
4. Set `SUBSTITUTE_BOARD_SENDER_EMAIL` to that verified value only.
5. Set `APP_URL=https://mpex.school` (not localhost).

## N1 CTA limitation

Emails link to:

`{APP_URL}/?section=substituteBoard`

This opens the Substitute Board **section only**. Exact `postId` focus and
post-login return-to are **N2**.

## Batching + leases (N1A)

- Claim up to **5** jobs per invocation (`claim_substitute_board_email_jobs`)
- Atomically claim up to **25** deliveries per job (`claim_substitute_board_email_deliveries`)
- Lease: **5 minutes** (`SUBSTITUTE_BOARD_EMAIL_LEASE_INTERVAL`)
- Max **5** delivery claims → failed 5th attempt becomes `skipped`
- Stale `processing` (expired lease) is reclaimable; valid leases are not

## Delivery semantics

At-least-once: if the provider accepts the message and the worker crashes before
marking `sent`, the delivery may be reclaimed after lease expiry. Duplicate
external sends are reduced by the deterministic Resend Idempotency-Key:

`mpex/substitute-board/v1/{post_id}/{recipient_user_id}`

`attempt_count` = number of atomic delivery claims (increments once per claim).

Already-`sent` / `skipped` rows are never reclaimed.

## Controlled live test (no production filter)

Do **not** add hidden recipient filters. Use a dedicated test institution whose
active Teachers are only known test inboxes, then create one board post there.

## Isolation

Does **not** import Phase 3 quotation sender modules.
