-- =============================================================================
-- EduFlow Phase 2D.1C — Request Payload Column
-- =============================================================================
-- Structured category-specific data stored as JSON alongside description.
-- Existing rows receive an empty object default.

ALTER TABLE public.requests
    ADD COLUMN request_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_payload_is_object CHECK (
        jsonb_typeof(request_payload) = 'object'
    );

COMMENT ON COLUMN public.requests.request_payload IS
    'Structured request data by category (Phase 2D.1C).';
