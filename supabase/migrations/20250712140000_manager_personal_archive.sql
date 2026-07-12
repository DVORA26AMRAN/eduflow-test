-- =============================================================================
-- EduFlow — Manager personal archive (per-user dashboard visibility)
-- =============================================================================
-- Replaces the rejected shared-field manager archive approach.
-- Personal archive state lives in manager_archived_requests, not on public.requests.

DROP POLICY IF EXISTS requests_manager_archive_completed_or_rejected_institution
    ON public.requests;

CREATE TABLE public.manager_archived_requests (
    manager_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (manager_user_id, request_id)
);

COMMENT ON TABLE public.manager_archived_requests IS
    'Per-manager personal archive visibility. Does not change shared request lifecycle.';

CREATE INDEX idx_manager_archived_requests_manager_archived_at
    ON public.manager_archived_requests (manager_user_id, archived_at DESC);

ALTER TABLE public.manager_archived_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.manager_archived_requests FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.manager_archived_requests TO authenticated;

CREATE POLICY manager_archived_requests_select_own
    ON public.manager_archived_requests
    FOR SELECT
    TO authenticated
    USING (manager_user_id = auth.uid());

CREATE POLICY manager_archived_requests_insert_own_institution
    ON public.manager_archived_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        manager_user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.users AS manager_user
            INNER JOIN public.requests AS request_row
                ON request_row.institution_id = manager_user.institution_id
            WHERE manager_user.id = auth.uid()
              AND manager_user.primary_role = 'institution_manager'
              AND manager_user.status = 'active'
              AND request_row.id = request_id
        )
    );
