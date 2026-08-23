-- =============================================================================
-- MPEX — School registration marketing communication consent
-- =============================================================================
-- Optional explicit marketing consent on public intake. Existing rows default
-- to opted-out with no inferred historical consent timestamp.

ALTER TABLE public.school_registrations
    ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN marketing_consent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.school_registrations.marketing_consent IS
    'Explicit opt-in to marketing communications only (not operational/service mail).';

COMMENT ON COLUMN public.school_registrations.marketing_consent_at IS
    'Authoritative server timestamp when marketing_consent became TRUE. NULL when opted out.';

ALTER TABLE public.school_registrations
    ADD CONSTRAINT school_registrations_marketing_consent_timestamp_invariant
        CHECK (
            (marketing_consent = FALSE AND marketing_consent_at IS NULL)
            OR (marketing_consent = TRUE AND marketing_consent_at IS NOT NULL)
        );

-- -----------------------------------------------------------------------------
-- Atomic intake RPC — accept consent boolean; server sets consent timestamp
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.school_registration_intake_create(
    p_school_name TEXT,
    p_institution_symbol TEXT,
    p_city TEXT,
    p_applicant_role TEXT,
    p_contact_full_name TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_marketing_consent BOOLEAN DEFAULT FALSE
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
    v_marketing_consent BOOLEAN := COALESCE(p_marketing_consent, FALSE);
    v_marketing_consent_at TIMESTAMPTZ;
    v_registration_id UUID;
BEGIN
    v_school_name := NULLIF(btrim(COALESCE(p_school_name, '')), '');
    v_institution_symbol := NULLIF(btrim(COALESCE(p_institution_symbol, '')), '');
    v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
    v_applicant_role := NULLIF(btrim(COALESCE(p_applicant_role, '')), '');
    v_contact_full_name := NULLIF(btrim(COALESCE(p_contact_full_name, '')), '');
    v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_marketing_consent_at := CASE
        WHEN v_marketing_consent THEN NOW()
        ELSE NULL
    END;

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
        status,
        marketing_consent,
        marketing_consent_at
    )
    VALUES (
        v_school_name,
        v_institution_symbol,
        v_city,
        v_applicant_role,
        v_contact_full_name,
        v_email,
        v_phone,
        'new',
        v_marketing_consent,
        v_marketing_consent_at
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

COMMENT ON FUNCTION public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) IS
    'Atomic public intake with optional marketing consent. Consent timestamp is server-authoritative (NOW()). service_role only.';

REVOKE ALL ON FUNCTION public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM anon;
REVOKE ALL ON FUNCTION public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.school_registration_intake_create(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO service_role;

-- -----------------------------------------------------------------------------
-- Platform Admin read RPCs — expose consent for authorized admin views
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.platform_admin_list_school_registrations();
DROP FUNCTION IF EXISTS public.platform_admin_get_school_registration(UUID);

CREATE OR REPLACE FUNCTION public.platform_admin_list_school_registrations()
RETURNS TABLE (
    id UUID,
    school_name TEXT,
    institution_symbol TEXT,
    city TEXT,
    applicant_role TEXT,
    contact_full_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT,
    follow_up_at TIMESTAMPTZ,
    marketing_consent BOOLEAN,
    marketing_consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    RETURN QUERY
    SELECT
        r.id,
        r.school_name,
        r.institution_symbol,
        r.city,
        r.applicant_role,
        r.contact_full_name,
        r.email,
        r.phone,
        r.status,
        r.follow_up_at,
        r.marketing_consent,
        r.marketing_consent_at,
        r.created_at,
        r.updated_at
    FROM public.school_registrations AS r
    ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_list_school_registrations() IS
    'Lists school registration intake rows for active Platform Admin (includes marketing consent).';

REVOKE ALL ON FUNCTION public.platform_admin_list_school_registrations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_school_registrations() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_school_registrations() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_get_school_registration(p_id UUID)
RETURNS TABLE (
    id UUID,
    school_name TEXT,
    institution_symbol TEXT,
    city TEXT,
    applicant_role TEXT,
    contact_full_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT,
    follow_up_at TIMESTAMPTZ,
    marketing_consent BOOLEAN,
    marketing_consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    converted_institution_id UUID,
    converted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.school_name,
        r.institution_symbol,
        r.city,
        r.applicant_role,
        r.contact_full_name,
        r.email,
        r.phone,
        r.status,
        r.follow_up_at,
        r.marketing_consent,
        r.marketing_consent_at,
        r.created_at,
        r.updated_at,
        r.converted_institution_id,
        r.converted_at
    FROM public.school_registrations AS r
    WHERE r.id = p_id;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_get_school_registration(UUID) IS
    'Returns one school registration for active Platform Admin (includes marketing consent).';

REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_school_registration(UUID) TO authenticated;
