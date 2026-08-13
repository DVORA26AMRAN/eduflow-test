-- =============================================================================
-- EduFlow — Platform Admin Institution Management (Phase 1)
-- =============================================================================
-- Adds contact/identity metadata for institutions and narrow SECURITY DEFINER
-- RPCs for active platform_admin create/list/get/update. Does not invite
-- Managers (Phase 2). Does not grant broad INSERT/UPDATE on institutions.
-- Logo upload/removal remains via existing logo_url column + storage policies.

-- -----------------------------------------------------------------------------
-- Schema: reuse name/logo_*; add missing contact fields (nullable for legacy)
-- -----------------------------------------------------------------------------

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS institution_code TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.institutions
SET created_at = COALESCE(created_at, NOW())
WHERE created_at IS NULL;

UPDATE public.institutions
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE public.institutions
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.institutions
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

COMMENT ON COLUMN public.institutions.institution_code IS
    'External school/institution code. Unique when present. Legacy rows may be NULL until edited.';
COMMENT ON COLUMN public.institutions.address IS
    'Full postal address. Legacy rows may be NULL until edited.';
COMMENT ON COLUMN public.institutions.city IS
    'City. Legacy rows may be NULL until edited.';
COMMENT ON COLUMN public.institutions.phone IS
    'Primary contact phone. Legacy rows may be NULL until edited.';
COMMENT ON COLUMN public.institutions.email IS
    'Primary contact email. Legacy rows may be NULL until edited.';

-- Unique among non-empty codes (multiple legacy NULLs remain allowed).
CREATE UNIQUE INDEX IF NOT EXISTS institutions_institution_code_unique_ci
    ON public.institutions (lower(btrim(institution_code)))
    WHERE institution_code IS NOT NULL AND btrim(institution_code) <> '';

-- -----------------------------------------------------------------------------
-- Keep logo audit compatible with live audit_logs (actor_user_id / action_type)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.write_institution_logo_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_action TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.logo_url IS NOT DISTINCT FROM OLD.logo_url THEN
        RETURN NEW;
    END IF;

    IF OLD.logo_url IS NULL AND NEW.logo_url IS NOT NULL THEN
        v_action := 'institution_logo_uploaded';
    ELSIF OLD.logo_url IS NOT NULL AND NEW.logo_url IS NULL THEN
        v_action := 'institution_logo_removed';
    ELSE
        v_action := 'institution_logo_replaced';
    END IF;

    INSERT INTO public.audit_logs (
        institution_id,
        actor_user_id,
        action_type,
        entity_type,
        entity_id,
        metadata,
        created_at
    )
    VALUES (
        NEW.id,
        auth.uid(),
        v_action,
        'institution',
        NEW.id,
        jsonb_build_object(
            'previous_logo_url', OLD.logo_url,
            'new_logo_url', NEW.logo_url
        ),
        NOW()
    );

    RETURN NEW;
