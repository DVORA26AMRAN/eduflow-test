-- =============================================================================
-- EduFlow — Secretary Teacher onboarding + profile edit authorization
-- =============================================================================
-- Extends existing manager-only RPCs so an active secretary in the same
-- institution may update teacher profiles and set teacher extended fields.
-- Does not grant create/update of managers, secretaries, or teacher removal.

-- -----------------------------------------------------------------------------
-- update_staff_member: allow active secretary (teacher targets only)
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
    WHERE t.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND
        OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
        OR v_target.primary_role <> 'teacher'
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    v_full_name := btrim(COALESCE(p_full_name, ''));

    IF v_full_name = '' THEN
        RAISE EXCEPTION 'Full name is required.' USING ERRCODE = 'P0001';
    END IF;

    IF p_weekly_hours IS NOT NULL AND p_weekly_hours <= 0 THEN
        RAISE EXCEPTION 'Weekly hours must be greater than zero.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.users
    SET
        full_name = v_full_name,
        phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
        job_title = NULLIF(btrim(COALESCE(p_job_title, '')), ''),
        weekly_hours = p_weekly_hours,
        national_id = NULLIF(btrim(COALESCE(p_national_id, '')), '')
    WHERE id = v_target.id;

    RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END;
$$;

COMMENT ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) IS
    'Active institution_manager or secretary updates a teacher profile in their own institution.';

-- -----------------------------------------------------------------------------
-- manager_set_user_extended_profile: allow active secretary (teacher targets)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.manager_set_user_extended_profile(
    p_email TEXT,
    p_phone TEXT DEFAULT NULL,
    p_national_id TEXT DEFAULT NULL,
    p_job_title TEXT DEFAULT NULL,
    p_weekly_hours NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_email TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_actor
    FROM public.users
    WHERE id = auth.uid();

    IF NOT FOUND
        OR v_actor.primary_role NOT IN ('institution_manager', 'secretary')
        OR v_actor.status <> 'active'
        OR v_actor.institution_id IS NULL
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    v_email := lower(btrim(COALESCE(p_email, '')));

    IF v_email = '' THEN
        RAISE EXCEPTION 'Email is required.' USING ERRCODE = 'P0001';
    END IF;

    IF p_weekly_hours IS NOT NULL AND p_weekly_hours <= 0 THEN
        RAISE EXCEPTION 'Weekly hours must be a positive number.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_target
    FROM public.users
    WHERE lower(email) = v_email
      AND institution_id = v_actor.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_target.primary_role <> 'teacher' THEN
        RAISE EXCEPTION 'Extended profile fields apply to teachers only.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.users
    SET
        phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
        national_id = NULLIF(btrim(COALESCE(p_national_id, '')), ''),
        job_title = NULLIF(btrim(COALESCE(p_job_title, '')), ''),
        weekly_hours = p_weekly_hours
    WHERE id = v_target.id;

    RETURN jsonb_build_object('ok', true, 'user_id', v_target.id);
END;
$$;

COMMENT ON FUNCTION public.manager_set_user_extended_profile(TEXT, TEXT, TEXT, TEXT, NUMERIC) IS
    'Active institution_manager or secretary writes optional teacher extended profile fields.';

-- -----------------------------------------------------------------------------
-- get_staff_member_details: secretaries may read national_id for edit parity
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
        v_target.national_id::TEXT;
END;
$$;

COMMENT ON FUNCTION public.get_staff_member_details(UUID) IS
    'Active manager/secretary teacher details in their institution, including national_id for edit.';
