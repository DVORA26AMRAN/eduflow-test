-- =============================================================================
-- MPEX D2 — Deputy operational dashboard authorization
-- =============================================================================
-- Forward-only. Depends on D1:
--   20250818100000 deputy enum
--   20250818101000 auth_user_is_active_institution_operator_for_institution
--
-- Does NOT edit applied migrations.
-- Does NOT broaden auth_user_is_active_institution_manager_for_institution.
-- Does NOT add deputy to general_request recipient_role.
-- Does NOT implement D3 user management (invite/edit/disable).
-- Does NOT change printing_update_institution_settings (secretary OR manager only).
-- Does NOT touch school-registration / quotation / Platform Admin paths.
--
-- Authorization tables are documented in the D2 architecture review.
-- Pattern: where Manager currently means institution operational administrator,
-- replace that check with auth_user_is_active_institution_operator_for_institution.
--
-- Security correction (pre-apply): Manager/Deputy request status writes go
-- through public.update_request_status (SECURITY DEFINER). D2 must not add a
-- broad requests FOR UPDATE policy, GRANT UPDATE(status), or a column denylist
-- trigger. Secretary keeps the pre-existing table UPDATE path.
--
-- PRE-EXISTING SECURITY DEBT (out of D2 scope; do not broaden here):
-- Policy users_read_same_institution (20250614010000) allows same-institution
-- SELECT on public.users. If authenticated may SELECT users.national_id,
-- tenant users may read it outside staff RPCs. D2 does not alter users RLS
-- and creates no new Deputy table path to national_id. Deputy staff-details
-- RPC redacts national_id. Review separately.

-- -----------------------------------------------------------------------------
-- Requests SELECT — operational inbox/archive visibility
-- BEFORE: active institution_manager, same institution, fail-closed
--         general_request only when recipient_role = institution_manager
-- AFTER:  active institution_manager OR deputy, same institution, fail-closed
--         general_request routing unchanged (still manager-recipient only)
-- Secretary / Teacher / Platform Admin: unchanged
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS requests_manager_select_institution ON public.requests;
CREATE POLICY requests_manager_select_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_operator_for_institution(institution_id)
        AND (
            request_type <> 'general_request'
            OR recipient_role = 'institution_manager'
        )
    );

CREATE OR REPLACE FUNCTION public.auth_user_can_read_institution_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.requests AS r
        WHERE r.id = p_request_id
          AND (
            (
                r.created_by_user_id = auth.uid()
                AND public.auth_user_is_active_teacher()
            )
            OR (
                public.auth_user_is_active_secretary_for_institution(r.institution_id)
                AND (
                    r.request_type <> 'general_request'
                    OR r.recipient_role = 'secretary'
                )
            )
            OR (
                public.auth_user_is_active_institution_operator_for_institution(r.institution_id)
                AND (
                    r.request_type <> 'general_request'
                    OR r.recipient_role = 'institution_manager'
                )
            )
          )
    );
$$;

COMMENT ON FUNCTION public.auth_user_can_read_institution_request(UUID) IS
    'D2: teacher own, secretary routed, or institution operator (manager/deputy) routed reads.';

-- -----------------------------------------------------------------------------
-- Request status — Manager/Deputy SECURITY DEFINER RPC only
-- Product statuses (existing UI, no directed FSM in tracked code):
--   new | in_progress | completed | rejected
-- Secretary and Manager/Deputy dropdowns list all four options from any current
-- status. This RPC validates membership in that set and does not invent a new
-- directed workflow.
--
-- BEFORE: no operator/manager status UPDATE policy in tracked migrations
-- AFTER:  update_request_status(p_request_id, p_status) only; SET status only
-- Secretary table UPDATE (requests_secretary_archive_institution) is untouched.
-- Teacher / Platform Admin: fail closed.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS requests_operator_update_status_institution ON public.requests;
DROP TRIGGER IF EXISTS requests_enforce_operator_update_columns ON public.requests;
DROP FUNCTION IF EXISTS public.enforce_requests_operator_update_columns();

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
    v_request public.requests%ROWTYPE;
    v_status TEXT;
