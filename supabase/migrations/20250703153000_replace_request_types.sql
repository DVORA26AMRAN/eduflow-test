-- =============================================================================
-- EduFlow Phase 2D.1A — Replace Request Types
-- =============================================================================
-- Migrates legacy request_type values to the new teacher request categories.
-- Existing rows are updated in place; no requests are deleted.

UPDATE public.requests
SET request_type = 'budget_or_equipment'
WHERE request_type IN ('equipment', 'maintenance', 'pedagogical', 'other');

ALTER TABLE public.requests
    DROP CONSTRAINT requests_request_type_valid;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_request_type_valid CHECK (
        request_type IN (
            'absence',
            'budget_or_equipment',
            'substitute_teacher'
        )
    );

COMMENT ON COLUMN public.requests.request_type IS
    'Teacher request category: absence, budget_or_equipment, or substitute_teacher (Phase 2D.1A).';
