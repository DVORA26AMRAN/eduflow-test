-- =============================================================================
-- EduFlow Phase 1B.5B — Automatic Notification Creation
-- =============================================================================
-- When a request status changes, notify the teacher who created the request.
-- Writes run via SECURITY DEFINER so no INSERT policy is required for
-- authenticated users.

CREATE OR REPLACE FUNCTION public.create_request_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_message TEXT;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    v_message := CASE NEW.status
        WHEN 'new' THEN 'סטטוס הבקשה שלך עודכן ל־חדש.'
        WHEN 'in_progress' THEN 'סטטוס הבקשה שלך עודכן ל־בטיפול.'
        WHEN 'completed' THEN 'הבקשה שלך סומנה כהושלמה.'
        WHEN 'rejected' THEN 'הבקשה שלך נדחתה.'
    END;

    INSERT INTO public.notifications (
        institution_id,
        user_id,
        notification_type,
        title,
        message,
        metadata
    ) VALUES (
        NEW.institution_id,
        NEW.created_by_user_id,
        'REQUEST_STATUS_CHANGED',
        'עדכון לבקשה שלך',
        v_message,
        jsonb_build_object(
            'request_id', NEW.id,
            'previous_status', OLD.status,
            'new_status', NEW.status
        )
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_request_status_notification() IS
    'AFTER UPDATE trigger function: notify the request creator when status changes.';

CREATE TRIGGER requests_create_status_notification
    AFTER UPDATE OF status ON public.requests
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE PROCEDURE public.create_request_status_notification();

COMMENT ON TRIGGER requests_create_status_notification ON public.requests IS
    'Automatically creates a teacher notification when request status changes (Phase 1B.5B).';
