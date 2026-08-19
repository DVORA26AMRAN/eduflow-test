-- =============================================================================
-- EduFlow S4 — Staff reactivation
-- =============================================================================
-- Forward-only. Does not edit D1–D3C, R1–R2, 102500, 104000, 104500, 105000.
-- Depends on 20250819105000 (deactivate_staff_member + audit pattern).
--
-- Does NOT apply until architecture review.
-- Does NOT touch school-registration / quotation / Phase 3.
-- Does NOT grant authenticated UPDATE on public.users.
-- Does NOT broaden users ACL or RLS.
-- Does NOT create Auth users, new public.users rows, or invitations.
-- Does NOT restore released request assignments.
-- Does NOT modify claim_request, transfer_request_handler, release_request_handler.
--
-- Product:
--   Institution Manager may reactivate inactive Teacher, Secretary, or Deputy
--   in the same institution. Never self, never Manager, never Platform Admin.
--   Only users.status changes: 'inactive' -> 'active'.
--   Released requests remain status='new', handled_by_user_id=NULL.
--   Reactivated user is eligible for future claim/transfer via R1 rules only.
--
-- Idempotency:
--   Target already active -> return ok=true, unchanged=true; no audit written.
--   Target status unknown/other -> fail closed (permission denied).
--
-- audit_logs:
--   action_type = 'staff_reactivated' (unconstrained TEXT; no CHECK exists).
--   Written ONLY on actual inactive->active transition.

-- -----------------------------------------------------------------------------
-- reactivate_staff_member
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reactivate_staff_member(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor          UUID := auth.uid();
    v_caller         public.users%ROWTYPE;
    v_target         public.users%ROWTYPE;
    v_previous_status TEXT;
    v_unchanged      BOOLEAN := FALSE;
BEGIN
    -- -------------------------------------------------------------------------
    -- 1. Require caller identity.
    -- -------------------------------------------------------------------------
    IF v_actor IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. Load and validate caller (no lock; caller is not the assignment target).
    -- -------------------------------------------------------------------------
    SELECT *
    INTO v_caller
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_caller.status <> 'active'
       OR v_caller.primary_role <> 'institution_manager'::public.user_role
       OR v_caller.institution_id IS NULL
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- -------------------------------------------------------------------------
    -- 3. Deny self.
    -- -------------------------------------------------------------------------
    IF p_user_id = v_actor THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. Lock target users row FOR UPDATE (canonical order: user before requests;
    --    no requests are touched here, but locking prevents concurrent
    --    deactivation racing with this reactivation).
    -- -------------------------------------------------------------------------
    SELECT *
    INTO v_target
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    -- -------------------------------------------------------------------------
    -- 5. Validate target: same institution, eligible role.
    -- -------------------------------------------------------------------------
    IF NOT FOUND
       OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
       OR v_target.primary_role NOT IN (
            'teacher'::public.user_role,
            'secretary'::public.user_role,
            'deputy'::public.user_role
       )
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_previous_status := v_target.status;

    -- -------------------------------------------------------------------------
    -- 6. Status gate: only active and inactive are approved states.
    --    Unknown/other status fails closed.
    -- -------------------------------------------------------------------------
    IF v_previous_status <> 'active' AND v_previous_status <> 'inactive' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Already active: idempotent return, no mutation, no audit.
    v_unchanged := (v_previous_status = 'active');

    -- -------------------------------------------------------------------------
    -- 7. Transition inactive -> active (guarded CAS to avoid double-write).
    -- -------------------------------------------------------------------------
    IF NOT v_unchanged THEN
        UPDATE public.users
        SET status = 'active'
        WHERE id = v_target.id
          AND status = 'inactive';

        -- -------------------------------------------------------------------------
        -- 8. Mandatory audit row on actual transition only.
        -- -------------------------------------------------------------------------
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
            v_caller.institution_id,
            v_actor,
            'staff_reactivated',
            'user',
            v_target.id,
            jsonb_build_object(
                'previous_status',    v_previous_status,
                'new_status',         'active',
                'target_user_id',     v_target.id,
                'target_primary_role', v_target.primary_role::TEXT
            ),
            NOW()
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 9. Return authoritative result.
    -- -------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'ok',        true,
        'unchanged', v_unchanged,
        'user_id',   v_target.id,
        'status',    'active'
    );
END;
$$;

COMMENT ON FUNCTION public.reactivate_staff_member(UUID) IS
    'S4: active institution_manager reactivates same-institution inactive teacher/secretary/deputy. Only changes users.status inactive->active. Does NOT restore released requests. Does NOT create Auth users or new rows. Does NOT grant authenticated UPDATE on public.users. Idempotent for already-active targets. Unknown status fails closed.';

REVOKE ALL ON FUNCTION public.reactivate_staff_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_staff_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivate_staff_member(UUID) TO authenticated;
