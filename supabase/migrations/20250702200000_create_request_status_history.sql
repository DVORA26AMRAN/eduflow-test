-- =============================================================================
-- EduFlow Phase 1B.4A — Request Status History Database Foundation
-- =============================================================================
-- Append-only audit trail for request status transitions. institution_id is
-- denormalized from the parent request for tenant-scoped secretary reads.
-- INSERT/UPDATE/DELETE policies are deferred; service role will write history
-- in a future phase.

CREATE TABLE public.request_status_history (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID        NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    changed_by_user_id  UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    previous_status     TEXT        NOT NULL,
    new_status          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT request_status_history_previous_status_valid CHECK (
        previous_status IN ('new', 'in_progress', 'completed', 'rejected')
    ),
    CONSTRAINT request_status_history_new_status_valid CHECK (
        new_status IN ('new', 'in_progress', 'completed', 'rejected')
    )
);

COMMENT ON TABLE public.request_status_history IS
    'Append-only history of request status changes (Phase 1B.4A).';

CREATE INDEX idx_request_status_history_request_id
    ON public.request_status_history (request_id);

CREATE INDEX idx_request_status_history_institution_id
    ON public.request_status_history (institution_id);

CREATE INDEX idx_request_status_history_changed_by_user_id
    ON public.request_status_history (changed_by_user_id);

CREATE INDEX idx_request_status_history_request_id_created_at
    ON public.request_status_history (request_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS helper (SECURITY DEFINER avoids recursion with users/requests policies)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_is_active_teacher_who_created_request(
    p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.requests AS r
        INNER JOIN public.users AS u ON u.id = auth.uid()
        WHERE r.id = p_request_id
          AND r.created_by_user_id = auth.uid()
          AND u.primary_role = 'teacher'
          AND u.status = 'active'
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_teacher_who_created_request(UUID) IS
    'Returns true when the authenticated user is an active teacher who created the given request.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_teacher_who_created_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_teacher_who_created_request(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.request_status_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.request_status_history TO authenticated;

CREATE POLICY request_status_history_teacher_select_own_requests
    ON public.request_status_history
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_teacher_who_created_request(request_id)
    );

CREATE POLICY request_status_history_secretary_select_institution
    ON public.request_status_history
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );
