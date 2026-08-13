-- =============================================================================
-- EduFlow — Phase 2: Institution Manager invitation / assignment baseline
-- =============================================================================
-- Application-owned onboarding signal, one-active-manager-per-institution,
-- Platform Admin manager read RPC, and own-onboarding completion RPC.
-- Does not modify historical migrations. Does not invite via SQL.
-- Replacement: deactivate active manager (status) frees the unique slot.

-- -----------------------------------------------------------------------------
-- 1) onboarding_completed_at
-- -----------------------------------------------------------------------------

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.onboarding_completed_at IS
    'NULL = invited / onboarding incomplete; timestamptz = onboarding completed (application-owned).';

-- Existing operational rows: backfill from created_at so they do not appear as
-- "awaiting invitation". Ambiguity: rows with NULL created_at are left NULL
-- (report / inspect before treating as awaiting). Invited-but-never-logged-in
-- legacy teachers/secretaries also receive a timestamp; Phase 2 UI only projects
-- this field for institution_manager.
UPDATE public.users AS u
SET onboarding_completed_at = u.created_at
WHERE u.onboarding_completed_at IS NULL
  AND u.created_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) Preflight: refuse unique index if >1 active manager per institution
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_conflicts TEXT;
BEGIN
    SELECT string_agg(institution_id::TEXT, ', ' ORDER BY institution_id::TEXT)
    INTO v_conflicts
    FROM (
        SELECT u.institution_id
        FROM public.users AS u
        WHERE u.primary_role = 'institution_manager'
          AND u.status = 'active'
          AND u.institution_id IS NOT NULL
        GROUP BY u.institution_id
        HAVING COUNT(*) > 1
    ) AS dupes;

    IF v_conflicts IS NOT NULL THEN
        RAISE EXCEPTION
            'Phase 2 blocked: institutions with more than one active institution_manager: %. Resolve manually before applying.',
            v_conflicts;
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) At most one ACTIVE institution_manager per institution
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS users_one_active_institution_manager_per_institution
    ON public.users (institution_id)
    WHERE primary_role = 'institution_manager'
      AND status = 'active';

COMMENT ON INDEX public.users_one_active_institution_manager_per_institution IS
    'Phase 2: invited (awaiting) and joined active managers both occupy the slot; inactive does not.';

-- -----------------------------------------------------------------------------
-- 4) Ensure global Platform Admin gate (align with baseline)
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
-- 5) Platform Admin: read active manager for an institution
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_get_institution_manager(p_institution_id UUID)
RETURNS TABLE (
    user_id UUID,
    full_name TEXT,
    email TEXT,
    status TEXT,
    onboarding_completed_at TIMESTAMPTZ
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
        u.id,
        u.full_name::TEXT,
        u.email::TEXT,
        u.status::TEXT,
        u.onboarding_completed_at
    FROM public.users AS u
    WHERE u.institution_id = p_institution_id
      AND u.primary_role = 'institution_manager'
      AND u.status = 'active'
    ORDER BY u.created_at ASC NULLS LAST
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_institution_manager(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_get_institution_manager(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_institution_manager(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_institution_manager(UUID) TO authenticated;

COMMENT ON FUNCTION public.platform_admin_get_institution_manager(UUID) IS
    'Active global platform_admin reads the active Institution Manager for a school (if any).';

-- -----------------------------------------------------------------------------
-- 6) Own onboarding completion (password setup)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_own_user_onboarding()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user public.users%ROWTYPE;
    v_was_pending BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_user
    FROM public.users
    WHERE id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_user.status <> 'active' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_user.onboarding_completed_at IS NULL THEN
        v_was_pending := TRUE;
        UPDATE public.users
        SET onboarding_completed_at = NOW()
        WHERE id = v_uid
          AND onboarding_completed_at IS NULL;
    END IF;

    IF v_was_pending
       AND v_user.primary_role = 'institution_manager'
       AND v_user.institution_id IS NOT NULL
    THEN
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
            v_user.institution_id,
            v_uid,
            'manager_onboarding_completed',
            'user',
            v_uid,
            jsonb_build_object('primary_role', v_user.primary_role),
            NOW()
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'onboarding_completed_at', (
            SELECT u.onboarding_completed_at
            FROM public.users AS u
            WHERE u.id = v_uid
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_own_user_onboarding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_own_user_onboarding() FROM anon;
REVOKE ALL ON FUNCTION public.complete_own_user_onboarding() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_own_user_onboarding() TO authenticated;

COMMENT ON FUNCTION public.complete_own_user_onboarding() IS
    'Authenticated user marks own onboarding complete after password setup; cannot update other users.';
