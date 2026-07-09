-- =============================================================================
-- EduFlow — Secretary Institutional Archive RLS
-- =============================================================================
-- Adds secretary institutional archive access on public.requests.
-- Does not modify or remove existing teacher archive policies.
-- No restore/delete policies in this migration.

-- Ensure authenticated users can update archive columns
GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated;

-- Read archived requests within secretary institution (institutional archive)
CREATE POLICY requests_secretary_select_archived_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND archived_at IS NOT NULL
    );

-- Archive only completed/rejected active requests within secretary institution
CREATE POLICY requests_secretary_archive_completed_or_rejected_institution
    ON public.requests
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND status IN ('completed', 'rejected')
        AND archived_at IS NULL
        AND (
            archived_by_user_id IS NULL
            OR archived_by_user_id = auth.uid()
        )
    )
    WITH CHECK (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND status IN ('completed', 'rejected')
        AND archived_at IS NOT NULL
        AND archived_by_user_id = auth.uid()
    );
