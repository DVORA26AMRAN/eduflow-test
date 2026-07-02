-- =============================================================================
-- EduFlow Phase 1B.5A — Notifications Database Foundation
-- =============================================================================
-- User-scoped in-app notifications. INSERT policies are deferred; service role
-- will create notifications in a future phase. Teachers may read and mark as
-- read only their own notifications.

CREATE TABLE public.notifications (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    user_id             UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    notification_type   TEXT        NOT NULL,
    title               TEXT        NOT NULL,
    message             TEXT        NOT NULL,
    is_read             BOOLEAN     NOT NULL DEFAULT FALSE,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT notifications_type_valid CHECK (
        notification_type IN ('REQUEST_STATUS_CHANGED')
    ),
    CONSTRAINT notifications_title_not_blank CHECK (BTRIM(title) <> ''),
    CONSTRAINT notifications_message_not_blank CHECK (BTRIM(message) <> ''),
    CONSTRAINT notifications_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.notifications IS
    'In-app notifications delivered to individual users (Phase 1B.5A).';

CREATE INDEX idx_notifications_user_id
    ON public.notifications (user_id);

CREATE INDEX idx_notifications_institution_id
    ON public.notifications (institution_id);

CREATE INDEX idx_notifications_user_id_is_read
    ON public.notifications (user_id, is_read);

CREATE INDEX idx_notifications_user_id_created_at
    ON public.notifications (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS helper (SECURITY DEFINER avoids recursion with users-table policies)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_is_active_teacher()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = auth.uid()
          AND u.primary_role = 'teacher'
          AND u.status = 'active'
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_teacher() IS
    'Returns true when the authenticated user is an active teacher.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_teacher() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_teacher() TO authenticated;

-- -----------------------------------------------------------------------------
-- Column-level update enforcement
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_notifications_teacher_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.user_id IS DISTINCT FROM auth.uid()
       OR NOT public.auth_user_is_active_teacher()
    THEN
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

COMMENT ON FUNCTION public.enforce_notifications_teacher_update_columns() IS
    'Ensures active teachers can only mutate is_read on their own notifications.';

CREATE TRIGGER notifications_enforce_teacher_update_columns
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_notifications_teacher_update_columns();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

CREATE POLICY notifications_teacher_select_own
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_teacher()
    );

CREATE POLICY notifications_teacher_update_is_read_own
    ON public.notifications
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.auth_user_is_active_teacher()
    )
    WITH CHECK (
        user_id = auth.uid()
        AND public.auth_user_is_active_teacher()
    );
