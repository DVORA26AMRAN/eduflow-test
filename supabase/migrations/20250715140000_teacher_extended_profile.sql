-- =============================================================================
-- EduFlow — Phase 3A.1: Teacher Extended Profile Foundation
-- =============================================================================
-- Extends public.users with optional employee fields for teacher profiles.
-- Existing rows remain valid (all new columns nullable). Authentication and
-- invite flow (clever-processor) are unchanged; managers persist extended
-- fields via manager_set_user_extended_profile after user provisioning.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS national_id TEXT,
    ADD COLUMN IF NOT EXISTS job_title TEXT,
    ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC;

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_weekly_hours_positive;

ALTER TABLE public.users
    ADD CONSTRAINT users_weekly_hours_positive
    CHECK (weekly_hours IS NULL OR weekly_hours > 0);

COMMENT ON COLUMN public.users.phone IS
    'Optional contact phone. NULL when not provided (Phase 3A.1).';

COMMENT ON COLUMN public.users.national_id IS
    'Optional national ID. NULL when not provided (Phase 3A.1).';

COMMENT ON COLUMN public.users.job_title IS
    'Optional organizational job title. NULL when not provided (Phase 3A.1).';

COMMENT ON COLUMN public.users.weekly_hours IS
    'Optional weekly hours workload. NULL when not provided; must be positive when set.';

-- -----------------------------------------------------------------------------
-- Institution manager sets extended profile fields for a teacher in their
-- institution (used after invite creates the public.users row).
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
    v_manager public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_email TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_manager
    FROM public.users
    WHERE id = auth.uid();

    IF NOT FOUND
        OR v_manager.primary_role <> 'institution_manager'
        OR v_manager.status <> 'active'
        OR v_manager.institution_id IS NULL
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
      AND institution_id = v_manager.institution_id
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

REVOKE ALL ON FUNCTION public.manager_set_user_extended_profile(TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_set_user_extended_profile(TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.manager_set_user_extended_profile(TEXT, TEXT, TEXT, TEXT, NUMERIC) IS
    'Phase 3A.1: institution manager writes optional teacher extended profile fields on public.users.';
