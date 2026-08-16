-- =============================================================================
-- MPEX — Atomic school registration intake (registration + registration_created)
-- =============================================================================
-- Public Edge Function must not leave a registration without its created activity.
-- service_role-only SECURITY DEFINER RPC; no anon/authenticated table or EXECUTE.

CREATE OR REPLACE FUNCTION public.school_registration_intake_create(
    p_school_name TEXT,
    p_institution_symbol TEXT,
    p_city TEXT,
    p_applicant_role TEXT,
    p_contact_full_name TEXT,
    p_email TEXT,
    p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_name TEXT;
    v_institution_symbol TEXT;
    v_city TEXT;
    v_applicant_role TEXT;
    v_contact_full_name TEXT;
    v_email TEXT;
    v_phone TEXT;
    v_registration_id UUID;
BEGIN
    v_school_name := NULLIF(btrim(COALESCE(p_school_name, '')), '');
    v_institution_symbol := NULLIF(btrim(COALESCE(p_institution_symbol, '')), '');
    v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
    v_applicant_role := NULLIF(btrim(COALESCE(p_applicant_role, '')), '');
    v_contact_full_name := NULLIF(btrim(COALESCE(p_contact_full_name, '')), '');
    v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');

    IF v_school_name IS NULL
        OR v_institution_symbol IS NULL
        OR v_city IS NULL
        OR v_applicant_role IS NULL
        OR v_contact_full_name IS NULL
        OR v_email IS NULL
        OR v_phone IS NULL
    THEN
        RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
    END IF;

    IF char_length(v_school_name) > 200
        OR char_length(v_institution_symbol) > 64
        OR char_length(v_city) > 120
        OR char_length(v_contact_full_name) > 200
        OR char_length(v_email) > 254
        OR char_length(v_phone) > 32
    THEN
        RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
    END IF;

    IF v_applicant_role NOT IN ('principal', 'vice_principal') THEN
        RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
    END IF;

    IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
        RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
    END IF;

    IF v_phone !~ '^\+?[0-9][0-9\s\-()]{5,24}$' THEN
        RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.school_registrations (
        school_name,
        institution_symbol,
        city,
        applicant_role,
        contact_full_name,
        email,
        phone,
        status
    )
    VALUES (
        v_school_name,
        v_institution_symbol,
        v_city,
        v_applicant_role,
        v_contact_full_name,
        v_email,
        v_phone,
        'new'
    )
    RETURNING id INTO v_registration_id;

    INSERT INTO public.school_registration_activities (
        registration_id,
        event_type,
        actor_user_id,
        payload
    )
    VALUES (
        v_registration_id,
        'registration_created',
        NULL,
        '{}'::jsonb
    );

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_registration_id
    );
END;
$$;

COMMENT ON FUNCTION public.school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Atomic public intake: inserts school_registrations + registration_created activity in one transaction. service_role only.';

REVOKE ALL ON FUNCTION public.school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.school_registration_intake_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
