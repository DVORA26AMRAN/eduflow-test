-- =============================================================================
-- EduFlow Phase 1 — Request Conversation (request_messages)
-- =============================================================================
-- Threaded messages on service requests for teacher, secretary, and manager
-- participants authorized via auth_user_can_read_institution_request().
-- Separate from secretary-only request_notes.

CREATE TABLE public.request_messages (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID        NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    author_user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    message             TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT request_messages_message_not_blank CHECK (BTRIM(message) <> '')
);

COMMENT ON TABLE public.request_messages IS
    'Conversation thread messages on service requests (Phase 1).';

CREATE INDEX idx_request_messages_request_id
    ON public.request_messages (request_id);

CREATE INDEX idx_request_messages_institution_id
    ON public.request_messages (institution_id);

CREATE INDEX idx_request_messages_author_user_id
    ON public.request_messages (author_user_id);

CREATE INDEX idx_request_messages_request_id_created_at
    ON public.request_messages (request_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.request_messages_set_institution_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    SELECT r.institution_id
    INTO NEW.institution_id
    FROM public.requests AS r
    WHERE r.id = NEW.request_id;

    IF NEW.institution_id IS NULL THEN
        RAISE EXCEPTION 'Request not found for message.'
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER request_messages_set_institution_id
    BEFORE INSERT ON public.request_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.request_messages_set_institution_id();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.request_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.request_messages TO authenticated;

CREATE POLICY request_messages_select_authorized
    ON public.request_messages
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_can_read_institution_request(request_id)
    );

CREATE POLICY request_messages_insert_authorized
    ON public.request_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        author_user_id = auth.uid()
        AND public.auth_user_can_read_institution_request(request_id)
        AND public.request_belongs_to_institution(request_id, institution_id)
    );

-- -----------------------------------------------------------------------------
-- Notifications for other participants
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
            'REQUEST_MESSAGE_RECEIVED'
        )
    );

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
            recipient_user.primary_role = 'institution_manager'
            AND (
                v_request.request_type <> 'general_request'
                OR v_request.recipient_role = 'institution_manager'
            )
        )
      );

    RETURN NEW;
END;
$$;

CREATE TRIGGER request_messages_create_notification
    AFTER INSERT ON public.request_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.create_request_message_notification();
