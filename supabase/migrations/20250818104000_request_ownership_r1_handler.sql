-- =============================================================================
-- MPEX R1 — Request ownership database foundation
-- =============================================================================
-- Forward-only. Does not edit applied D1–D3C / 102500 migrations.
-- Does NOT apply until architecture review and live GRANT inspection (below).
-- Does NOT touch school-registration / quotation / Phase 3.
-- Does NOT broaden public.users ACL.
-- Does NOT broaden request SELECT visibility / routing.
--
-- Product:
--   At most one current handler (requests.handled_by_user_id).
--   Eligible handlers: institution_manager | deputy | secretary.
--   Caller/target must already be in the existing routing/read lane.
--   Teacher and platform_admin can never be handlers.
--   Claim is atomic: unassigned + status=new -> handler=self + status=in_progress.
--   Ordinary status mutation: only the current handler (no Manager status override).
--   Manager administrative override: transfer/release only.
--   Deputy/Secretary cannot override another handler.
--
-- Release invariant:
--   Only in_progress assigned requests may be released.
--   Release atomically clears handled_by_user_id and sets status=new.
--   completed/rejected cannot be claimed, transferred, or released.
--
-- BEFORE APPLY — live privilege inspection REQUIRED (do not assume ACL):
--   SELECT grantee, privilege_type, is_grantable
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'requests'
--   ORDER BY grantee, privilege_type;
--
--   SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_schema = 'public' AND table_name = 'requests'
--     AND privilege_type = 'UPDATE'
--   ORDER BY grantee, column_name;
--
--   SELECT tgname, pg_get_triggerdef(t.oid)
--   FROM pg_trigger t
--   JOIN pg_class c ON c.oid = t.tgrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'requests' AND NOT t.tgisinternal;
--
-- LIVE SCHEMA (inspection complete; do not assume otherwise):
--   anon and authenticated hold table-level UPDATE on public.requests
--     (authorizes every current column, including status).
--   service_role has its normal direct privileges — leave unchanged.
--   Live triggers on public.requests:
--     requests_create_general_request_notification
--     requests_create_status_notification
--     requests_enforce_secretary_update_columns   (ALREADY EXISTS)
--     requests_enforce_teacher_insert_columns
--     requests_set_updated_at
--     requests_write_status_history
--
-- Target after this migration:
--   PUBLIC / anon: no direct request-table DML
--   authenticated: SELECT + INSERT retained (Teacher create)
--   authenticated UPDATE: (archived_at, archived_by_user_id) only
--   service_role: unchanged
--   Status and handled_by_user_id mutate only through SECURITY DEFINER RPCs.
--   Existing non-secretary triggers are not dropped or replaced.

-- -----------------------------------------------------------------------------
-- Current handler column
-- -----------------------------------------------------------------------------

