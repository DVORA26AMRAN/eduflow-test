-- =============================================================================
-- EduFlow — Phase 3A.2A: Secure Staff Directory Read Foundation
-- =============================================================================
-- SECURITY DEFINER read contracts for institution managers and secretaries.
-- Does not modify users RLS. Institution and role are derived from auth.uid().
-- national_id is omitted from the list RPC and redacted for secretaries in
-- the details RPC.

-- -----------------------------------------------------------------------------
-- List teachers in the caller's institution (no national_id)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_staff_directory()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    weekly_hours NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_caller
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF NOT FOUND
        OR v_caller.status <> 'active'
        OR v_caller.institution_id IS NULL
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.full_name,
        t.email,
        t.phone,
        t.job_title,
        t.weekly_hours,
        t.status::TEXT,
        t.created_at
    FROM public.users AS t
    WHERE t.institution_id = v_caller.institution_id
      AND t.primary_role = 'teacher'
    ORDER BY t.full_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO authenticated;

COMMENT ON FUNCTION public.get_staff_directory() IS
    'Phase 3A.2A: active manager/secretary list teachers in their institution without national_id.';

-- -----------------------------------------------------------------------------
-- Teacher details with role-based national_id redaction
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_staff_member_details(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    weekly_hours NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ,
    national_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_caller
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF NOT FOUND
        OR v_caller.status <> 'active'
        OR v_caller.institution_id IS NULL
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target
    FROM public.users AS t
    WHERE t.id = p_user_id;

    IF NOT FOUND
        OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
        OR v_target.primary_role <> 'teacher'
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        v_target.id,
        v_target.full_name,
        v_target.email,
        v_target.phone,
        v_target.job_title,
        v_target.weekly_hours,
        v_target.status::TEXT,
        v_target.created_at,
        CASE
            WHEN v_caller.primary_role = 'institution_manager' THEN v_target.national_id
            ELSE NULL::TEXT
        END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_member_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_member_details(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_staff_member_details(UUID) IS
    'Phase 3A.2A: manager/secretary teacher details; national_id only for institution_manager.';
