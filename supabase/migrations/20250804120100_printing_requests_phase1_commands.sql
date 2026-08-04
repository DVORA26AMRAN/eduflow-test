-- =============================================================================
-- MPEX Printing Requests — Phase 1 command RPCs
-- Privileged transitions are SECURITY DEFINER; no unrestricted client UPDATEs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.printing_resolve_actor_institution()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_institution_id UUID;
BEGIN
    SELECT u.institution_id
    INTO v_institution_id
    FROM public.users AS u
    WHERE u.id = auth.uid()
      AND u.status = 'active';

    RETURN v_institution_id;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_resolve_actor_institution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_resolve_actor_institution() TO authenticated;

CREATE OR REPLACE FUNCTION public.printing_fail(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object('ok', false, 'error_code', p_code);
$$;

CREATE OR REPLACE FUNCTION public.printing_validate_item_payload(p_item JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_mode TEXT;
    v_sides TEXT;
    v_scale TEXT;
    v_copies INT;
    v_pps INT;
    v_size BIGINT;
    v_type TEXT;
    v_filename TEXT;
BEGIN
    v_filename := NULLIF(btrim(COALESCE(p_item->>'original_filename', '')), '');
    v_type := NULLIF(btrim(COALESCE(p_item->>'detected_file_type', '')), '');
    v_size := NULLIF(p_item->>'file_size_bytes', '')::BIGINT;
    v_mode := COALESCE(p_item->>'page_selection_mode', 'all');
    v_sides := COALESCE(p_item->>'sides', 'single_sided');
    v_scale := COALESCE(p_item->>'scale_mode', 'fit_to_page');
    v_copies := COALESCE(NULLIF(p_item->>'copies', '')::INT, 1);
    v_pps := COALESCE(NULLIF(p_item->>'pages_per_sheet', '')::INT, 1);

    IF v_filename IS NULL THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_size IS NULL OR v_size <= 0 THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_size > 52428800 THEN
        RETURN 'PRINT_FILE_TOO_LARGE';
    END IF;

    IF v_type IS NULL OR NOT public.printing_is_allowed_file_type(v_type) THEN
        RETURN 'PRINT_FILE_TYPE_NOT_ALLOWED';
    END IF;

    IF v_copies < 1 OR v_copies > 500 THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF COALESCE(p_item->>'color_mode', 'black_and_white') NOT IN ('black_and_white', 'color') THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF COALESCE(p_item->>'orientation', 'portrait') NOT IN ('portrait', 'landscape') THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_sides NOT IN ('single_sided', 'double_sided') THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_sides = 'double_sided'
       AND COALESCE(p_item->>'duplex_flip_mode', '') NOT IN ('long_edge', 'short_edge')
    THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_sides = 'single_sided'
       AND NULLIF(p_item->>'duplex_flip_mode', '') IS NOT NULL
    THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_pps NOT IN (1, 2, 4, 6, 9) THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_scale NOT IN ('fit_to_page', 'original_100', 'custom') THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF v_scale = 'custom' THEN
        IF NULLIF(p_item->>'custom_scale_percent', '')::INT IS NULL
           OR (p_item->>'custom_scale_percent')::INT < 10
           OR (p_item->>'custom_scale_percent')::INT > 400
        THEN
            RETURN 'INVALID_PRINT_SETTINGS';
        END IF;
    ELSIF NULLIF(p_item->>'custom_scale_percent', '') IS NOT NULL THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF NOT public.printing_is_valid_page_selection(
        v_mode,
        NULLIF(p_item->>'page_selection_value', '')
    ) THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    IF COALESCE(p_item->>'paper_size', 'a4') NOT IN ('a4', 'a3', 'letter', 'legal') THEN
        RETURN 'INVALID_PRINT_SETTINGS';
    END IF;

    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- Create printing request (teacher; auth identity is authoritative)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_create_request(
    p_required_by TIMESTAMPTZ,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_institution_id UUID;
    v_deadline_error TEXT;
    v_item JSONB;
    v_item_error TEXT;
    v_count INT;
    v_request_id UUID := gen_random_uuid();
    v_request_number INT;
    v_order INT := 0;
    v_item_id UUID;
    v_storage_path TEXT;
    v_created_items JSONB := '[]'::JSONB;
BEGIN
    IF v_actor IS NULL THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    v_institution_id := public.printing_resolve_actor_institution();
    IF v_institution_id IS NULL
       OR NOT public.auth_user_is_active_teacher_for_institution(v_institution_id)
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    v_count := jsonb_array_length(p_items);
    IF v_count < 1 THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;
    IF v_count > 10 THEN
        RETURN public.printing_fail('PRINT_ITEM_LIMIT_EXCEEDED');
    END IF;

    v_deadline_error := public.printing_validate_required_by(v_institution_id, p_required_by);
    IF v_deadline_error IS NOT NULL THEN
        RETURN public.printing_fail(v_deadline_error);
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_error := public.printing_validate_item_payload(v_item);
        IF v_item_error IS NOT NULL THEN
            RETURN public.printing_fail(v_item_error);
        END IF;
    END LOOP;

    v_request_number := public.printing_allocate_request_number(v_institution_id);

    INSERT INTO public.printing_requests (
        id,
        request_number,
        institution_id,
        teacher_user_id,
        required_by,
        status,
        submitted_at,
        updated_at,
        created_at
    ) VALUES (
        v_request_id,
        v_request_number,
        v_institution_id,
        v_actor,
        p_required_by,
        'submitted',
        NOW(),
        NOW(),
        NOW()
    );

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_order := v_order + 1;
        v_item_id := gen_random_uuid();
        v_storage_path :=
            v_institution_id::TEXT || '/' ||
            v_request_id::TEXT || '/' ||
            v_item_id::TEXT || '/' ||
            gen_random_uuid()::TEXT;

        INSERT INTO public.print_items (
            id,
            printing_request_id,
            institution_id,
            storage_bucket,
            storage_object_path,
            original_filename,
            detected_file_type,
            file_size_bytes,
            display_order,
            page_selection_mode,
            page_selection_value,
            copies,
            color_mode,
            paper_size,
            orientation,
            sides,
            duplex_flip_mode,
            pages_per_sheet,
            scale_mode,
            custom_scale_percent,
            "collate",
            notes,
            status
        ) VALUES (
            v_item_id,
            v_request_id,
            v_institution_id,
            'printing-files',
            v_storage_path,
            btrim(v_item->>'original_filename'),
            lower(btrim(v_item->>'detected_file_type')),
            (v_item->>'file_size_bytes')::BIGINT,
            COALESCE(NULLIF(v_item->>'display_order', '')::INT, v_order),
            COALESCE(v_item->>'page_selection_mode', 'all'),
            NULLIF(btrim(COALESCE(v_item->>'page_selection_value', '')), ''),
            COALESCE(NULLIF(v_item->>'copies', '')::INT, 1),
            COALESCE(v_item->>'color_mode', 'black_and_white'),
            COALESCE(v_item->>'paper_size', 'a4'),
            COALESCE(v_item->>'orientation', 'portrait'),
            COALESCE(v_item->>'sides', 'single_sided'),
            CASE
                WHEN COALESCE(v_item->>'sides', 'single_sided') = 'double_sided'
                    THEN v_item->>'duplex_flip_mode'
                ELSE NULL
            END,
            COALESCE(NULLIF(v_item->>'pages_per_sheet', '')::INT, 1),
            COALESCE(v_item->>'scale_mode', 'fit_to_page'),
            NULLIF(v_item->>'custom_scale_percent', '')::INT,
            COALESCE((v_item->>'collate')::BOOLEAN, TRUE),
            NULLIF(btrim(COALESCE(v_item->>'notes', '')), ''),
            'pending'
        );

        v_created_items := v_created_items || jsonb_build_array(
            jsonb_build_object(
                'id', v_item_id,
                'storage_bucket', 'printing-files',
                'storage_object_path', v_storage_path,
                'display_order', COALESCE(NULLIF(v_item->>'display_order', '')::INT, v_order)
            )
        );
    END LOOP;

    PERFORM public.printing_write_audit(
        v_request_id,
        NULL,
        v_institution_id,
        v_actor,
        'request_created',
        NULL,
        'submitted',
        NULL,
        jsonb_build_object(
            'request_number', v_request_number,
            'item_count', v_count
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'printing_request_id', v_request_id,
        'request_number', v_request_number,
        'status', 'submitted',
        'items', v_created_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- Teacher update (settings / required_by) — locked after claim
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_update_request(
    p_printing_request_id UUID,
    p_required_by TIMESTAMPTZ DEFAULT NULL,
    p_items JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_req public.printing_requests%ROWTYPE;
    v_deadline_error TEXT;
    v_item JSONB;
    v_item_error TEXT;
    v_count INT;
    v_item_id UUID;
    v_order INT := 0;
    v_storage_path TEXT;
    v_prev TEXT;
BEGIN
    SELECT * INTO v_req
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    IF v_req.teacher_user_id IS DISTINCT FROM v_actor
       OR NOT public.auth_user_is_active_teacher_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF v_req.assigned_secretary_user_id IS NOT NULL
       OR v_req.processing_started_at IS NOT NULL
       OR v_req.status NOT IN ('submitted', 'needs_correction')
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_LOCKED');
    END IF;

    v_prev := v_req.status;

    IF p_required_by IS NOT NULL THEN
        v_deadline_error := public.printing_validate_required_by(v_req.institution_id, p_required_by);
        IF v_deadline_error IS NOT NULL THEN
            RETURN public.printing_fail(v_deadline_error);
        END IF;

        UPDATE public.printing_requests
        SET required_by = p_required_by, updated_at = NOW()
        WHERE id = v_req.id;
    END IF;

    IF p_items IS NOT NULL THEN
        IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
            RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
        END IF;

        v_count := jsonb_array_length(p_items);
        IF v_count < 1 OR v_count > 10 THEN
            RETURN public.printing_fail('PRINT_ITEM_LIMIT_EXCEEDED');
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_item_error := public.printing_validate_item_payload(v_item);
            IF v_item_error IS NOT NULL THEN
                RETURN public.printing_fail(v_item_error);
            END IF;
        END LOOP;

        DELETE FROM public.print_items WHERE printing_request_id = v_req.id;

        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_order := v_order + 1;
            v_item_id := COALESCE(NULLIF(v_item->>'id', '')::UUID, gen_random_uuid());
            v_storage_path := COALESCE(
                NULLIF(btrim(COALESCE(v_item->>'storage_object_path', '')), ''),
                v_req.institution_id::TEXT || '/' || v_req.id::TEXT || '/' ||
                v_item_id::TEXT || '/' || gen_random_uuid()::TEXT
            );

            INSERT INTO public.print_items (
                id,
                printing_request_id,
                institution_id,
                storage_bucket,
                storage_object_path,
                original_filename,
                detected_file_type,
                file_size_bytes,
                display_order,
                page_selection_mode,
                page_selection_value,
                copies,
                color_mode,
                paper_size,
                orientation,
                sides,
                duplex_flip_mode,
                pages_per_sheet,
                scale_mode,
                custom_scale_percent,
                "collate",
                notes,
                status
            ) VALUES (
                v_item_id,
                v_req.id,
                v_req.institution_id,
                'printing-files',
                v_storage_path,
                btrim(v_item->>'original_filename'),
                lower(btrim(v_item->>'detected_file_type')),
                (v_item->>'file_size_bytes')::BIGINT,
                COALESCE(NULLIF(v_item->>'display_order', '')::INT, v_order),
                COALESCE(v_item->>'page_selection_mode', 'all'),
                NULLIF(btrim(COALESCE(v_item->>'page_selection_value', '')), ''),
                COALESCE(NULLIF(v_item->>'copies', '')::INT, 1),
                COALESCE(v_item->>'color_mode', 'black_and_white'),
                COALESCE(v_item->>'paper_size', 'a4'),
                COALESCE(v_item->>'orientation', 'portrait'),
                COALESCE(v_item->>'sides', 'single_sided'),
                CASE
                    WHEN COALESCE(v_item->>'sides', 'single_sided') = 'double_sided'
                        THEN v_item->>'duplex_flip_mode'
                    ELSE NULL
                END,
                COALESCE(NULLIF(v_item->>'pages_per_sheet', '')::INT, 1),
                COALESCE(v_item->>'scale_mode', 'fit_to_page'),
                NULLIF(v_item->>'custom_scale_percent', '')::INT,
                COALESCE((v_item->>'collate')::BOOLEAN, TRUE),
                NULLIF(btrim(COALESCE(v_item->>'notes', '')), ''),
                CASE
                    WHEN v_prev = 'needs_correction' THEN 'resubmitted'
                    ELSE 'pending'
                END
            );
        END LOOP;

        PERFORM public.printing_sync_parent_status(v_req.id);
    END IF;

    UPDATE public.printing_requests
    SET updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.printing_write_audit(
        v_req.id,
        NULL,
        v_req.institution_id,
        v_actor,
        'request_edited',
        v_prev,
        (SELECT status FROM public.printing_requests WHERE id = v_req.id),
        NULL,
        '{}'::JSONB
    );

    RETURN jsonb_build_object(
        'ok', true,
        'printing_request_id', v_req.id,
        'status', (SELECT status FROM public.printing_requests WHERE id = v_req.id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- Cancel
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_cancel_request(
    p_printing_request_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_req public.printing_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_req
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    IF v_req.teacher_user_id IS DISTINCT FROM v_actor
       OR NOT public.auth_user_is_active_teacher_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF v_req.assigned_secretary_user_id IS NOT NULL
       OR v_req.processing_started_at IS NOT NULL
       OR v_req.status NOT IN ('submitted', 'needs_correction')
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_LOCKED');
    END IF;

    UPDATE public.printing_requests
    SET
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.printing_write_audit(
        v_req.id,
        NULL,
        v_req.institution_id,
        v_actor,
        'request_cancelled',
        v_req.status,
        'cancelled',
        p_reason,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.printing_cancel_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_cancel_request(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Atomic claim (Start Processing)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_claim_request(
    p_printing_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_req public.printing_requests%ROWTYPE;
    v_updated public.printing_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_req
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(v_req.institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_req.status IN ('cancelled', 'printed', 'rejected') THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF v_req.assigned_secretary_user_id IS NOT NULL THEN
        IF v_req.assigned_secretary_user_id = v_actor THEN
            RETURN jsonb_build_object(
                'ok', true,
                'idempotent', true,
                'assigned_secretary_user_id', v_actor,
                'status', v_req.status
            );
        END IF;
        RETURN public.printing_fail('PRINT_REQUEST_ALREADY_CLAIMED');
    END IF;

    UPDATE public.printing_requests
    SET
        assigned_secretary_user_id = v_actor,
        processing_started_at = COALESCE(processing_started_at, NOW()),
        status = CASE
            WHEN status = 'submitted' THEN 'in_progress'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = p_printing_request_id
      AND assigned_secretary_user_id IS NULL
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_ALREADY_CLAIMED');
    END IF;

    UPDATE public.print_items
    SET status = 'processing', updated_at = NOW()
    WHERE printing_request_id = v_updated.id
      AND status IN ('pending', 'resubmitted');

    PERFORM public.printing_sync_parent_status(v_updated.id);

    PERFORM public.printing_write_audit(
        v_updated.id,
        NULL,
        v_updated.institution_id,
        v_actor,
        'secretary_claimed',
        v_req.status,
        (SELECT status FROM public.printing_requests WHERE id = v_updated.id),
        NULL,
        jsonb_build_object('assigned_secretary_user_id', v_actor)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'assigned_secretary_user_id', v_actor,
        'processing_started_at', v_updated.processing_started_at,
        'status', (SELECT status FROM public.printing_requests WHERE id = v_updated.id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_claim_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_claim_request(UUID) TO authenticated;

COMMENT ON FUNCTION public.printing_claim_request(UUID) IS
    'Atomic Start Processing claim. Concurrent claimants: exactly one succeeds; loser gets PRINT_REQUEST_ALREADY_CLAIMED.';

-- -----------------------------------------------------------------------------
-- Release
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_release_request(
    p_printing_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_req public.printing_requests%ROWTYPE;
    v_prev TEXT;
BEGIN
    SELECT * INTO v_req
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(v_req.institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_req.assigned_secretary_user_id IS NULL THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF v_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    v_prev := v_req.status;

    UPDATE public.printing_requests
    SET
        assigned_secretary_user_id = NULL,
        updated_at = NOW()
    WHERE id = v_req.id;

    -- Intentionally keep processing_started_at and item progress (no automatic wipe).
    PERFORM public.printing_sync_parent_status(v_req.id);

    PERFORM public.printing_write_audit(
        v_req.id,
        NULL,
        v_req.institution_id,
        v_actor,
        'secretary_released',
        v_prev,
        (SELECT status FROM public.printing_requests WHERE id = v_req.id),
        NULL,
        jsonb_build_object('previous_assignee', v_req.assigned_secretary_user_id)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'assigned_secretary_user_id', NULL,
        'status', (SELECT status FROM public.printing_requests WHERE id = v_req.id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_release_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_release_request(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Transfer
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_transfer_request(
    p_printing_request_id UUID,
    p_target_secretary_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_req public.printing_requests%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_prev TEXT;
BEGIN
    SELECT * INTO v_req
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(v_req.institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_req.assigned_secretary_user_id IS NULL THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF v_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_target_secretary_user_id;

    IF NOT FOUND
       OR v_target.status IS DISTINCT FROM 'active'
       OR v_target.primary_role IS DISTINCT FROM 'secretary'
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_target.institution_id IS DISTINCT FROM v_req.institution_id THEN
        RETURN public.printing_fail('CROSS_INSTITUTION_ACCESS_DENIED');
    END IF;

    v_prev := v_req.status;

    UPDATE public.printing_requests
    SET
        assigned_secretary_user_id = v_target.id,
        updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.printing_write_audit(
        v_req.id,
        NULL,
        v_req.institution_id,
        v_actor,
        'secretary_transferred',
        v_prev,
        v_req.status,
        NULL,
        jsonb_build_object(
            'from_secretary_user_id', v_req.assigned_secretary_user_id,
            'to_secretary_user_id', v_target.id
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'assigned_secretary_user_id', v_target.id,
        'status', v_req.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_transfer_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_transfer_request(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Item transitions (assigned secretary / manager)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_require_assigned_processor(
    p_req public.printing_requests
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF NOT public.auth_user_is_active_secretary_for_institution(p_req.institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(p_req.institution_id)
    THEN
        RETURN 'SECRETARY_NOT_AUTHORIZED';
    END IF;

    IF p_req.assigned_secretary_user_id IS NULL THEN
        RETURN 'PRINT_REQUEST_LOCKED';
    END IF;

    IF p_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_manager_for_institution(p_req.institution_id)
    THEN
        RETURN 'SECRETARY_NOT_AUTHORIZED';
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.printing_return_item_for_correction(
    p_print_item_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_item public.print_items%ROWTYPE;
    v_req public.printing_requests%ROWTYPE;
    v_auth_error TEXT;
    v_parent TEXT;
BEGIN
    SELECT * INTO v_item FROM public.print_items WHERE id = p_print_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    SELECT * INTO v_req FROM public.printing_requests WHERE id = v_item.printing_request_id FOR UPDATE;
    v_auth_error := public.printing_require_assigned_processor(v_req);
    IF v_auth_error IS NOT NULL THEN
        RETURN public.printing_fail(v_auth_error);
    END IF;

    IF NOT public.printing_item_transition_allowed(v_item.status, 'returned_for_correction') THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    UPDATE public.print_items
    SET
        status = 'returned_for_correction',
        correction_reason = btrim(p_reason),
        updated_at = NOW()
    WHERE id = v_item.id;

    v_parent := public.printing_sync_parent_status(v_req.id);

    PERFORM public.printing_write_audit(
        v_req.id,
        v_item.id,
        v_req.institution_id,
        v_actor,
        'item_returned_for_correction',
        v_item.status,
        'returned_for_correction',
        p_reason,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'item_status', 'returned_for_correction', 'request_status', v_parent);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.printing_resubmit_item(
    p_print_item_id UUID,
    p_item JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_item public.print_items%ROWTYPE;
    v_req public.printing_requests%ROWTYPE;
    v_item_error TEXT;
    v_parent TEXT;
BEGIN
    SELECT * INTO v_item FROM public.print_items WHERE id = p_print_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    SELECT * INTO v_req FROM public.printing_requests WHERE id = v_item.printing_request_id FOR UPDATE;

    IF v_req.teacher_user_id IS DISTINCT FROM v_actor
       OR NOT public.auth_user_is_active_teacher_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF v_req.status = 'cancelled' THEN
        RETURN public.printing_fail('PRINT_REQUEST_LOCKED');
    END IF;

    IF NOT public.printing_item_transition_allowed(v_item.status, 'resubmitted') THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF p_item IS NOT NULL THEN
        v_item_error := public.printing_validate_item_payload(p_item);
        IF v_item_error IS NOT NULL THEN
            RETURN public.printing_fail(v_item_error);
        END IF;

        UPDATE public.print_items
        SET
            original_filename = btrim(p_item->>'original_filename'),
            detected_file_type = lower(btrim(p_item->>'detected_file_type')),
            file_size_bytes = (p_item->>'file_size_bytes')::BIGINT,
            page_selection_mode = COALESCE(p_item->>'page_selection_mode', page_selection_mode),
            page_selection_value = NULLIF(btrim(COALESCE(p_item->>'page_selection_value', '')), ''),
            copies = COALESCE(NULLIF(p_item->>'copies', '')::INT, copies),
            color_mode = COALESCE(p_item->>'color_mode', color_mode),
            paper_size = COALESCE(p_item->>'paper_size', paper_size),
            orientation = COALESCE(p_item->>'orientation', orientation),
            sides = COALESCE(p_item->>'sides', sides),
            duplex_flip_mode = CASE
                WHEN COALESCE(p_item->>'sides', sides) = 'double_sided'
                    THEN p_item->>'duplex_flip_mode'
                ELSE NULL
            END,
            pages_per_sheet = COALESCE(NULLIF(p_item->>'pages_per_sheet', '')::INT, pages_per_sheet),
            scale_mode = COALESCE(p_item->>'scale_mode', scale_mode),
            custom_scale_percent = NULLIF(p_item->>'custom_scale_percent', '')::INT,
            "collate" = COALESCE((p_item->>'collate')::BOOLEAN, "collate"),
            notes = NULLIF(btrim(COALESCE(p_item->>'notes', '')), ''),
            storage_object_path = COALESCE(
                NULLIF(btrim(COALESCE(p_item->>'storage_object_path', '')), ''),
                storage_object_path
            ),
            status = 'resubmitted',
            updated_at = NOW()
        WHERE id = v_item.id;
    ELSE
        UPDATE public.print_items
        SET status = 'resubmitted', updated_at = NOW()
        WHERE id = v_item.id;
    END IF;

    v_parent := public.printing_sync_parent_status(v_req.id);

    PERFORM public.printing_write_audit(
        v_req.id,
        v_item.id,
        v_req.institution_id,
        v_actor,
        'item_resubmitted',
        v_item.status,
        'resubmitted',
        NULL,
        '{}'::JSONB
    );

    RETURN jsonb_build_object('ok', true, 'item_status', 'resubmitted', 'request_status', v_parent);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_resubmit_item(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_resubmit_item(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.printing_reject_item(
    p_print_item_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_item public.print_items%ROWTYPE;
    v_req public.printing_requests%ROWTYPE;
    v_auth_error TEXT;
    v_parent TEXT;
BEGIN
    SELECT * INTO v_item FROM public.print_items WHERE id = p_print_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    SELECT * INTO v_req FROM public.printing_requests WHERE id = v_item.printing_request_id FOR UPDATE;
    v_auth_error := public.printing_require_assigned_processor(v_req);
    IF v_auth_error IS NOT NULL THEN
        RETURN public.printing_fail(v_auth_error);
    END IF;

    IF NOT public.printing_item_transition_allowed(v_item.status, 'rejected') THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    UPDATE public.print_items
    SET
        status = 'rejected',
        rejection_reason = btrim(p_reason),
        updated_at = NOW()
    WHERE id = v_item.id;

    v_parent := public.printing_sync_parent_status(v_req.id);

    PERFORM public.printing_write_audit(
        v_req.id,
        v_item.id,
        v_req.institution_id,
        v_actor,
        'item_rejected',
        v_item.status,
        'rejected',
        p_reason,
        '{}'::JSONB
    );

    IF v_parent = 'printed' THEN
        PERFORM public.printing_write_audit(
            v_req.id,
            NULL,
            v_req.institution_id,
            v_actor,
            'parent_request_completed',
            v_req.status,
            v_parent,
            NULL,
            '{}'::JSONB
        );
    END IF;

    RETURN jsonb_build_object('ok', true, 'item_status', 'rejected', 'request_status', v_parent);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_reject_item(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_reject_item(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.printing_mark_item_printed(
    p_print_item_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_item public.print_items%ROWTYPE;
    v_req public.printing_requests%ROWTYPE;
    v_auth_error TEXT;
    v_parent TEXT;
BEGIN
    SELECT * INTO v_item FROM public.print_items WHERE id = p_print_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_NOT_FOUND');
    END IF;

    SELECT * INTO v_req FROM public.printing_requests WHERE id = v_item.printing_request_id FOR UPDATE;
    v_auth_error := public.printing_require_assigned_processor(v_req);
    IF v_auth_error IS NOT NULL THEN
        RETURN public.printing_fail(v_auth_error);
    END IF;

    IF NOT public.printing_item_transition_allowed(v_item.status, 'printed') THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    UPDATE public.print_items
    SET status = 'printed', updated_at = NOW()
    WHERE id = v_item.id;

    v_parent := public.printing_sync_parent_status(v_req.id);

    PERFORM public.printing_write_audit(
        v_req.id,
        v_item.id,
        v_req.institution_id,
        v_actor,
        'item_marked_printed',
        v_item.status,
        'printed',
        NULL,
        '{}'::JSONB
    );

    IF v_parent = 'printed' THEN
        PERFORM public.printing_write_audit(
            v_req.id,
            NULL,
            v_req.institution_id,
            v_actor,
            'parent_request_completed',
            v_req.status,
            'printed',
            NULL,
            '{}'::JSONB
        );
    END IF;

    RETURN jsonb_build_object('ok', true, 'item_status', 'printed', 'request_status', v_parent);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_mark_item_printed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_mark_item_printed(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Institution printing settings (manager / secretary)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_update_institution_settings(
    p_minimum_print_notice_minutes INTEGER DEFAULT NULL,
    p_deadline_warning_minutes INTEGER DEFAULT NULL,
    p_file_retention_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_institution_id UUID;
BEGIN
    v_institution_id := public.printing_resolve_actor_institution();
    IF v_institution_id IS NULL THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(v_institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF p_minimum_print_notice_minutes IS NOT NULL
       AND (p_minimum_print_notice_minutes < 0 OR p_minimum_print_notice_minutes > 10080)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    IF p_deadline_warning_minutes IS NOT NULL
       AND (p_deadline_warning_minutes < 0 OR p_deadline_warning_minutes > 10080)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    IF p_file_retention_days IS NOT NULL
       AND (p_file_retention_days < 1 OR p_file_retention_days > 3650)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    UPDATE public.institutions
    SET
        minimum_print_notice_minutes = COALESCE(p_minimum_print_notice_minutes, minimum_print_notice_minutes),
        deadline_warning_minutes = COALESCE(p_deadline_warning_minutes, deadline_warning_minutes),
        file_retention_days = COALESCE(p_file_retention_days, file_retention_days)
    WHERE id = v_institution_id;

    PERFORM public.printing_write_audit(
        NULL,
        NULL,
        v_institution_id,
        v_actor,
        'institution_settings_updated',
        NULL,
        NULL,
        NULL,
        jsonb_build_object(
            'minimum_print_notice_minutes', p_minimum_print_notice_minutes,
            'deadline_warning_minutes', p_deadline_warning_minutes,
            'file_retention_days', p_file_retention_days
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'institution_id', v_institution_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) TO authenticated;
