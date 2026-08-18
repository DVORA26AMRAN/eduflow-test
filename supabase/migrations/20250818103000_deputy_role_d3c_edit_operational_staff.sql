-- =============================================================================
-- EduFlow — Deputy D3C: edit Teacher and Secretary profile fields
-- =============================================================================
-- Forward-only. Does not edit D1/D2 migrations.
-- Deputy may UPDATE approved ordinary profile fields for same-institution
-- teacher and secretary only. national_id is not read or written for Deputy.
-- Manager/Secretary teacher-edit contract is unchanged.
-- Does not grant table UPDATE on public.users. No email/Auth identity changes.
-- Do not apply until architecture review.

-- -----------------------------------------------------------------------------
-- get_staff_directory
-- Manager/Secretary: teachers only (unchanged)
-- Deputy: teachers and secretaries in the same institution
-- Adds primary_role so the UI can gate edit per target.
-- RETURN type changed (adds primary_role) — DROP required before CREATE.
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_staff_directory();

CREATE OR REPLACE FUNCTION public.get_staff_directory()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    weekly_hours NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ,
    primary_role TEXT
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
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')
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
        t.created_at::TIMESTAMPTZ,
        t.primary_role::TEXT
    FROM public.users AS t
    WHERE t.institution_id = v_caller.institution_id
      AND (
        (
            v_caller.primary_role IN ('institution_manager', 'secretary')
            AND t.primary_role = 'teacher'
        )
        OR (
            v_caller.primary_role = 'deputy'
            AND t.primary_role IN ('teacher', 'secretary')
        )
      )
    ORDER BY t.full_name ASC;
END;
$$;

COMMENT ON FUNCTION public.get_staff_directory() IS
    'D3C: manager/secretary list teachers; deputy lists teachers and secretaries. No national_id.';

REVOKE ALL ON FUNCTION public.get_staff_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO authenticated;

-- -----------------------------------------------------------------------------
-- get_staff_member_details
-- Manager/Secretary: teacher targets, national_id returned
-- Deputy: teacher or secretary targets, national_id always NULL
-- RETURN type changed (adds primary_role) — DROP required before CREATE.
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_staff_member_details(UUID);

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
    national_id TEXT,
    primary_role TEXT
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
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target
    FROM public.users AS t
    WHERE t.id = p_user_id;

    IF NOT FOUND
        OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_caller.primary_role IN ('institution_manager', 'secretary')
       AND v_target.primary_role <> 'teacher'
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_caller.primary_role = 'deputy'
       AND v_target.primary_role NOT IN ('teacher', 'secretary')
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
            WHEN v_caller.primary_role IN (
                'institution_manager'::public.user_role,
                'secretary'::public.user_role
            )
            THEN v_target.national_id::TEXT
            ELSE NULL
        END,
        v_target.primary_role::TEXT;
END;
$$;

COMMENT ON FUNCTION public.get_staff_member_details(UUID) IS
    'D3C: manager/secretary teacher details with national_id; deputy teacher/secretary details with national_id NULL.';

REVOKE ALL ON FUNCTION public.get_staff_member_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_member_details(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- update_staff_member
-- Manager/Secretary: teacher only; may set national_id
-- Deputy: teacher or secretary; NEVER writes national_id, email, role, institution, status
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_staff_member(
    p_user_id UUID,
    p_full_name TEXT,
    p_phone TEXT DEFAULT NULL,
    p_job_title TEXT DEFAULT NULL,
    p_weekly_hours NUMERIC DEFAULT NULL,
    p_national_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_full_name TEXT;
    v_is_deputy BOOLEAN;
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
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target
    FROM public.users AS t
    WHERE t.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND
        OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    v_is_deputy := (v_caller.primary_role = 'deputy');

    IF v_is_deputy THEN
        IF v_target.primary_role NOT IN ('teacher', 'secretary') THEN
            RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF v_target.primary_role <> 'teacher' THEN
            RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_full_name := btrim(COALESCE(p_full_name, ''));

    IF v_full_name = '' THEN
        RAISE EXCEPTION 'Full name is required.' USING ERRCODE = 'P0001';
    END IF;

    IF p_weekly_hours IS NOT NULL AND p_weekly_hours <= 0 THEN
        RAISE EXCEPTION 'Weekly hours must be greater than zero.' USING ERRCODE = 'P0001';
    END IF;

    IF v_is_deputy THEN
        UPDATE public.users
        SET
            full_name = v_full_name,
            phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
            job_title = NULLIF(btrim(COALESCE(p_job_title, '')), ''),
            weekly_hours = p_weekly_hours
        WHERE id = v_target.id;
    ELSE
        UPDATE public.users
        SET
            full_name = v_full_name,
            phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
            job_title = NULLIF(btrim(COALESCE(p_job_title, '')), ''),
            weekly_hours = p_weekly_hours,
            national_id = NULLIF(btrim(COALESCE(p_national_id, '')), '')
        WHERE id = v_target.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

COMMENT ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) IS
    'D3C: manager/secretary update teacher including national_id; deputy updates teacher/secretary profile fields only and never writes national_id.';
