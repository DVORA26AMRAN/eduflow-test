-- =============================================================================
-- EduFlow — Phase 3A.3: Manager teacher profile editing
-- =============================================================================
-- Secure update contract for institution managers. The caller and target
-- institution are derived in the database; no client institution id is used.

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
        OR v_caller.primary_role <> 'institution_manager'
        OR v_caller.institution_id IS NULL
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

REVOKE ALL ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

COMMENT ON FUNCTION public.update_staff_member(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) IS
    'Phase 3A.3: active institution manager updates a teacher profile in their institution.';