BEGIN
    IF auth.uid() IS NULL OR p_request_id IS NULL THEN
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

    IF NOT public.auth_user_is_active_institution_operator_for_institution(
        v_request.institution_id
    ) THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.request_type = 'general_request'
       AND v_request.recipient_role IS DISTINCT FROM 'institution_manager' THEN
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
    WHERE id = v_request.id;

    RETURN jsonb_build_object(
        'ok', true,
        'status', v_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_request_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_request_status(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.update_request_status(UUID, TEXT) IS
    'D2: active institution_manager or deputy sets requests.status only for a visible, same-institution request. Secretary/Teacher/Platform Admin denied. Existing AFTER UPDATE OF status triggers still fire.';

-- -----------------------------------------------------------------------------
-- Attachments / history / reminders / notifications
-- BEFORE: manager helper
-- AFTER:  operator helper
-- Secretary / Teacher: unchanged
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS request_attachments_manager_select_institution ON public.request_attachments;
CREATE POLICY request_attachments_manager_select_institution
    ON public.request_attachments
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_can_read_institution_request(request_id)
        AND public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS request_status_history_operator_select_institution ON public.request_status_history;
CREATE POLICY request_status_history_operator_select_institution
    ON public.request_status_history
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS request_reminders_manager_select_institution ON public.request_reminders;
CREATE POLICY request_reminders_manager_select_institution
    ON public.request_reminders
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS notifications_manager_select_own ON public.notifications;
CREATE POLICY notifications_manager_select_own
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS notifications_manager_update_is_read_own ON public.notifications;
CREATE POLICY notifications_manager_update_is_read_own
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_operator_for_institution(institution_id)
    )
    WITH CHECK (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

-- -----------------------------------------------------------------------------
-- Personal archive (Manager archive UI reused by Deputy)
-- BEFORE: INSERT requires primary_role = institution_manager
-- AFTER:  INSERT requires operator helper (manager or deputy), still own user_id
-- SELECT remains manager_user_id = auth.uid() (per-user rows; no cross-user)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS manager_archived_requests_insert_own_institution ON public.manager_archived_requests;
CREATE POLICY manager_archived_requests_insert_own_institution
    ON public.manager_archived_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        manager_user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.users AS operator_user
            INNER JOIN public.requests AS request_row
                ON request_row.institution_id = operator_user.institution_id
            WHERE operator_user.id = auth.uid()
              AND public.auth_user_is_active_institution_operator_for_institution(
                  operator_user.institution_id
              )
              AND request_row.id = request_id
        )
    );

