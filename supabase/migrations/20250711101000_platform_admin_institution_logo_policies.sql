-- =============================================================================
-- EduFlow — Platform administrator institution logo management
-- =============================================================================
-- Only active platform administrators may list all institutions and update logo fields.
-- Institution managers, secretaries, and teachers retain read-only institution access.

CREATE OR REPLACE FUNCTION public.auth_user_is_active_platform_admin()
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
          AND u.primary_role = 'platform_admin'
          AND u.status = 'active'
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_platform_admin() IS
    'Returns true when the authenticated user is an active platform (central) administrator.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_platform_admin() TO authenticated;

GRANT UPDATE (logo_url, logo_updated_at) ON public.institutions TO authenticated;

CREATE POLICY institutions_platform_admin_select_all
    ON public.institutions
    FOR SELECT
    TO authenticated
    USING (public.auth_user_is_active_platform_admin());

CREATE POLICY institutions_platform_admin_update_logo
    ON public.institutions
    FOR UPDATE
    TO authenticated
    USING (public.auth_user_is_active_platform_admin())
    WITH CHECK (public.auth_user_is_active_platform_admin());
