-- MPEX Printing Requests — Phase 4
-- Notifications, overdue dispatch, retention purge, correction polish.
-- Apply manually via: npx supabase db query --linked -f …
-- Do NOT repair migration history without explicit approval.

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------

ALTER TABLE public.printing_requests
    ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.printing_requests.overdue_notified_at IS
    'Set when the overdue notification was emitted for the current overdue condition; cleared if required_by moves forward (not used for corrections).';

ALTER TABLE public.print_items
    ADD COLUMN IF NOT EXISTS file_purged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.print_items.file_purged_at IS
    'When the private storage object for this item was removed by retention cleanup.';

-- -----------------------------------------------------------------------------
-- Notification types + dedupe indexes
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_valid;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_valid CHECK (
        notification_type IN (
            'REQUEST_STATUS_CHANGED',
            'REQUEST_REMINDER',
            'SUBSTITUTE_BOARD_APPROVED',
            'REQUEST_CREATED',
            'REQUEST_MESSAGE_RECEIVED',
            'MEETING_REQUEST_RECEIVED',
            'MEETING_REQUEST_APPROVED',
            'MEETING_SLOTS_PROPOSED',
            'MEETING_SLOT_SELECTED',
            'MEETING_CONFIRMED',
            'MEETING_CANCELLED',
            'MEETING_RESCHEDULE_REQUESTED',
            'MEETING_RESCHEDULE_CONFIRMED',
            'MEETING_REMINDER',
            'MEETING_DELAY_REPORTED',
            'PRINT_REQUEST_COMPLETED',
            'PRINT_ITEM_RETURNED_FOR_CORRECTION',
            'PRINT_ITEM_REJECTED',
            'PRINT_REQUEST_OVERDUE'
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS notifications_print_completed_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'printing_request_id')),
        ((metadata ->> 'dedupe_key'))
    )
    WHERE notification_type = 'PRINT_REQUEST_COMPLETED'
      AND metadata ? 'printing_request_id'
      AND metadata ? 'dedupe_key';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_print_item_event_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'print_item_id')),
        ((metadata ->> 'dedupe_key'))
    )
    WHERE notification_type IN (
        'PRINT_ITEM_RETURNED_FOR_CORRECTION',
        'PRINT_ITEM_REJECTED'
    )
      AND metadata ? 'print_item_id'
      AND metadata ? 'dedupe_key';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_print_overdue_uidx
    ON public.notifications (
        user_id,
        ((metadata ->> 'printing_request_id')),
        ((metadata ->> 'dedupe_key'))
    )
    WHERE notification_type = 'PRINT_REQUEST_OVERDUE'
      AND metadata ? 'printing_request_id'
      AND metadata ? 'dedupe_key';

