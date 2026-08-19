-- =============================================================================
-- EduFlow — R1 assignment concurrency: lock user before request
-- =============================================================================
-- Forward-only. Does NOT edit applied 20250818104000 (R1 live).
-- Timestamp sits after 104000 and before unapplied S2 105000.
--
-- Race closed:
--   Live claim_request / transfer_request_handler lock the request row, then
--   read public.users.status without locking it. deactivate_staff_member
--   (S2 105000, unapplied) locks the target users row first. Interleaving:
--     1) claim/transfer reads actor/target as active
--     2) deactivation locks the user, releases in_progress work, sets inactive
--     3) claim/transfer assigns handled_by_user_id to the now-inactive user
--
-- Canonical lock order for assignment and deactivation:
--   1) public.users row of the assignment target (claim actor / transfer
--      p_target_user_id / deactivation p_user_id) FOR UPDATE
--   2) public.requests row(s) FOR UPDATE
--
-- claim_request: actor is the assignment target → lock actor users row first.
-- transfer_request_handler: lock p_target_user_id users row first.
--   Do NOT also lock the actor users row (two-user lock order would deadlock
--   opposing transfers).
-- deactivate_staff_member (105000): already locks target users then requests.
-- release_request_handler: does not assign; keeps request-only FOR UPDATE so
--   it never waits on a users row while holding a request (no inversion).
--
-- request_user_can_handle_request stays STABLE (no FOR UPDATE). Callers lock
-- the users row before invoking it so status cannot change under the check.
--
-- Does not change eligibility, CAS, history, grants, or Phase 3.

-- -----------------------------------------------------------------------------
-- claim_request — user then request
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_request(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_request public.requests%ROWTYPE;
    v_updated public.requests%ROWTYPE;
BEGIN
    PERFORM public.request_ownership_enter_rpc();

    IF v_actor IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Canonical order: assignment-target users row, then request row.
    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_request
    FROM public.requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.auth_user_can_read_institution_request(p_request_id)
       OR NOT public.request_user_can_handle_request(v_actor, p_request_id)
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ARCHIVED');
    END IF;

    IF v_request.status IN ('completed', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_FINAL_STATE');
    END IF;

    IF v_request.handled_by_user_id IS NOT NULL THEN
        IF v_request.handled_by_user_id = v_actor
           AND v_request.status = 'in_progress'
        THEN
            RETURN jsonb_build_object(
                'ok', true,
                'unchanged', true,
                'handled_by_user_id', v_actor,
                'status', v_request.status
            );
        END IF;

        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ALREADY_CLAIMED');
    END IF;

    IF v_request.status IS DISTINCT FROM 'new' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_CLAIMABLE');
    END IF;

    UPDATE public.requests
    SET
        handled_by_user_id = v_actor,
        status = 'in_progress'
    WHERE id = v_request.id
      AND handled_by_user_id IS NULL
      AND status = 'new'
      AND archived_at IS NULL
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ALREADY_CLAIMED');
    END IF;

    PERFORM public.request_handler_history_write(
        v_updated.id,
        v_updated.institution_id,
        NULL,
        v_actor,
        'claim'
    );

    RETURN jsonb_build_object(
        'ok', true,
        'handled_by_user_id', v_actor,
        'status', v_updated.status
    );
END;
$$;

COMMENT ON FUNCTION public.claim_request(UUID) IS
    'R1 + 104500: atomic claim. Locks actor public.users FOR UPDATE before the request row so a concurrent deactivation cannot leave in_progress owned by an inactive user. Unassigned + status=new -> handled_by=auth.uid() + status=in_progress. Self in_progress claim is idempotent.';

REVOKE ALL ON FUNCTION public.claim_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_request(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- transfer_request_handler — target user then request
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_request_handler(
    p_request_id UUID,
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_target_user public.users%ROWTYPE;
    v_request public.requests%ROWTYPE;
    v_updated public.requests%ROWTYPE;
    v_is_handler BOOLEAN;
    v_is_manager BOOLEAN;
BEGIN
    PERFORM public.request_ownership_enter_rpc();

    IF v_actor IS NULL OR p_request_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Canonical order: assignment-target users row, then request row.
    -- Do not lock the actor users row; opposing transfers would deadlock.
    SELECT *
    INTO v_target_user
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_request
    FROM public.requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.auth_user_can_read_institution_request(p_request_id) THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_is_handler := v_request.handled_by_user_id IS NOT DISTINCT FROM v_actor;
    v_is_manager := public.auth_user_is_active_institution_manager_for_institution(
        v_request.institution_id
    );

    IF NOT v_is_handler AND NOT v_is_manager THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ARCHIVED');
    END IF;

    IF v_request.status IN ('completed', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_FINAL_STATE');
    END IF;

    IF v_request.handled_by_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_ASSIGNED');
    END IF;

    IF p_target_user_id = v_request.handled_by_user_id THEN
        RETURN jsonb_build_object(
            'ok', true,
            'unchanged', true,
            'handled_by_user_id', v_request.handled_by_user_id,
            'status', v_request.status
        );
    END IF;

    IF NOT public.request_user_can_handle_request(p_target_user_id, p_request_id) THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.requests
    SET handled_by_user_id = p_target_user_id
    WHERE id = v_request.id
      AND handled_by_user_id = v_request.handled_by_user_id
      AND archived_at IS NULL
      AND status NOT IN ('completed', 'rejected')
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ALREADY_CLAIMED');
    END IF;

    PERFORM public.request_handler_history_write(
        v_updated.id,
        v_updated.institution_id,
        v_request.handled_by_user_id,
        p_target_user_id,
        'transfer'
    );

    RETURN jsonb_build_object(
        'ok', true,
        'handled_by_user_id', v_updated.handled_by_user_id,
        'status', v_updated.status
    );
END;
$$;

COMMENT ON FUNCTION public.transfer_request_handler(UUID, UUID) IS
    'R1 + 104500: transfer current handler. Locks target public.users FOR UPDATE before the request row so a concurrent deactivation cannot assign an inactive target. Current handler or active institution_manager. Target must pass request_user_can_handle_request after the user lock.';

REVOKE ALL ON FUNCTION public.transfer_request_handler(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_request_handler(UUID, UUID) TO authenticated;
