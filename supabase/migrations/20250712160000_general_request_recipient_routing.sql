-- =============================================================================
-- EduFlow Phase 2D — General Request Recipient Routing
-- =============================================================================
-- Adds general_request type with explicit recipient_role routing.
-- Preserves substitute_teacher for historical rows and the separate substitute board.

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

ALTER TABLE public.requests
    ADD COLUMN IF NOT EXISTS recipient_role TEXT;

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_request_type_valid;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_request_type_valid CHECK (
        request_type IN (
            'absence',
            'budget_or_equipment',
            'substitute_teacher',
            'general_request'
        )
    );

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_recipient_role_valid;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_recipient_role_valid CHECK (
        recipient_role IS NULL
        OR recipient_role IN ('secretary', 'institution_manager')
    );

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_general_request_recipient_required;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_general_request_recipient_required CHECK (
        request_type <> 'general_request'
        OR recipient_role IS NOT NULL
    );

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_non_general_request_recipient_null;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_non_general_request_recipient_null CHECK (
        request_type = 'general_request'
        OR recipient_role IS NULL
    );

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_general_request_description_not_blank;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_general_request_description_not_blank CHECK (
        request_type <> 'general_request'
        OR BTRIM(description) <> ''
    );

ALTER TABLE public.requests
    DROP CONSTRAINT IF EXISTS requests_general_request_message_required;

ALTER TABLE public.requests
    ADD CONSTRAINT requests_general_request_message_required CHECK (
        request_type <> 'general_request'
        OR BTRIM(COALESCE(request_payload ->> 'message', '')) <> ''
    );

COMMENT ON COLUMN public.requests.recipient_role IS
    'Recipient role for general_request only: secretary or institution_manager.';

COMMENT ON COLUMN public.requests.request_type IS
    'Teacher request category including general_request routed by recipient_role.';

-- -----------------------------------------------------------------------------
-- Visibility helper
-- -----------------------------------------------------------------------------

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
                public.auth_user_is_active_institution_manager_for_institution(r.institution_id)
                AND (
                    r.request_type <> 'general_request'
                    OR r.recipient_role = 'institution_manager'
                )
            )
          )
    );
$$;

COMMENT ON FUNCTION public.auth_user_can_read_institution_request(UUID) IS
    'Returns true when the authenticated user may read the given request under recipient routing rules.';

REVOKE ALL ON FUNCTION public.auth_user_can_read_institution_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_can_read_institution_request(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Requests SELECT policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS requests_manager_select_institution ON public.requests;

CREATE POLICY requests_manager_select_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
        AND (
            request_type <> 'general_request'
            OR recipient_role = 'institution_manager'
        )
    );

DROP POLICY IF EXISTS requests_secretary_select_institution ON public.requests;
DROP POLICY IF EXISTS requests_select_secretary_institution ON public.requests;
DROP POLICY IF EXISTS requests_secretary_read_institution ON public.requests;

CREATE POLICY requests_secretary_select_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND (
            request_type <> 'general_request'
            OR recipient_role = 'secretary'
        )
    );

DROP POLICY IF EXISTS requests_secretary_select_archived_institution ON public.requests;

CREATE POLICY requests_secretary_select_archived_institution
    ON public.requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND archived_at IS NOT NULL
        AND (
            request_type <> 'general_request'
            OR recipient_role = 'secretary'
        )
    );

-- -----------------------------------------------------------------------------
-- Teacher INSERT validation for general_request
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_requests_teacher_insert_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.auth_user_is_active_teacher() THEN
        RETURN NEW;
    END IF;

    IF NEW.created_by_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.request_type = 'general_request' THEN
        IF NEW.recipient_role IS NULL
           OR NEW.recipient_role NOT IN ('secretary', 'institution_manager')
        THEN
            RAISE EXCEPTION 'general_request requires a valid recipient_role.'
                USING ERRCODE = '23514';
        END IF;

        IF BTRIM(NEW.description) = '' THEN
            RAISE EXCEPTION 'general_request requires a subject.'
                USING ERRCODE = '23514';
        END IF;

        IF BTRIM(COALESCE(NEW.request_payload ->> 'message', '')) = '' THEN
            RAISE EXCEPTION 'general_request requires a message.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.recipient_role IS NOT NULL THEN
        RAISE EXCEPTION 'recipient_role is only allowed for general_request.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS requests_enforce_teacher_insert_columns ON public.requests;

CREATE TRIGGER requests_enforce_teacher_insert_columns
    BEFORE INSERT ON public.requests
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_requests_teacher_insert_columns();

-- -----------------------------------------------------------------------------
-- Request attachments policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS request_attachments_secretary_select_institution ON public.request_attachments;

CREATE POLICY request_attachments_secretary_select_institution
    ON public.request_attachments
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_can_read_institution_request(request_id)
        AND public.auth_user_is_active_secretary_for_institution(institution_id)
    );

DROP POLICY IF EXISTS request_attachments_manager_select_institution ON public.request_attachments;

CREATE POLICY request_attachments_manager_select_institution
    ON public.request_attachments
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_can_read_institution_request(request_id)
        AND public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

-- -----------------------------------------------------------------------------
-- Storage policies for routed attachment access
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_id_from_attachment_storage_path(p_path TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(split_part(p_path, '/', 2), '')::uuid;
$$;

DROP POLICY IF EXISTS request_attachments_storage_secretary_select ON storage.objects;

CREATE POLICY request_attachments_storage_recipient_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'request-attachments'
        AND (
            public.auth_user_is_active_teacher()
            OR public.auth_user_can_read_institution_request(
                public.request_id_from_attachment_storage_path(name)
            )
        )
    );

-- -----------------------------------------------------------------------------
-- Notifications: new request type
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
    DROP CONSTRAINT notifications_type_valid;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_valid CHECK (
        notification_type IN (
            'REQUEST_STATUS_CHANGED',
            'REQUEST_REMINDER',
            'SUBSTITUTE_BOARD_APPROVED',
            'REQUEST_CREATED'
        )
    );

CREATE OR REPLACE FUNCTION public.create_general_request_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.request_type <> 'general_request' THEN
        RETURN NEW;
    END IF;

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
        'REQUEST_CREATED',
        'בקשה אחרת חדשה',
        format('התקבלה בקשה אחרת: %s', NEW.description),
        jsonb_build_object(
            'request_id', NEW.id,
            'request_type', NEW.request_type,
            'recipient_role', NEW.recipient_role
        )
    FROM public.users AS recipient_user
    WHERE recipient_user.institution_id = NEW.institution_id
      AND recipient_user.status = 'active'
      AND recipient_user.primary_role = NEW.recipient_role;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS requests_create_general_request_notification ON public.requests;

CREATE TRIGGER requests_create_general_request_notification
    AFTER INSERT ON public.requests
    FOR EACH ROW
    EXECUTE FUNCTION public.create_general_request_notification();

-- -----------------------------------------------------------------------------
-- Reminder fan-out respects general_request recipient routing
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
            AND admin_user.primary_role = v_request.recipient_role
        )
        OR (
            v_request.request_type <> 'general_request'
            AND admin_user.primary_role IN ('secretary', 'institution_manager')
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

COMMENT ON FUNCTION public.send_request_reminder(UUID) IS
    'Teacher action: send a reminder; notify only the routed recipient role for general_request.';