-- -----------------------------------------------------------------------------
-- Safe notification insert (dedupe via unique index)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_emit_notification(
    p_institution_id UUID,
    p_user_id UUID,
    p_notification_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL OR p_institution_id IS NULL THEN
        RETURN FALSE;
    END IF;

    BEGIN
        INSERT INTO public.notifications (
            institution_id,
            user_id,
            notification_type,
            title,
            message,
            metadata
        ) VALUES (
            p_institution_id,
            p_user_id,
            p_notification_type,
            p_title,
            p_message,
            COALESCE(p_metadata, '{}'::JSONB)
        );
        RETURN TRUE;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN FALSE;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.printing_notify_teacher_item_returned(
    p_req public.printing_requests,
    p_item public.print_items,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_emitted BOOLEAN;
BEGIN
    v_emitted := public.printing_emit_notification(
        p_req.institution_id,
        p_req.teacher_user_id,
        'PRINT_ITEM_RETURNED_FOR_CORRECTION',
        'קובץ הוחזר לתיקון',
        format(
            'הקובץ %s הוחזר לתיקון.%sסיבה: %s',
            p_item.original_filename,
            E'\n',
            btrim(p_reason)
        ),
        jsonb_build_object(
            'printing_request_id', p_req.id,
            'print_item_id', p_item.id,
            'request_number', p_req.request_number,
            'original_filename', p_item.original_filename,
            'correction_reason', btrim(p_reason),
            'dedupe_key', 'return:' || p_item.id::text || ':' || md5(btrim(p_reason))
        )
    );

    PERFORM public.printing_write_audit(
        p_req.id,
        p_item.id,
        p_req.institution_id,
        COALESCE(auth.uid(), p_req.teacher_user_id),
        'notification_emitted',
        NULL,
        'PRINT_ITEM_RETURNED_FOR_CORRECTION',
        NULL,
        jsonb_build_object(
            'emitted', v_emitted,
            'recipient_user_id', p_req.teacher_user_id,
            'notification_type', 'PRINT_ITEM_RETURNED_FOR_CORRECTION'
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.printing_notify_teacher_item_rejected(
    p_req public.printing_requests,
    p_item public.print_items,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_emitted BOOLEAN;
BEGIN
    v_emitted := public.printing_emit_notification(
        p_req.institution_id,
        p_req.teacher_user_id,
        'PRINT_ITEM_REJECTED',
        'קובץ נדחה',
        format(
            'הקובץ %s נדחה.%sסיבה: %s',
            p_item.original_filename,
            E'\n',
            btrim(p_reason)
        ),
        jsonb_build_object(
            'printing_request_id', p_req.id,
            'print_item_id', p_item.id,
            'request_number', p_req.request_number,
            'original_filename', p_item.original_filename,
            'rejection_reason', btrim(p_reason),
            'dedupe_key', 'reject:' || p_item.id::text || ':' || md5(btrim(p_reason))
        )
    );

    PERFORM public.printing_write_audit(
        p_req.id,
        p_item.id,
        p_req.institution_id,
        COALESCE(auth.uid(), p_req.teacher_user_id),
        'notification_emitted',
        NULL,
        'PRINT_ITEM_REJECTED',
        NULL,
        jsonb_build_object(
            'emitted', v_emitted,
            'recipient_user_id', p_req.teacher_user_id,
            'notification_type', 'PRINT_ITEM_REJECTED'
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.printing_notify_teacher_request_completed(
    p_req public.printing_requests
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_emitted BOOLEAN;
BEGIN
    v_emitted := public.printing_emit_notification(
        p_req.institution_id,
        p_req.teacher_user_id,
        'PRINT_REQUEST_COMPLETED',
        'בקשת הדפסה הושלמה',
        format('בקשת ההדפסה #%s הודפסה ומוכנה לאיסוף.', p_req.request_number),
        jsonb_build_object(
            'printing_request_id', p_req.id,
            'request_number', p_req.request_number,
            'dedupe_key', 'completed:' || p_req.id::text
        )
    );

    PERFORM public.printing_write_audit(
        p_req.id,
        NULL,
        p_req.institution_id,
        COALESCE(auth.uid(), p_req.teacher_user_id),
        'notification_emitted',
        NULL,
        'PRINT_REQUEST_COMPLETED',
        NULL,
        jsonb_build_object(
            'emitted', v_emitted,
            'recipient_user_id', p_req.teacher_user_id,
            'notification_type', 'PRINT_REQUEST_COMPLETED'
        )
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- Patch lifecycle RPCs to emit notifications + resubmit polish
-- -----------------------------------------------------------------------------

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

    PERFORM public.printing_notify_teacher_item_returned(v_req, v_item, p_reason);

    RETURN jsonb_build_object('ok', true, 'item_status', 'returned_for_correction', 'request_status', v_parent);
END;
$$;

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

    IF v_parent IN ('printed', 'rejected', 'cancelled') THEN
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

    PERFORM public.printing_notify_teacher_item_rejected(v_req, v_item, p_reason);

    RETURN jsonb_build_object('ok', true, 'item_status', 'rejected', 'request_status', v_parent);
END;
$$;

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
        SELECT * INTO v_req FROM public.printing_requests WHERE id = v_req.id;
        PERFORM public.printing_notify_teacher_request_completed(v_req);
    END IF;

    RETURN jsonb_build_object('ok', true, 'item_status', 'printed', 'request_status', v_parent);
END;
$$;

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

    IF v_item.status IS DISTINCT FROM 'returned_for_correction' THEN
        RETURN public.printing_fail('PRINT_ITEM_NOT_RETURNED');
    END IF;

    IF NOT public.printing_item_transition_allowed(v_item.status, 'resubmitted') THEN
        RETURN public.printing_fail('PRINT_ITEM_RESUBMISSION_INVALID');
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
            correction_reason = NULL,
            file_purged_at = NULL,
            updated_at = NOW()
        WHERE id = v_item.id;
    ELSE
        UPDATE public.print_items
        SET
            status = 'resubmitted',
            correction_reason = NULL,
            updated_at = NOW()
        WHERE id = v_item.id;
    END IF;

    -- Preserve assignment when present; do not reassign.
    UPDATE public.printing_requests
    SET updated_at = NOW()
    WHERE id = v_req.id;

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
        jsonb_build_object(
            'file_replaced', (p_item IS NOT NULL AND NULLIF(btrim(COALESCE(p_item->>'storage_object_path', '')), '') IS NOT NULL),
            'previous_correction_reason', v_item.correction_reason
        )
    );

    RETURN jsonb_build_object('ok', true, 'item_status', 'resubmitted', 'request_status', v_parent);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.printing_reject_item(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_reject_item(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.printing_mark_item_printed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_mark_item_printed(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.printing_resubmit_item(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_resubmit_item(UUID, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- Overdue notification dispatcher (service role / edge only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_dispatch_overdue_notifications(
    p_batch_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_batch_size, 50), 200));
    v_req RECORD;
    v_teacher_name TEXT;
    v_emitted_count INTEGER := 0;
    v_scanned INTEGER := 0;
    v_recipient UUID;
    v_emitted BOOLEAN;
    v_dedupe TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'SECRETARY_NOT_AUTHORIZED');
    END IF;

    FOR v_req IN
        SELECT r.*
        FROM public.printing_requests r
        WHERE r.status IN ('submitted', 'in_progress', 'needs_correction')
          AND r.required_by < NOW()
          AND r.overdue_notified_at IS NULL
        ORDER BY r.required_by ASC
        LIMIT v_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        v_scanned := v_scanned + 1;
        v_dedupe := 'overdue:' || v_req.id::text || ':' || to_char(v_req.required_by AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI');

        SELECT full_name INTO v_teacher_name
        FROM public.users
        WHERE id = v_req.teacher_user_id;

        IF v_req.assigned_secretary_user_id IS NOT NULL THEN
            v_emitted := public.printing_emit_notification(
                v_req.institution_id,
                v_req.assigned_secretary_user_id,
                'PRINT_REQUEST_OVERDUE',
                'בקשת הדפסה באיחור',
                format(
                    'בקשת ההדפסה #%s עברה את מועד היעד ועדיין לא הושלמה.',
                    v_req.request_number
                ),
                jsonb_build_object(
                    'printing_request_id', v_req.id,
                    'request_number', v_req.request_number,
                    'teacher_full_name', COALESCE(v_teacher_name, ''),
                    'required_by', v_req.required_by,
                    'status', v_req.status,
                    'dedupe_key', v_dedupe
                )
            );
            IF v_emitted THEN
                v_emitted_count := v_emitted_count + 1;
            END IF;
        ELSE
            FOR v_recipient IN
                SELECT u.id
                FROM public.users u
                WHERE u.institution_id = v_req.institution_id
                  AND u.status = 'active'
                  AND u.primary_role = 'secretary'
            LOOP
                v_emitted := public.printing_emit_notification(
                    v_req.institution_id,
                    v_recipient,
                    'PRINT_REQUEST_OVERDUE',
                    'בקשת הדפסה באיחור',
                    format(
                        'בקשת ההדפסה #%s עברה את מועד היעד ועדיין לא הושלמה.',
                        v_req.request_number
                    ),
                    jsonb_build_object(
                        'printing_request_id', v_req.id,
                        'request_number', v_req.request_number,
                        'teacher_full_name', COALESCE(v_teacher_name, ''),
                        'required_by', v_req.required_by,
                        'status', v_req.status,
                        'dedupe_key', v_dedupe
                    )
                );
                IF v_emitted THEN
                    v_emitted_count := v_emitted_count + 1;
                END IF;
            END LOOP;
        END IF;

        UPDATE public.printing_requests
        SET overdue_notified_at = NOW()
        WHERE id = v_req.id;

        PERFORM public.printing_write_audit(
            v_req.id,
            NULL,
            v_req.institution_id,
            COALESCE(v_req.assigned_secretary_user_id, v_req.teacher_user_id),
            'notification_emitted',
            NULL,
            'PRINT_REQUEST_OVERDUE',
            NULL,
            jsonb_build_object('dedupe_key', v_dedupe, 'batch', true)
        );
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'scanned', v_scanned,
        'notifications_emitted', v_emitted_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- Retention eligibility + purge (metadata only; storage delete via edge)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printing_list_retention_purge_candidates(
    p_batch_size INTEGER DEFAULT 50
)
RETURNS TABLE (
    print_item_id UUID,
    printing_request_id UUID,
    institution_id UUID,
    storage_object_path TEXT,
    terminal_at TIMESTAMPTZ,
    file_retention_days INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_batch_size, 50), 200));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        i.id,
        r.id,
        r.institution_id,
        i.storage_object_path,
        COALESCE(r.cancelled_at, r.updated_at) AS terminal_at,
        COALESCE(inst.file_retention_days, 90) AS file_retention_days
    FROM public.print_items i
    JOIN public.printing_requests r ON r.id = i.printing_request_id
    JOIN public.institutions inst ON inst.id = r.institution_id
    WHERE r.status IN ('printed', 'cancelled', 'rejected')
      AND i.file_purged_at IS NULL
      AND i.storage_object_path IS NOT NULL
      AND i.status NOT IN ('returned_for_correction', 'resubmitted', 'pending', 'processing')
      AND COALESCE(r.cancelled_at, r.updated_at) < (NOW() - make_interval(days => COALESCE(inst.file_retention_days, 90)))
    ORDER BY COALESCE(r.cancelled_at, r.updated_at) ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.printing_mark_item_file_purged(
    p_print_item_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item public.print_items%ROWTYPE;
    v_req public.printing_requests%ROWTYPE;
    v_remaining INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'SECRETARY_NOT_AUTHORIZED');
    END IF;

    SELECT * INTO v_item FROM public.print_items WHERE id = p_print_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'PRINT_REQUEST_NOT_FOUND');
    END IF;

    SELECT * INTO v_req FROM public.printing_requests WHERE id = v_item.printing_request_id FOR UPDATE;

    IF v_req.status NOT IN ('printed', 'cancelled', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'PRINT_RETENTION_NOT_ELIGIBLE');
    END IF;

    IF v_item.file_purged_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'already_purged', true, 'error_code', 'PRINT_FILE_ALREADY_PURGED');
    END IF;

    IF v_item.status IN ('returned_for_correction', 'resubmitted', 'pending', 'processing') THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'PRINT_RETENTION_NOT_ELIGIBLE');
    END IF;

    UPDATE public.print_items
    SET
        file_purged_at = NOW(),
        storage_object_path = NULL,
        updated_at = NOW()
    WHERE id = v_item.id;

    SELECT COUNT(*)::INTEGER INTO v_remaining
    FROM public.print_items
    WHERE printing_request_id = v_req.id
      AND file_purged_at IS NULL
      AND storage_object_path IS NOT NULL;

    IF v_remaining = 0 THEN
        UPDATE public.printing_requests
        SET files_purged_at = COALESCE(files_purged_at, NOW()), updated_at = NOW()
        WHERE id = v_req.id;
    END IF;

    PERFORM public.printing_write_audit(
        v_req.id,
        v_item.id,
        v_req.institution_id,
        COALESCE(v_req.assigned_secretary_user_id, v_req.teacher_user_id),
        'file_purged',
        NULL,
        'purged',
        NULL,
        jsonb_build_object('previous_path_present', v_item.storage_object_path IS NOT NULL)
    );

    RETURN jsonb_build_object('ok', true, 'print_item_id', v_item.id);
END;
$$;

REVOKE ALL ON FUNCTION public.printing_mark_item_file_purged(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_mark_item_file_purged(UUID) TO service_role;

-- Allow teacher file replacement while an item is returned for correction (even if claimed).
DROP POLICY IF EXISTS printing_files_teacher_insert ON storage.objects;
CREATE POLICY printing_files_teacher_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'printing-files'
        AND EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = public.printing_request_id_from_storage_path(name)
              AND r.teacher_user_id = auth.uid()
              AND r.status IN ('submitted', 'needs_correction', 'in_progress')
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
              AND (
                  r.assigned_secretary_user_id IS NULL
                  OR EXISTS (
                      SELECT 1
                      FROM public.print_items AS i
                      WHERE i.printing_request_id = r.id
                        AND i.id::text = split_part(name, '/', 3)
                        AND i.status = 'returned_for_correction'
                  )
              )
        )
    );
