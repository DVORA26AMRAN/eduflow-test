-- =============================================================================
-- EduFlow — Institution Manager Institutional Archive RLS
-- =============================================================================
-- Allows active institution managers to archive completed/rejected institution
-- requests into the shared institutional archive (archived_at / archived_by_user_id).
-- Does not add restore/delete policies.

GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated;

CREATE POLICY requests_manager_archive_completed_or_rejected_institution
    ON public.requests
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
        AND status IN ('completed', 'rejected')
        AND archived_at IS NULL
        AND (
            archived_by_user_id IS NULL
            OR archived_by_user_id = auth.uid()
        )
    )
    WITH CHECK (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
        AND status IN ('completed', 'rejected')
        AND archived_at IS NOT NULL
        AND archived_by_user_id = auth.uid()
    );
