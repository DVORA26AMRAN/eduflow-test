-- =============================================================================
-- MPEX — School registration intake Phase 1A (abuse-event store for IP limits)
-- =============================================================================
-- Stores only hashed client addresses for rate limiting. No raw IPs.
-- No grants to anon/authenticated. Written only by Edge Function (service_role).

CREATE TABLE public.school_registration_intake_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_hash     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_registration_intake_events_ip_hash_not_blank
        CHECK (BTRIM(ip_hash) <> '')
);

COMMENT ON TABLE public.school_registration_intake_events IS
    'Phase 1A intake abuse counters. ip_hash only (SHA-256). No public access.';

CREATE INDEX idx_school_registration_intake_events_ip_created
    ON public.school_registration_intake_events (ip_hash, created_at DESC);

ALTER TABLE public.school_registration_intake_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_registration_intake_events FROM PUBLIC;
REVOKE ALL ON TABLE public.school_registration_intake_events FROM anon;
REVOKE ALL ON TABLE public.school_registration_intake_events FROM authenticated;
