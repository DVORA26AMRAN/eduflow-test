-- =============================================================================
-- EduFlow — Platform Admin global baseline alignment (idempotent)
-- =============================================================================
-- Reconciles repository schema with the intended Platform Admin model that was
-- verified live (manual SQL Editor fixes). Safe to apply on:
--   A) live DB that already received these fixes
--   B) fresh environments built from repository migrations
--
-- Does NOT invite Managers (Phase 2). Does NOT broaden Storage beyond
-- institution-logos. Does NOT grant broad UPDATE on institutions.
--
-- Complements (does not replace) July logo migrations + Phase 1 institution RPCs:
--   20250711100000_institution_logo_fields.sql
--   20250711101000_platform_admin_institution_logo_policies.sql
--   20250711102000_institution_logos_storage.sql
--   20250812180000_platform_admin_institution_management_phase1.sql

-- -----------------------------------------------------------------------------
-- 1) public.user_role includes all PrimaryRole values
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type AS t
        INNER JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'user_role'
    ) THEN
        CREATE TYPE public.user_role AS ENUM (
            'institution_manager',
            'secretary',
            'teacher',
            'platform_admin'
        );
    END IF;
END;
$$;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'institution_manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'secretary';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'teacher';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'platform_admin';

-- -----------------------------------------------------------------------------
-- 2) Global platform_admin: institution_id NULL; tenant roles: NOT NULL
-- -----------------------------------------------------------------------------

ALTER TABLE public.users
    ALTER COLUMN institution_id DROP NOT NULL;

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_institution_id_role_consistency;

ALTER TABLE public.users
    ADD CONSTRAINT users_institution_id_role_consistency
    CHECK (
        (
            primary_role = 'platform_admin'::public.user_role
            AND institution_id IS NULL
        )
        OR
        (
            primary_role <> 'platform_admin'::public.user_role
            AND institution_id IS NOT NULL
        )
    );

COMMENT ON CONSTRAINT users_institution_id_role_consistency ON public.users IS
    'platform_admin is global (institution_id NULL); tenant roles must belong to an institution.';

-- -----------------------------------------------------------------------------
-- 3) Active global platform_admin helper (Storage + institutions logo RLS)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_is_active_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = auth.uid()
          AND u.primary_role = 'platform_admin'
          AND u.status = 'active'
          AND u.institution_id IS NULL
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_platform_admin() IS
    'True when auth.uid() is an active global platform_admin (institution_id IS NULL).';

REVOKE ALL ON FUNCTION public.auth_user_is_active_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_platform_admin() TO authenticated;

-- Keep Phase 1 RPC gate aligned with the same global-admin invariant.
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
        OR v_actor.institution_id IS NOT NULL
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN v_actor.id;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_require_active() FROM authenticated;

-- -----------------------------------------------------------------------------
-- 4) Logo columns + narrow institutions UPDATE (logo fields only)
-- -----------------------------------------------------------------------------

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;

GRANT UPDATE (logo_url, logo_updated_at) ON public.institutions TO authenticated;

DROP POLICY IF EXISTS institutions_platform_admin_select_all ON public.institutions;
CREATE POLICY institutions_platform_admin_select_all
    ON public.institutions
    FOR SELECT
    TO authenticated
    USING (public.auth_user_is_active_platform_admin());

DROP POLICY IF EXISTS institutions_platform_admin_update_logo ON public.institutions;
CREATE POLICY institutions_platform_admin_update_logo
    ON public.institutions
    FOR UPDATE
    TO authenticated
    USING (public.auth_user_is_active_platform_admin())
    WITH CHECK (public.auth_user_is_active_platform_admin());

-- -----------------------------------------------------------------------------
-- 5) institution-logos bucket + Storage policies (this bucket only)
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('institution-logos', 'institution-logos', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS institution_logos_storage_platform_admin_insert ON storage.objects;
CREATE POLICY institution_logos_storage_platform_admin_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

DROP POLICY IF EXISTS institution_logos_storage_platform_admin_update ON storage.objects;
CREATE POLICY institution_logos_storage_platform_admin_update
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    )
    WITH CHECK (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

DROP POLICY IF EXISTS institution_logos_storage_platform_admin_delete ON storage.objects;
CREATE POLICY institution_logos_storage_platform_admin_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

DROP POLICY IF EXISTS institution_logos_storage_authenticated_select ON storage.objects;
CREATE POLICY institution_logos_storage_authenticated_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'institution-logos');
