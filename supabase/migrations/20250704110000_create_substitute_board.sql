-- =============================================================================
-- EduFlow Phase 2E.1A — Substitute Board Database Foundation
-- =============================================================================
-- Shared institution substitute board visible to teachers, secretaries, and
-- managers. institution_id is denormalized on responses for tenant-scoped reads.
-- DELETE policies are intentionally omitted.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.substitute_board_posts (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id          UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    created_by_user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    post_type               TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'open',
    date                    DATE        NOT NULL,
    start_time              TIME,
    end_time                TIME,
    class_name              TEXT,
    subject                 TEXT,
    description             TEXT,
    selected_teacher_user_id UUID       REFERENCES public.users (id) ON DELETE RESTRICT,
    approved_by_user_id     UUID        REFERENCES public.users (id) ON DELETE RESTRICT,
    approved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT substitute_board_posts_post_type_valid CHECK (
        post_type IN ('looking_for_substitute', 'available_for_substitute')
    ),
    CONSTRAINT substitute_board_posts_status_valid CHECK (
        status IN ('open', 'pending_secretary_approval', 'approved', 'cancelled')
    ),
    CONSTRAINT substitute_board_posts_approval_fields_paired CHECK (
        (approved_by_user_id IS NULL AND approved_at IS NULL)
        OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.substitute_board_posts IS
    'Institution substitute teacher board posts (Phase 2E.1A).';

CREATE INDEX idx_substitute_board_posts_institution_id
    ON public.substitute_board_posts (institution_id);

CREATE INDEX idx_substitute_board_posts_institution_status
    ON public.substitute_board_posts (institution_id, status);

CREATE INDEX idx_substitute_board_posts_institution_date
    ON public.substitute_board_posts (institution_id, date DESC);

CREATE INDEX idx_substitute_board_posts_created_by_user_id
    ON public.substitute_board_posts (created_by_user_id);

CREATE TRIGGER substitute_board_posts_set_updated_at
    BEFORE UPDATE ON public.substitute_board_posts
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

COMMENT ON TRIGGER substitute_board_posts_set_updated_at ON public.substitute_board_posts IS
    'Maintains updated_at when a substitute board post is modified.';

CREATE TABLE public.substitute_board_responses (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID        NOT NULL REFERENCES public.substitute_board_posts (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    teacher_user_id     UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    response_text       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT substitute_board_responses_one_per_teacher_per_post
        UNIQUE (post_id, teacher_user_id)
);

COMMENT ON TABLE public.substitute_board_responses IS
    'Teacher responses to substitute board posts (Phase 2E.1A).';

CREATE INDEX idx_substitute_board_responses_post_id
    ON public.substitute_board_responses (post_id);

CREATE INDEX idx_substitute_board_responses_institution_id
    ON public.substitute_board_responses (institution_id);

CREATE INDEX idx_substitute_board_responses_teacher_user_id
    ON public.substitute_board_responses (teacher_user_id);

-- -----------------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER avoids recursion with users-table policies)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_is_active_teacher_for_institution(
    p_institution_id UUID
)
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
          AND u.institution_id = p_institution_id
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_teacher_for_institution(UUID) IS
    'Returns true when the authenticated user is an active teacher for the given institution.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_teacher_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_teacher_for_institution(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.substitute_board_post_belongs_to_institution(
    p_post_id UUID,
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.substitute_board_posts AS p
        WHERE p.id = p_post_id
          AND p.institution_id = p_institution_id
    );
$$;

COMMENT ON FUNCTION public.substitute_board_post_belongs_to_institution(UUID, UUID) IS
    'Returns true when the given substitute board post belongs to the given institution.';

REVOKE ALL ON FUNCTION public.substitute_board_post_belongs_to_institution(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.substitute_board_post_belongs_to_institution(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Column-level update enforcement
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_substitute_board_posts_teacher_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.created_by_user_id IS DISTINCT FROM auth.uid()
       OR NOT public.auth_user_is_active_teacher_for_institution(OLD.institution_id)
    THEN
        RETURN NEW;
    END IF;

    IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.post_type IS DISTINCT FROM OLD.post_type
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
       OR NEW.class_name IS DISTINCT FROM OLD.class_name
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_substitute_board_posts_teacher_update_columns() IS
    'Ensures post owners may only mutate status and selected_teacher_user_id on their posts.';

CREATE TRIGGER substitute_board_posts_enforce_teacher_update_columns
    BEFORE UPDATE ON public.substitute_board_posts
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_substitute_board_posts_teacher_update_columns();

CREATE OR REPLACE FUNCTION public.enforce_substitute_board_posts_secretary_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.auth_user_is_active_secretary_for_institution(OLD.institution_id) THEN
        RETURN NEW;
    END IF;

    IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.post_type IS DISTINCT FROM OLD.post_type
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
       OR NEW.class_name IS DISTINCT FROM OLD.class_name
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.selected_teacher_user_id IS DISTINCT FROM OLD.selected_teacher_user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id IS DISTINCT FROM auth.uid()
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_substitute_board_posts_secretary_update_columns() IS
    'Ensures secretaries may only mutate status and approval fields on institution posts.';

CREATE TRIGGER substitute_board_posts_enforce_secretary_update_columns
    BEFORE UPDATE ON public.substitute_board_posts
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_substitute_board_posts_secretary_update_columns();

-- -----------------------------------------------------------------------------
-- Row Level Security — substitute_board_posts
-- -----------------------------------------------------------------------------

ALTER TABLE public.substitute_board_posts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.substitute_board_posts TO authenticated;
GRANT UPDATE (status, selected_teacher_user_id) ON public.substitute_board_posts TO authenticated;
GRANT UPDATE (status, approved_by_user_id, approved_at) ON public.substitute_board_posts TO authenticated;

CREATE POLICY substitute_board_posts_teacher_select_institution
    ON public.substitute_board_posts
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_teacher_for_institution(institution_id)
    );

CREATE POLICY substitute_board_posts_secretary_select_institution
    ON public.substitute_board_posts
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY substitute_board_posts_manager_select_institution
    ON public.substitute_board_posts
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

CREATE POLICY substitute_board_posts_teacher_insert_own
    ON public.substitute_board_posts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_for_institution(institution_id)
    );

CREATE POLICY substitute_board_posts_teacher_update_own
    ON public.substitute_board_posts
    FOR UPDATE
    TO authenticated
    USING (
        created_by_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_for_institution(institution_id)
    )
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_for_institution(institution_id)
    );

CREATE POLICY substitute_board_posts_secretary_update_institution
    ON public.substitute_board_posts
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    )
    WITH CHECK (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND (
            approved_by_user_id IS NULL
            OR approved_by_user_id = auth.uid()
        )
    );

-- -----------------------------------------------------------------------------
-- Row Level Security — substitute_board_responses
-- -----------------------------------------------------------------------------

ALTER TABLE public.substitute_board_responses ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.substitute_board_responses TO authenticated;

CREATE POLICY substitute_board_responses_teacher_select_institution
    ON public.substitute_board_responses
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_teacher_for_institution(institution_id)
    );

CREATE POLICY substitute_board_responses_secretary_select_institution
    ON public.substitute_board_responses
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY substitute_board_responses_manager_select_institution
    ON public.substitute_board_responses
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

CREATE POLICY substitute_board_responses_teacher_insert_own
    ON public.substitute_board_responses
    FOR INSERT
    TO authenticated
    WITH CHECK (
        teacher_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_for_institution(institution_id)
        AND public.substitute_board_post_belongs_to_institution(post_id, institution_id)
    );
