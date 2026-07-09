-- =============================================================================
-- EduFlow — Teacher Self-Archive RLS
-- =============================================================================
-- Allows teachers to archive their own active requests by setting
-- archived_at / archived_by_user_id only.
-- Does not modify existing secretary archive policy.

-- Column-level UPDATE grant (idempotent if already applied in 20250703152000)
GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated;

CREATE POLICY requests_teacher_archive_own
    ON public.requests
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_teacher()
        AND created_by_user_id = auth.uid()
        AND archived_at IS NULL
        AND (
            archived_by_user_id IS NULL
            OR archived_by_user_id = auth.uid()
        )
    )
    WITH CHECK (
        public.auth_user_is_active_teacher()
        AND created_by_user_id = auth.uid()
        AND archived_by_user_id = auth.uid()
        AND archived_at IS NOT NULL
    );