ALTER TABLE public.requests
    ADD COLUMN IF NOT EXISTS handled_by_user_id UUID
        REFERENCES public.users (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.requests.handled_by_user_id IS
    'R1: current operational handler. NULL = unassigned. Eligible: active same-institution manager/deputy/secretary in the existing routing lane. Mutated only by claim/transfer/release RPCs.';

CREATE INDEX IF NOT EXISTS idx_requests_handled_by_user_id
    ON public.requests (handled_by_user_id)
    WHERE handled_by_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Immutable assignment history
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_handler_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    previous_handler_user_id UUID REFERENCES public.users (id) ON DELETE RESTRICT,
    new_handler_user_id UUID REFERENCES public.users (id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT request_handler_history_action_valid
        CHECK (action IN ('claim', 'transfer', 'release')),
    CONSTRAINT request_handler_history_claim_shape
        CHECK (
            action <> 'claim'
            OR (
                previous_handler_user_id IS NULL
                AND new_handler_user_id IS NOT NULL
            )
        ),
    CONSTRAINT request_handler_history_transfer_shape
        CHECK (
            action <> 'transfer'
            OR (
                previous_handler_user_id IS NOT NULL
                AND new_handler_user_id IS NOT NULL
                AND previous_handler_user_id IS DISTINCT FROM new_handler_user_id
            )
        ),
    CONSTRAINT request_handler_history_release_shape
        CHECK (
            action <> 'release'
            OR (
                previous_handler_user_id IS NOT NULL
                AND new_handler_user_id IS NULL
            )
        )
);

COMMENT ON TABLE public.request_handler_history IS
    'R1 immutable handler assignment audit. actor_user_id is always auth.uid() from SECURITY DEFINER RPCs. No authenticated INSERT/UPDATE/DELETE.';

CREATE INDEX IF NOT EXISTS idx_request_handler_history_request_created_at
    ON public.request_handler_history (request_id, created_at DESC);

ALTER TABLE public.request_handler_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.request_handler_history FROM PUBLIC;
REVOKE ALL ON TABLE public.request_handler_history FROM anon;
REVOKE ALL ON TABLE public.request_handler_history FROM authenticated;

GRANT SELECT ON TABLE public.request_handler_history TO authenticated;

DROP POLICY IF EXISTS request_handler_history_select_authorized ON public.request_handler_history;
CREATE POLICY request_handler_history_select_authorized
    ON public.request_handler_history
    FOR SELECT
    TO authenticated
    USING (public.auth_user_can_read_institution_request(request_id));

-- -----------------------------------------------------------------------------
-- Eligibility helper (does not use auth.uid() so transfer targets can be checked)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_user_can_handle_request(
    p_user_id UUID,
    p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_request public.requests%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_request_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT * INTO v_request
    FROM public.requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    SELECT * INTO v_user
    FROM public.users
    WHERE id = p_user_id;

    IF NOT FOUND
       OR v_user.status IS DISTINCT FROM 'active'
       OR v_user.institution_id IS DISTINCT FROM v_request.institution_id
       OR v_user.primary_role NOT IN (
            'institution_manager'::public.user_role,
            'deputy'::public.user_role,
            'secretary'::public.user_role
       )
    THEN
        RETURN FALSE;
    END IF;

    IF v_request.request_type = 'general_request' THEN
        IF v_request.recipient_role = 'institution_manager' THEN
            RETURN v_user.primary_role IN (
                'institution_manager'::public.user_role,
                'deputy'::public.user_role
            );
        END IF;

        IF v_request.recipient_role = 'secretary' THEN
            RETURN v_user.primary_role = 'secretary'::public.user_role;
        END IF;

        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.request_user_can_handle_request(UUID, UUID) IS
    'R1: true when the user is an active same-institution manager/deputy/secretary allowed by existing request routing. Teachers and platform_admin are never eligible.';

REVOKE ALL ON FUNCTION public.request_user_can_handle_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_user_can_handle_request(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_ownership_enter_rpc()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM set_config('mpex.request_mutation_rpc', '1', true);
END;
$$;

COMMENT ON FUNCTION public.request_ownership_enter_rpc() IS
    'R1: transaction-local flag so the secretary column denylist allows SECURITY DEFINER RPC mutations.';

REVOKE ALL ON FUNCTION public.request_ownership_enter_rpc() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.request_handler_history_write(
    p_request_id UUID,
    p_institution_id UUID,
    p_previous_handler_user_id UUID,
    p_new_handler_user_id UUID,
    p_action TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.request_handler_history (
        request_id,
        institution_id,
        actor_user_id,
        previous_handler_user_id,
        new_handler_user_id,
        action
    ) VALUES (
        p_request_id,
        p_institution_id,
        auth.uid(),
        p_previous_handler_user_id,
        p_new_handler_user_id,
        p_action
    );
END;
$$;

COMMENT ON FUNCTION public.request_handler_history_write(UUID, UUID, UUID, UUID, TEXT) IS
    'R1: append-only history writer. actor_user_id is always auth.uid().';

REVOKE ALL ON FUNCTION public.request_handler_history_write(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- claim_request
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
    v_request public.requests%ROWTYPE;
    v_updated public.requests%ROWTYPE;
BEGIN
    PERFORM public.request_ownership_enter_rpc();

    IF v_actor IS NULL OR p_request_id IS NULL THEN
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
    'R1: atomic claim. Unassigned + status=new -> handled_by=auth.uid() + status=in_progress. SELECT FOR UPDATE + CAS. Self in_progress claim is idempotent. Does not duplicate side effects: existing requests_write_status_history, requests_create_status_notification, and requests_set_updated_at fire from the status UPDATE.';

REVOKE ALL ON FUNCTION public.claim_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_request(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- transfer_request_handler
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
    'R1: transfer current handler. Current handler or active institution_manager (administrative). Deputy/Secretary cannot override another handler. Status unchanged. Target must pass request_user_can_handle_request. Final states fail closed.';

REVOKE ALL ON FUNCTION public.transfer_request_handler(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_request_handler(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- release_request_handler
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_request_handler(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_request public.requests%ROWTYPE;
    v_updated public.requests%ROWTYPE;
    v_is_handler BOOLEAN;
    v_is_manager BOOLEAN;
BEGIN
    PERFORM public.request_ownership_enter_rpc();

    IF v_actor IS NULL OR p_request_id IS NULL THEN
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

    IF v_request.status IS DISTINCT FROM 'in_progress' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_RELEASE_NOT_ALLOWED');
    END IF;

    UPDATE public.requests
    SET
        handled_by_user_id = NULL,
        status = 'new'
    WHERE id = v_request.id
      AND handled_by_user_id = v_request.handled_by_user_id
      AND status = 'in_progress'
      AND archived_at IS NULL
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ALREADY_CLAIMED');
    END IF;

    PERFORM public.request_handler_history_write(
        v_updated.id,
        v_updated.institution_id,
        v_request.handled_by_user_id,
        NULL,
        'release'
    );

    RETURN jsonb_build_object(
        'ok', true,
        'handled_by_user_id', NULL,
        'status', v_updated.status
    );
END;
$$;

COMMENT ON FUNCTION public.release_request_handler(UUID) IS
    'R1: current handler or active institution_manager may release. Deputy/Secretary cannot release another handler. Clears handled_by_user_id and sets status=new atomically. completed/rejected fail closed. Existing status-history trigger records in_progress -> new.';

REVOKE ALL ON FUNCTION public.release_request_handler(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_request_handler(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- update_request_status — operator + secretary RPC, ownership enforced
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_request_status(
    p_request_id UUID,
    p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_request public.requests%ROWTYPE;
    v_status TEXT;
BEGIN
    PERFORM public.request_ownership_enter_rpc();

    IF v_actor IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_status := btrim(COALESCE(p_status, ''));

    IF v_status NOT IN ('new', 'in_progress', 'completed', 'rejected') THEN
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
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- New unassigned work is claimed, not status-updated into in_progress.
    IF v_request.handled_by_user_id IS NULL AND v_request.status = 'new' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.status = 'new' AND v_status = 'in_progress' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.handled_by_user_id IS NOT NULL
       AND v_request.handled_by_user_id IS DISTINCT FROM v_actor
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.status IS NOT DISTINCT FROM v_status THEN
        RETURN jsonb_build_object(
            'ok', true,
            'status', v_status,
            'unchanged', true
        );
    END IF;

    UPDATE public.requests
    SET status = v_status
    WHERE id = v_request.id
      AND archived_at IS NULL
      AND status IS NOT DISTINCT FROM v_request.status
      AND (
            handled_by_user_id IS NOT DISTINCT FROM v_actor
            OR (
                handled_by_user_id IS NULL
                AND v_request.status IS DISTINCT FROM 'new'
            )
          );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'status', v_status
    );
END;
$$;

COMMENT ON FUNCTION public.update_request_status(UUID, TEXT) IS
    'R1: Secretary joins Manager/Deputy on this RPC. Status-only. Assigned rows: only current handler. Unassigned new rows must be claimed. Manager has no status override. Legacy unassigned in_progress/completed/rejected: lane-eligible caller may update. SELECT FOR UPDATE + CAS.';

REVOKE ALL ON FUNCTION public.update_request_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_request_status(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Secretary table UPDATE denylist — archive columns only
-- Live already has trigger requests_enforce_secretary_update_columns.
-- Reconcile: replace the function, then DROP IF EXISTS + CREATE the same
-- canonical trigger name so apply is idempotent and never duplicates.
-- Do NOT drop requests_set_updated_at, requests_write_status_history,
-- requests_create_status_notification, requests_create_general_request_notification,
-- or requests_enforce_teacher_insert_columns.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_requests_secretary_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('mpex.request_mutation_rpc', true) = '1' THEN
        RETURN NEW;
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(OLD.institution_id) THEN
        RETURN NEW;
    END IF;

    -- Direct PostgREST path: only archive columns may change.
    -- updated_at is allowed because live trigger requests_set_updated_at
    -- maintains it on the same BEFORE UPDATE chain.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.request_type IS DISTINCT FROM OLD.request_type
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
       OR NEW.recipient_role IS DISTINCT FROM OLD.recipient_role
       OR NEW.handled_by_user_id IS DISTINCT FROM OLD.handled_by_user_id
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.archived_by_user_id IS NOT NULL
       AND NEW.archived_by_user_id IS DISTINCT FROM auth.uid()
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_requests_secretary_update_columns() IS
    'R1: live secretary UPDATE trigger function. Table path may change archived_at/archived_by_user_id only (updated_at via requests_set_updated_at). Status, handled_by_user_id, request_payload, recipient_role, and identity/routing fields are denied. SECURITY DEFINER RPCs set mpex.request_mutation_rpc.';

DROP TRIGGER IF EXISTS requests_enforce_secretary_update_columns ON public.requests;
CREATE TRIGGER requests_enforce_secretary_update_columns
    BEFORE UPDATE ON public.requests
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_requests_secretary_update_columns();

COMMENT ON TRIGGER requests_enforce_secretary_update_columns ON public.requests IS
    'R1: canonical live secretary column guard. Recreated idempotently under the existing name; not a second trigger.';

-- -----------------------------------------------------------------------------
-- Close live table-level UPDATE. Preserve Teacher SELECT/INSERT.
-- Do not REVOKE ALL FROM authenticated.
-- Leave service_role table privileges unchanged.
-- -----------------------------------------------------------------------------

REVOKE ALL ON TABLE public.requests FROM PUBLIC;
REVOKE ALL ON TABLE public.requests FROM anon;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.requests FROM authenticated;

DO $$
DECLARE
    col_list text;
BEGIN
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO col_list
    FROM pg_attribute AS a
    JOIN pg_class AS c ON c.oid = a.attrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'requests'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF col_list IS NULL THEN
        RAISE EXCEPTION 'public.requests has no columns to revoke UPDATE.';
    END IF;

    EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.requests FROM PUBLIC',
        col_list
    );
    EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.requests FROM anon',
        col_list
    );
    EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.requests FROM authenticated',
        col_list
    );
END
$$;

GRANT SELECT, INSERT ON TABLE public.requests TO authenticated;
GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated;
