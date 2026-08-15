-- =============================================================================
-- MPEX — School registration intake (Phase 1)
-- =============================================================================
-- Public intake records only. Never an institution. No automatic conversion.
-- Public writes go through Edge Function (service_role); not via anon INSERT.
-- Platform Admin reads via SECURITY DEFINER RPCs.

CREATE TABLE public.school_registrations (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_name           TEXT        NOT NULL,
    institution_symbol    TEXT        NOT NULL,
    city                  TEXT        NOT NULL,
    applicant_role        TEXT        NOT NULL,
    contact_full_name     TEXT        NOT NULL,
    email                 TEXT        NOT NULL,
    phone                 TEXT        NOT NULL,
    status                TEXT        NOT NULL DEFAULT 'new',
    -- Reserved for later conversion phase (Platform Admin only; never public-writable).
    converted_institution_id UUID     NULL REFERENCES public.institutions (id) ON DELETE SET NULL,
    converted_at          TIMESTAMPTZ NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_registrations_school_name_not_blank
        CHECK (BTRIM(school_name) <> ''),
    CONSTRAINT school_registrations_institution_symbol_not_blank
        CHECK (BTRIM(institution_symbol) <> ''),
    CONSTRAINT school_registrations_city_not_blank
        CHECK (BTRIM(city) <> ''),
    CONSTRAINT school_registrations_contact_full_name_not_blank
        CHECK (BTRIM(contact_full_name) <> ''),
    CONSTRAINT school_registrations_email_not_blank
        CHECK (BTRIM(email) <> ''),
    CONSTRAINT school_registrations_phone_not_blank
        CHECK (BTRIM(phone) <> ''),
    CONSTRAINT school_registrations_applicant_role_valid
        CHECK (applicant_role IN ('principal', 'vice_principal')),
    CONSTRAINT school_registrations_status_valid
        CHECK (status IN ('new', 'contacted', 'in_review', 'converted', 'rejected'))
);

COMMENT ON TABLE public.school_registrations IS
    'Public school registration intake (Phase 1). Not an institution. Conversion is Platform Admin only in a later phase.';

COMMENT ON COLUMN public.school_registrations.institution_symbol IS
    'External institution symbol number stored as text (never numeric). Future duplicate signal for conversion.';

COMMENT ON COLUMN public.school_registrations.converted_institution_id IS
    'Set only when Platform Admin converts a registration to an institution (future phase).';

CREATE INDEX idx_school_registrations_created_at
    ON public.school_registrations (created_at DESC);

CREATE INDEX idx_school_registrations_status
    ON public.school_registrations (status);

CREATE INDEX idx_school_registrations_institution_symbol_ci
    ON public.school_registrations (lower(btrim(institution_symbol)));

CREATE INDEX idx_school_registrations_email_ci
    ON public.school_registrations (lower(btrim(email)));

CREATE OR REPLACE FUNCTION public.school_registrations_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_registrations_updated_at ON public.school_registrations;
CREATE TRIGGER trg_school_registrations_updated_at
    BEFORE UPDATE ON public.school_registrations
    FOR EACH ROW
    EXECUTE PROCEDURE public.school_registrations_set_updated_at();

ALTER TABLE public.school_registrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_registrations FROM PUBLIC;
REVOKE ALL ON TABLE public.school_registrations FROM anon;
REVOKE ALL ON TABLE public.school_registrations FROM authenticated;

-- No direct table policies for anon/authenticated INSERT.
-- Platform Admin list/detail via RPCs below (fail-closed without RPC grant abuse).

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
        r.created_at,
        r.updated_at
    FROM public.school_registrations AS r
    ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_list_school_registrations() IS
    'Lists school registration intake rows for active Platform Admin only.';

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
        r.created_at,
        r.updated_at,
        r.converted_institution_id,
        r.converted_at
    FROM public.school_registrations AS r
    WHERE r.id = p_id;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_get_school_registration(UUID) IS
    'Returns one school registration for active Platform Admin only.';

REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_school_registration(UUID) TO authenticated;
