-- =============================================================================
-- EduFlow S2 — Staff deactivation database foundation
-- =============================================================================
-- Forward-only. Does not edit D1–D3C / 102500 / applied R1 (104000).
-- Depends on 20250819104500 (claim/transfer lock assignment-target users
-- row before the request row). Canonical lock order:
--   1) public.users row of the deactivation/assignment target FOR UPDATE
--   2) public.requests row(s) FOR UPDATE (ORDER BY id when multiple)
-- Does NOT apply until architecture review.
-- Does NOT touch school-registration / quotation / Phase 3.
-- Does NOT implement reactivation.
-- Does NOT grant authenticated UPDATE on public.users.
-- Does NOT broaden users ACL 102500 or users RLS.
-- Does NOT broaden auth_user_is_active_institution_manager_for_institution,
-- auth_user_is_active_institution_operator_for_institution, or
-- auth_user_can_read_institution_request.
--
-- Product:
--   Institution Manager may deactivate Teacher, Secretary, or Deputy
--   in the same institution. Never self, never Manager, never Platform Admin.
--   Physical DELETE is forbidden. Auth identity is untouched.
--   Direct authenticated users.status UPDATE remains prohibited.
--
-- Active assignments:
--   Before status becomes inactive, in_progress + assigned-to-target +
--   not archived requests in the same institution are released through
--   staff_deactivation_release_owned_request (internal; not granted to
--   authenticated). Does NOT call release_request_handler because Manager
--   cannot read secretary-routed general_request through routing gates.
--   completed/rejected/archived handled_by_user_id is preserved.
--   No automatic transfer to Manager.
--
-- users.status CHECK (active/inactive):
--   NOT added in S2. Tracked migrations never constrain users.status.
--   Live DISTINCT values were not proven in this change set. Adding a CHECK
--   from application convention alone is forbidden.
--
-- audit_logs:
--   Tracked writers use unconstrained TEXT action_type
--   (institution_logo_*, request_reminder_sent, manager_onboarding_completed,
--    platform_admin institution actions). No CHECK on action_type exists in
--   tracked migrations. staff_deactivated is therefore compatible.

-- -----------------------------------------------------------------------------
-- Internal routing-safe release (deactivation path only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_deactivation_release_owned_request(
    p_request_id UUID,
    p_target_user_id UUID,
    p_institution_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request public.requests%ROWTYPE;
BEGIN
    IF p_request_id IS NULL OR p_target_user_id IS NULL OR p_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Caller (deactivate_staff_member) already authorized Manager + target and
    -- locked the request row. Re-lock with narrow ownership CAS; do not call
    -- auth_user_can_read_institution_request (Manager must not read
    -- secretary-routed general_request through routing).
    SELECT *
    INTO v_request
    FROM public.requests
    WHERE id = p_request_id
      AND institution_id = p_institution_id
      AND handled_by_user_id = p_target_user_id
      AND status = 'in_progress'
      AND archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.requests
    SET
        handled_by_user_id = NULL,
        status = 'new'
    WHERE id = v_request.id
      AND institution_id = p_institution_id
      AND handled_by_user_id = p_target_user_id
      AND status = 'in_progress'
      AND archived_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM public.request_handler_history_write(
        v_request.id,
        v_request.institution_id,
        p_target_user_id,
        NULL,
        'release'
    );
END;
$$;

COMMENT ON FUNCTION public.staff_deactivation_release_owned_request(UUID, UUID, UUID) IS
    'S2 internal: release one in_progress request owned by a deactivation target in the same institution. Callable only from deactivate_staff_member. Does not use auth_user_can_read_institution_request. Not granted to authenticated.';

REVOKE ALL ON FUNCTION public.staff_deactivation_release_owned_request(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_deactivation_release_owned_request(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.staff_deactivation_release_owned_request(UUID, UUID, UUID) FROM authenticated;

-- -----------------------------------------------------------------------------
-- deactivate_staff_member
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deactivate_staff_member(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_caller public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_previous_status TEXT;
    v_request_id UUID;
    v_released INTEGER := 0;
    v_unchanged BOOLEAN := FALSE;
BEGIN
    IF v_actor IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

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

    IF p_user_id = v_actor THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_target
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
       OR v_target.primary_role NOT IN (
            'teacher'::public.user_role,
            'secretary'::public.user_role,
            'deputy'::public.user_role
       )
       OR v_target.primary_role IN (
            'institution_manager'::public.user_role,
            'platform_admin'::public.user_role
       )
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_previous_status := v_target.status;
    v_unchanged := (v_previous_status = 'inactive');

    -- R1 secretary denylist + handler-history writer require the RPC flag
    -- and auth.uid() (the Manager) as actor_user_id / changed_by_user_id.
    PERFORM public.request_ownership_enter_rpc();

    FOR v_request_id IN
        SELECT r.id
        FROM public.requests AS r
        WHERE r.handled_by_user_id = v_target.id
          AND r.institution_id = v_caller.institution_id
          AND r.status = 'in_progress'
          AND r.archived_at IS NULL
        ORDER BY r.id
        FOR UPDATE OF r
    LOOP
        PERFORM public.staff_deactivation_release_owned_request(
            v_request_id,
            v_target.id,
            v_caller.institution_id
        );

        v_released := v_released + 1;
    END LOOP;

    IF NOT v_unchanged THEN
        UPDATE public.users
        SET status = 'inactive'
        WHERE id = v_target.id
          AND status IS DISTINCT FROM 'inactive';

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
            'staff_deactivated',
            'user',
            v_target.id,
            jsonb_build_object(
                'previous_status', v_previous_status,
                'new_status', 'inactive',
                'target_user_id', v_target.id,
                'target_primary_role', v_target.primary_role::TEXT,
                'released_request_count', v_released
            ),
            NOW()
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'unchanged', v_unchanged,
        'user_id', v_target.id,
        'status', 'inactive',
        'released_request_count', v_released
    );
END;
$$;

COMMENT ON FUNCTION public.deactivate_staff_member(UUID) IS
    'S2: active institution_manager deactivates same-institution teacher/secretary/deputy. Never DELETE. Auto-releases in_progress assignments via staff_deactivation_release_owned_request (routing-safe; not release_request_handler). completed/rejected/archived assignments preserved. Direct users.status UPDATE remains unauthorized.';

REVOKE ALL ON FUNCTION public.deactivate_staff_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_staff_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.deactivate_staff_member(UUID) TO authenticated;
