-- =============================================================================
-- EduFlow Phase 2D — Fix general_request recipient_role type mismatch
-- =============================================================================
-- public.users.primary_role is type public.user_role (enum).
-- public.requests.recipient_role is TEXT.
-- Comparing enum = text fails with SQLSTATE 42883.
--
-- Affected objects from 20250712160000_general_request_recipient_routing.sql:
--   1. create_general_request_notification() — recipient_user.primary_role = NEW.recipient_role
--   2. send_request_reminder() — admin_user.primary_role = v_request.recipient_role
--
-- RLS policies and auth_user_can_read_institution_request() compare recipient_role
-- to text literals only and are unaffected.

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
      AND recipient_user.primary_role = NEW.recipient_role::public.user_role;

    RETURN NEW;
END;
$$;

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
            AND admin_user.primary_role = v_request.recipient_role::public.user_role
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
