-- =============================================================================
-- EduFlow Phase 2C.1 — Request Reminder Bell
-- =============================================================================
-- Teachers may send reminders on pending requests. Reminders are audited,
-- rate-limited, and fan out as in-app notifications to secretaries and
-- institution managers.

-- -----------------------------------------------------------------------------
-- Reminder audit table
-- -----------------------------------------------------------------------------

CREATE TABLE public.request_reminders (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID        NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    reminded_by_user_id UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    reminder_number     INTEGER     NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT request_reminders_reminder_number_positive CHECK (reminder_number > 0)
);

COMMENT ON TABLE public.request_reminders IS
    'Append-only audit trail of teacher reminders on pending service requests.';

CREATE INDEX idx_request_reminders_request_id
    ON public.request_reminders (request_id);

CREATE INDEX idx_request_reminders_institution_id_created_at
    ON public.request_reminders (institution_id, created_at DESC);

CREATE INDEX idx_request_reminders_request_id_created_at
    ON public.request_reminders (request_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Configurable cooldown (default 24 hours)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_request_reminder_cooldown_hours()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT 24;
$$;

COMMENT ON FUNCTION public.get_request_reminder_cooldown_hours() IS
    'Cooldown between reminders for the same request, in hours. Update this function to change the default.';

REVOKE ALL ON FUNCTION public.get_request_reminder_cooldown_hours() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_request_reminder_cooldown_hours() TO authenticated;

-- -----------------------------------------------------------------------------
-- Send reminder (SECURITY DEFINER)
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

    IF v_request.status IS DISTINCT FROM 'new' THEN
        RAISE EXCEPTION 'Reminders are only allowed for pending requests.'
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
            'מורה שלח תזכורת על בקשה ממתינה (תזכורת מספר %s).',
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
      AND admin_user.primary_role IN ('secretary', 'institution_manager');

    INSERT INTO public.audit_logs (
        institution_id,
        user_id,
        action,
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
    'Teacher action: send a reminder for a pending request and notify institution administrators.';

REVOKE ALL ON FUNCTION public.send_request_reminder(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_request_reminder(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Notifications: expand allowed types
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
    DROP CONSTRAINT notifications_type_valid;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_valid CHECK (
        notification_type IN (
            'REQUEST_STATUS_CHANGED',
            'REQUEST_REMINDER',
            'SUBSTITUTE_BOARD_APPROVED'
        )
    );

-- -----------------------------------------------------------------------------
-- Notifications: generic is_read enforcement for all recipients
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS notifications_enforce_teacher_update_columns ON public.notifications;

CREATE OR REPLACE FUNCTION public.enforce_notifications_recipient_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
        RETURN NEW;
    END IF;

    IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.message IS DISTINCT FROM OLD.message
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_enforce_recipient_update_columns
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_notifications_recipient_update_columns();

-- -----------------------------------------------------------------------------
-- Notifications: secretary and manager policies
-- -----------------------------------------------------------------------------

CREATE POLICY notifications_secretary_select_own
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY notifications_secretary_update_is_read_own
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_secretary_for_institution(institution_id)
    )
    WITH CHECK (
        user_id = auth.uid()
        AND public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY notifications_manager_select_own
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

CREATE POLICY notifications_manager_update_is_read_own
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_manager_for_institution(institution_id)
    )
    WITH CHECK (
        user_id = auth.uid()
        AND public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

-- -----------------------------------------------------------------------------
-- request_reminders RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.request_reminders ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.request_reminders TO authenticated;

CREATE POLICY request_reminders_teacher_select_own_requests
    ON public.request_reminders
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_teacher()
        AND EXISTS (
            SELECT 1
            FROM public.requests AS request_row
            WHERE request_row.id = request_id
              AND request_row.created_by_user_id = auth.uid()
        )
    );

CREATE POLICY request_reminders_secretary_select_institution
    ON public.request_reminders
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY request_reminders_manager_select_institution
    ON public.request_reminders
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );
