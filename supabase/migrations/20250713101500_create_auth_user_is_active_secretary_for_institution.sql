-- =============================================================================
-- EduFlow — Secretary Institution Authorization Helper
-- =============================================================================
-- Required by Meeting Calendar and other institution-scoped RLS policies.
-- SECURITY DEFINER avoids recursion with users-table policies.

CREATE OR REPLACE FUNCTION public.auth_user_is_active_secretary_for_institution(
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
          AND u.primary_role = 'secretary'
          AND u.status = 'active'
          AND u.institution_id = p_institution_id
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_secretary_for_institution(UUID) IS
    'Returns true when the authenticated user is an active secretary for the given institution.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_secretary_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_secretary_for_institution(UUID) TO authenticated;
