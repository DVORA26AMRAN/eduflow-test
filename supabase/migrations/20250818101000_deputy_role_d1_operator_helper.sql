-- =============================================================================
-- MPEX D1 — Institution operator helper (after deputy enum commit)
-- =============================================================================
-- Depends on 20250818100000 having committed ADD VALUE 'deputy'.
-- Creates auth_user_is_active_institution_operator_for_institution:
--   active institution_manager OR deputy in the same institution.
-- Fail closed: NULL institution, Platform Admin, Secretary, Teacher → false.
-- Does NOT replace or broaden auth_user_is_active_institution_manager_for_institution.
-- Does NOT attach operational RLS (D2).
-- Does NOT add a one-deputy-per-institution unique constraint.
--
-- Preserved by earlier migrations (untouched here):
--   users_one_active_institution_manager_per_institution (Manager-only)
--   users_institution_id_role_consistency (tenant roles including deputy
--   require institution_id NOT NULL; platform_admin remains NULL)

CREATE OR REPLACE FUNCTION public.auth_user_is_active_institution_operator_for_institution(
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
          AND p_institution_id IS NOT NULL
          AND u.institution_id = p_institution_id
          AND u.status = 'active'
          AND u.primary_role IN (
              'institution_manager'::public.user_role,
              'deputy'::public.user_role
          )
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_institution_operator_for_institution(UUID) IS
    'D1: true when the authenticated user is an active institution_manager or deputy for the given institution. Not Platform Admin, Secretary, or Teacher. D2 will attach operational RLS; D1 introduces the helper only.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_institution_operator_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_institution_operator_for_institution(UUID) TO authenticated;
