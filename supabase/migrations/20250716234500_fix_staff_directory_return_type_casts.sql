-- =============================================================================
-- EduFlow — Staff Directory RPC return-type repair
-- =============================================================================
-- PL/pgSQL RETURN QUERY requires each expression type to exactly match the
-- RETURNS TABLE declaration. Legacy users columns may be VARCHAR/domain/enum
-- types, so cast every returned value to the published RPC contract.

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
        t.id::UUID,
        t.full_name::TEXT,
        t.email::TEXT,
        t.phone::TEXT,
        t.job_title::TEXT,
        t.weekly_hours::NUMERIC,
        t.status::TEXT,
        t.created_at::TIMESTAMPTZ
    FROM public.users AS t
    WHERE t.institution_id = v_caller.institution_id
      AND t.primary_role = 'teacher'
    ORDER BY t.full_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO authenticated;

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
    IF auth.uid() IS NULL OR p_user_id IS NULL THEN
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
        v_target.id::UUID,
        v_target.full_name::TEXT,
        v_target.email::TEXT,
        v_target.phone::TEXT,
        v_target.job_title::TEXT,
        v_target.weekly_hours::NUMERIC,
        v_target.status::TEXT,
        v_target.created_at::TIMESTAMPTZ,
        CASE
            WHEN v_caller.primary_role = 'institution_manager'
                THEN v_target.national_id::TEXT
            ELSE NULL::TEXT
        END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_member_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_member_details(UUID) TO authenticated;