-- -----------------------------------------------------------------------------
-- Reminder fan-out — operational administrators
-- BEFORE: non-general → secretary + institution_manager
--         general_request → exact recipient_role only
-- AFTER:  non-general → secretary + institution_manager + deputy
--         general_request → exact recipient_role, plus deputy when routed to manager
-- Teacher routing / recipient_role enum: unchanged (no deputy recipient)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_request_reminder(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request           public.requests%ROWTYPE;
    v_reminder_number   INTEGER;
    v_last_reminder_at  TIMESTAMPTZ;
    v_cooldown_hours    INTEGER;
    v_next_available_at TIMESTAMPTZ;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.auth_user_is_active_teacher() THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_request
    FROM public.requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_request.created_by_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_request.status NOT IN ('new', 'in_progress') THEN
        RAISE EXCEPTION 'Reminders are only allowed for new or in-progress requests.'
            USING ERRCODE = 'P0001';
    END IF;

    v_cooldown_hours := public.get_request_reminder_cooldown_hours();

    SELECT created_at
    INTO v_last_reminder_at
    FROM public.request_reminders
    WHERE request_id = p_request_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_reminder_at IS NOT NULL
       AND v_last_reminder_at > (NOW() - make_interval(hours => v_cooldown_hours))
    THEN
        v_next_available_at := v_last_reminder_at + make_interval(hours => v_cooldown_hours);

        RETURN jsonb_build_object(
            'ok', false,
            'error_code', 'cooldown_active',
            'next_available_at', v_next_available_at
        );
    END IF;

    SELECT COALESCE(MAX(reminder_number), 0) + 1
    INTO v_reminder_number
    FROM public.request_reminders
    WHERE request_id = p_request_id;

    INSERT INTO public.request_reminders (
        request_id,
        institution_id,
        reminded_by_user_id,
        reminder_number
    ) VALUES (
        p_request_id,
        v_request.institution_id,
        auth.uid(),
        v_reminder_number
    );

    INSERT INTO public.notifications (
        institution_id,
        user_id,
        notification_type,
        title,
        message,
        metadata
    )
    SELECT
        v_request.institution_id,
        admin_user.id,
        'REQUEST_REMINDER',
        'תזכורת על בקשה',
        format(
            'מורה שלח תזכורת על בקשה (תזכורת מספר %s).',
            v_reminder_number
        ),
        jsonb_build_object(
            'request_id', p_request_id,
            'reminder_count', v_reminder_number,
            'reminded_by_user_id', auth.uid(),
            'latest_reminder_at', NOW()
        )
    FROM public.users AS admin_user
    WHERE admin_user.institution_id = v_request.institution_id
      AND admin_user.status = 'active'
      AND (
        (
            v_request.request_type = 'general_request'
            AND (
                admin_user.primary_role = v_request.recipient_role::public.user_role
                OR (
                    v_request.recipient_role = 'institution_manager'
                    AND admin_user.primary_role = 'deputy'::public.user_role
                )
            )
        )
        OR (
            v_request.request_type <> 'general_request'
            AND admin_user.primary_role IN (
                'secretary'::public.user_role,
                'institution_manager'::public.user_role,
                'deputy'::public.user_role
            )
        )
      );

    INSERT INTO public.audit_logs (
        institution_id,
        actor_user_id,
        action_type,
        entity_type,
        entity_id,
        metadata,
        created_at
    ) VALUES (
        v_request.institution_id,
        auth.uid(),
        'request_reminder_sent',
        'request',
        p_request_id,
        jsonb_build_object(
            'action', 'request_reminder_sent',
            'request_id', p_request_id,
            'reminded_by_user_id', auth.uid(),
            'reminder_count', v_reminder_number,
            'created_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'ok', true,
        'reminder_count', v_reminder_number,
        'created_at', NOW()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_request_message_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request public.requests%ROWTYPE;
    v_author_name TEXT;
BEGIN
    SELECT *
    INTO v_request
    FROM public.requests
    WHERE id = NEW.request_id;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT u.full_name
    INTO v_author_name
    FROM public.users AS u
    WHERE u.id = NEW.author_user_id;

    INSERT INTO public.notifications (
        institution_id,
        user_id,
        notification_type,
        title,
        message,
        metadata
    )
    SELECT
        NEW.institution_id,
        recipient_user.id,
        'REQUEST_MESSAGE_RECEIVED',
        'הודעה חדשה בבקשה',
        format(
            'התקבלה הודעה חדשה בבקשה "%s" מ-%s',
            v_request.description,
            COALESCE(v_author_name, 'משתמש')
        ),
        jsonb_build_object(
            'request_id', NEW.request_id,
            'message_id', NEW.id,
            'author_user_id', NEW.author_user_id
        )
    FROM public.users AS recipient_user
    WHERE recipient_user.institution_id = NEW.institution_id
      AND recipient_user.status = 'active'
      AND recipient_user.id <> NEW.author_user_id
      AND (
        recipient_user.id = v_request.created_by_user_id
        OR (
            recipient_user.primary_role = 'secretary'
            AND (
                v_request.request_type <> 'general_request'
                OR v_request.recipient_role = 'secretary'
            )
        )
        OR (
            recipient_user.primary_role IN ('institution_manager', 'deputy')
            AND (
                v_request.request_type <> 'general_request'
                OR v_request.recipient_role = 'institution_manager'
            )
        )
      );

    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Calendar role pairs — Deputy is Manager-equivalent operationally
-- BEFORE: teacher/secretary/manager pairs only
-- AFTER:  deputy pairs with teacher and secretary; not with manager; not same-role
-- Platform Admin: still denied
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_validate_role_pair(
    p_requester_role TEXT,
    p_recipient_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_requester_role = p_recipient_role THEN
        RETURN FALSE;
    END IF;

    IF p_requester_role = 'platform_admin' OR p_recipient_role = 'platform_admin' THEN
        RETURN FALSE;
    END IF;

    IF p_requester_role = 'teacher'
       AND p_recipient_role IN ('secretary', 'institution_manager', 'deputy') THEN
        RETURN TRUE;
    END IF;

    IF p_requester_role = 'secretary'
       AND p_recipient_role IN ('teacher', 'institution_manager', 'deputy') THEN
        RETURN TRUE;
    END IF;

    IF p_requester_role = 'institution_manager'
       AND p_recipient_role IN ('teacher', 'secretary') THEN
        RETURN TRUE;
    END IF;

    IF p_requester_role = 'deputy'
       AND p_recipient_role IN ('teacher', 'secretary') THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_calendar_resolve_calendar_owner_user_id(
    p_requester_id UUID,
    p_recipient_id UUID,
    p_requester_role TEXT,
    p_recipient_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_requester_role IN ('institution_manager', 'deputy')
       OR p_recipient_role IN ('institution_manager', 'deputy') THEN
        IF p_requester_role IN ('institution_manager', 'deputy') THEN
            RETURN p_requester_id;
        END IF;
        RETURN p_recipient_id;
    END IF;

    IF p_requester_role = 'secretary' OR p_recipient_role = 'secretary' THEN
        IF p_requester_role = 'secretary' THEN
            RETURN p_requester_id;
        END IF;
        RETURN p_recipient_id;
    END IF;

    RAISE EXCEPTION 'Unsupported participant combination.'
        USING ERRCODE = 'P0001';
END;
$$;

-- -----------------------------------------------------------------------------
-- Personal Google OAuth — Deputy is a personal integration user
-- BEFORE: institution_manager, secretary
-- AFTER:  institution_manager, secretary, deputy
-- Teacher / Platform Admin: still denied
-- This is NOT institution settings.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_oauth_actor()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_institution_id UUID;
    v_role TEXT;
    v_status TEXT;
    v_email TEXT;
BEGIN
    SELECT u.id, u.institution_id, u.primary_role::TEXT, u.status::TEXT, u.email
    INTO v_id, v_institution_id, v_role, v_status, v_email
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_role NOT IN ('institution_manager', 'secretary', 'deputy') THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_id,
        'institution_id', v_institution_id,
        'primary_role', v_role,
        'email', v_email
    );
END;
$$;

COMMENT ON FUNCTION public.meeting_calendar_get_google_oauth_actor() IS
    'D2: active manager/secretary/deputy personal Google OAuth actor. Teachers denied.';

-- -----------------------------------------------------------------------------
-- Operational printing RLS
-- BEFORE: secretary OR manager helper
-- AFTER:  secretary OR operator helper
-- Settings RPC printing_update_institution_settings is intentionally untouched.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS printing_requests_staff_select_institution ON public.printing_requests;
CREATE POLICY printing_requests_staff_select_institution
    ON public.printing_requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS print_items_staff_select_institution ON public.print_items;
CREATE POLICY print_items_staff_select_institution
    ON public.print_items
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS printing_audit_staff_select_institution ON public.printing_request_audit_events;
CREATE POLICY printing_audit_staff_select_institution
    ON public.printing_request_audit_events
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_operator_for_institution(institution_id)
    );

DROP POLICY IF EXISTS printing_files_staff_select ON storage.objects;
CREATE POLICY printing_files_staff_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'printing-files'
        AND EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = public.printing_request_id_from_storage_path(name)
              AND r.institution_id = public.printing_institution_id_from_storage_path(name)
              AND (
                  public.auth_user_is_active_secretary_for_institution(r.institution_id)
                  OR public.auth_user_is_active_institution_operator_for_institution(r.institution_id)
              )
        )
    );

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
       AND NOT public.auth_user_is_active_institution_operator_for_institution(p_req.institution_id)
    THEN
        RETURN 'SECRETARY_NOT_AUTHORIZED';
    END IF;

    IF p_req.assigned_secretary_user_id IS NULL THEN
        RETURN 'PRINT_REQUEST_LOCKED';
    END IF;

    IF p_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_operator_for_institution(p_req.institution_id)
    THEN
        RETURN 'SECRETARY_NOT_AUTHORIZED';
    END IF;

    RETURN NULL;
END;
$$;

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
       AND NOT public.auth_user_is_active_institution_operator_for_institution(v_req.institution_id)
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
       AND NOT public.auth_user_is_active_institution_operator_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_req.assigned_secretary_user_id IS NULL THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF v_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_operator_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    v_prev := v_req.status;

    UPDATE public.printing_requests
    SET
        assigned_secretary_user_id = NULL,
        updated_at = NOW()
    WHERE id = v_req.id;

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
       AND NOT public.auth_user_is_active_institution_operator_for_institution(v_req.institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    IF v_req.assigned_secretary_user_id IS NULL THEN
        RETURN public.printing_fail('INVALID_STATUS_TRANSITION');
    END IF;

    IF v_req.assigned_secretary_user_id IS DISTINCT FROM v_actor
       AND NOT public.auth_user_is_active_institution_operator_for_institution(v_req.institution_id)
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

-- -----------------------------------------------------------------------------
-- Staff directory READ (operational visibility on reused Manager dashboard)
-- BEFORE: institution_manager, secretary
-- AFTER:  institution_manager, secretary, deputy
-- update_staff_member / manager_set_user_extended_profile remain D3 (no deputy)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_staff_directory()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    weekly_hours NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_caller
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF NOT FOUND
        OR v_caller.status <> 'active'
        OR v_caller.institution_id IS NULL
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        t.id::UUID,
        t.full_name::TEXT,
        t.email::TEXT,
        t.phone::TEXT,
        t.job_title::TEXT,
        t.weekly_hours::NUMERIC,
        t.status::TEXT,
        t.created_at::TIMESTAMPTZ
    FROM public.users AS t
    WHERE t.institution_id = v_caller.institution_id
      AND t.primary_role = 'teacher'
    ORDER BY t.full_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_member_details(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    weekly_hours NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ,
    national_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_target public.users%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_caller
    FROM public.users AS u
    WHERE u.id = auth.uid();

    IF NOT FOUND
        OR v_caller.status <> 'active'
        OR v_caller.institution_id IS NULL
        OR v_caller.primary_role NOT IN ('institution_manager', 'secretary', 'deputy')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target
    FROM public.users AS t
    WHERE t.id = p_user_id;

    IF NOT FOUND
        OR v_target.institution_id IS DISTINCT FROM v_caller.institution_id
        OR v_target.primary_role <> 'teacher'
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        v_target.id::UUID,
        v_target.full_name::TEXT,
        v_target.email::TEXT,
        v_target.phone::TEXT,
        v_target.job_title::TEXT,
        v_target.weekly_hours::NUMERIC,
        v_target.status::TEXT,
        v_target.created_at::TIMESTAMPTZ,
        CASE
            WHEN v_caller.primary_role IN (
                'institution_manager'::public.user_role,
                'secretary'::public.user_role
            )
            THEN v_target.national_id::TEXT
            ELSE NULL
        END;
END;
$$;

COMMENT ON FUNCTION public.get_staff_member_details(UUID) IS
    'D2: manager/secretary/deputy teacher details. national_id for manager and secretary only; deputy receives NULL.';

-- D2 does not replace:
--   printing_update_institution_settings (secretary OR manager; Deputy denied)
--   update_staff_member / manager_set_user_extended_profile (D3)
--   clever-processor invite matrix (D3)
--   requests_recipient_role_valid (no deputy)
--   auth_user_is_active_institution_manager_for_institution (Manager-only)
--   users_read_same_institution / other users-table RLS (pre-existing PII debt)