EXCEPTION
    WHEN undefined_column OR undefined_table THEN
        RAISE WARNING 'institution logo audit skipped: audit_logs schema mismatch';
        RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_require_active()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor public.users%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_actor
    FROM public.users
    WHERE id = auth.uid();

    IF NOT FOUND
        OR v_actor.primary_role <> 'platform_admin'
        OR v_actor.status <> 'active'
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN v_actor.id;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_normalize_institution_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
BEGIN
    v_code := NULLIF(btrim(COALESCE(p_code, '')), '');
    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_normalize_institution_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_normalize_institution_code(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_normalize_institution_code(TEXT) FROM authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_write_institution_audit(
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_action_type TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Mandatory/transactional: failure must abort the calling create/update RPC.
    INSERT INTO public.audit_logs (
        institution_id,
        actor_user_id,
        action_type,
        entity_type,
        entity_id,
        metadata,
        created_at
    )
    VALUES (
        p_institution_id,
        p_actor_user_id,
        p_action_type,
        'institution',
        p_institution_id,
        COALESCE(p_metadata, '{}'::JSONB),
        NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_write_institution_audit(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_write_institution_audit(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_write_institution_audit(UUID, UUID, TEXT, JSONB) FROM authenticated;

-- -----------------------------------------------------------------------------
-- List / get
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_list_institutions()
RETURNS TABLE (
    id UUID,
    name TEXT,
    institution_code TEXT,
    address TEXT,
    city TEXT,
    phone TEXT,
    email TEXT,
    logo_url TEXT,
    logo_updated_at TIMESTAMPTZ,
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
        i.id,
        i.name::TEXT,
        i.institution_code::TEXT,
        i.address::TEXT,
        i.city::TEXT,
        i.phone::TEXT,
        i.email::TEXT,
        i.logo_url::TEXT,
        i.logo_updated_at,
        i.created_at,
        i.updated_at
    FROM public.institutions AS i
    ORDER BY i.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_list_institutions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_institutions() FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_institutions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_institutions() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_get_institution(p_institution_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    institution_code TEXT,
    address TEXT,
    city TEXT,
    phone TEXT,
    email TEXT,
    logo_url TEXT,
    logo_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    IF p_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.institutions AS i
        WHERE i.id = p_institution_id
    ) THEN
        RAISE EXCEPTION 'Institution not found.' USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT
        i.id,
        i.name::TEXT,
        i.institution_code::TEXT,
        i.address::TEXT,
        i.city::TEXT,
        i.phone::TEXT,
        i.email::TEXT,
        i.logo_url::TEXT,
        i.logo_updated_at,
        i.created_at,
        i.updated_at
    FROM public.institutions AS i
    WHERE i.id = p_institution_id;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_institution(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_get_institution(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_institution(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_institution(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Create / update (metadata only; logo via existing client update path)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_create_institution(
    p_name TEXT,
    p_institution_code TEXT,
    p_address TEXT,
    p_city TEXT,
    p_phone TEXT,
    p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_name TEXT;
    v_code TEXT;
    v_address TEXT;
    v_city TEXT;
    v_phone TEXT;
    v_email TEXT;
    v_id UUID;
BEGIN
    v_actor_id := public.platform_admin_require_active();

    v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_code := public.platform_admin_normalize_institution_code(p_institution_code);
    v_address := NULLIF(btrim(COALESCE(p_address, '')), '');
    v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Name is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_code IS NULL THEN
        RAISE EXCEPTION 'Institution code is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_address IS NULL THEN
        RAISE EXCEPTION 'Address is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_city IS NULL THEN
        RAISE EXCEPTION 'City is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Phone is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_email IS NULL OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'A valid email is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_phone !~ '^\+?[0-9][0-9\s\-()]{5,24}$' THEN
        RAISE EXCEPTION 'Invalid phone number.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.institutions AS i
        WHERE i.institution_code IS NOT NULL
          AND lower(btrim(i.institution_code)) = lower(v_code)
    ) THEN
        RAISE EXCEPTION 'Institution code already exists.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.institutions (
        id,
        name,
        institution_code,
        address,
        city,
        phone,
        email,
        created_at,
        updated_at
    )
    VALUES (
        gen_random_uuid(),
        v_name,
        v_code,
        v_address,
        v_city,
        v_phone,
        v_email,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_id;

    PERFORM public.platform_admin_write_institution_audit(
        v_id,
        v_actor_id,
        'institution_created',
        jsonb_build_object(
            'name', v_name,
            'institution_code', v_code,
            'city', v_city
        )
    );

    RETURN jsonb_build_object('ok', true, 'institution_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_update_institution(
    p_institution_id UUID,
    p_name TEXT,
    p_institution_code TEXT,
    p_address TEXT,
    p_city TEXT,
    p_phone TEXT,
    p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_name TEXT;
    v_code TEXT;
    v_address TEXT;
    v_city TEXT;
    v_phone TEXT;
    v_email TEXT;
    v_existing public.institutions%ROWTYPE;
BEGIN
    v_actor_id := public.platform_admin_require_active();

    IF p_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing
    FROM public.institutions
    WHERE id = p_institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Institution not found.' USING ERRCODE = 'P0002';
    END IF;

    v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_code := public.platform_admin_normalize_institution_code(p_institution_code);
    v_address := NULLIF(btrim(COALESCE(p_address, '')), '');
    v_city := NULLIF(btrim(COALESCE(p_city, '')), '');
    v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Name is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_code IS NULL THEN
        RAISE EXCEPTION 'Institution code is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_address IS NULL THEN
        RAISE EXCEPTION 'Address is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_city IS NULL THEN
        RAISE EXCEPTION 'City is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Phone is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_email IS NULL OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'A valid email is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_phone !~ '^\+?[0-9][0-9\s\-()]{5,24}$' THEN
        RAISE EXCEPTION 'Invalid phone number.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.institutions AS i
        WHERE i.id IS DISTINCT FROM p_institution_id
          AND i.institution_code IS NOT NULL
          AND lower(btrim(i.institution_code)) = lower(v_code)
    ) THEN
        RAISE EXCEPTION 'Institution code already exists.' USING ERRCODE = '23505';
    END IF;

    UPDATE public.institutions
    SET
        name = v_name,
        institution_code = v_code,
        address = v_address,
        city = v_city,
        phone = v_phone,
        email = v_email,
        updated_at = NOW()
    WHERE id = p_institution_id;

    -- Never touch users.institution_id or logo_url here.

    PERFORM public.platform_admin_write_institution_audit(
        p_institution_id,
        v_actor_id,
        'institution_updated',
        jsonb_build_object(
            'previous_name', v_existing.name,
            'name', v_name,
            'previous_institution_code', v_existing.institution_code,
            'institution_code', v_code
        )
    );

    RETURN jsonb_build_object('ok', true, 'institution_id', p_institution_id);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.platform_admin_list_institutions() IS
    'Active platform_admin lists all institutions (Phase 1 metadata).';
COMMENT ON FUNCTION public.platform_admin_get_institution(UUID) IS
    'Active platform_admin loads one institution by id.';
COMMENT ON FUNCTION public.platform_admin_create_institution(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Active platform_admin creates an institution; id generated server-side.';
COMMENT ON FUNCTION public.platform_admin_update_institution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Active platform_admin updates institution metadata only; does not move users or change id.';
