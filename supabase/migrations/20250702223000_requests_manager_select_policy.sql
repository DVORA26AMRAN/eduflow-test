-- =============================================================================
-- EduFlow Phase 1C.1B — Manager Requests Read Access
-- =============================================================================
-- Institution managers may read all requests within their institution. Uses a
-- SECURITY DEFINER helper to read public.users without triggering users-table
-- RLS, which prevents policy recursion when requests policies reference users.

CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_manager_for_institution(
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = auth.uid()
          AND u.primary_role = 'institution_manager'
          AND u.status = 'active'
          AND u.institution_id = p_institution_id
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_institution_manager_for_institution(UUID) IS
    'Returns true when the authenticated user is an active institution manager for the given institution.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_institution_manager_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_institution_manager_for_institution(UUID) TO authenticated;

CREATE POLICY requests_manager_select_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );
