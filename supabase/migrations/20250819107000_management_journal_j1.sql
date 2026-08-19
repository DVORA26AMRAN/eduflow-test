-- =============================================================================
-- EduFlow J1 — Management Daily Journal database foundation
-- =============================================================================
-- Forward-only. Separate domain from requests, meetings, printing, quotations.
-- Does NOT apply until architecture review.
-- Does NOT touch Phase 3 / school-registration / quotation PDF.
-- Does NOT broaden public.users ACL or users RLS.
-- Does NOT modify R1–R2 / S2–S4 request ownership or staff lifecycle.
-- Does NOT generate reports, notifications, or frontend.
--
-- Timezone contract: journal_date is a calendar DATE in Asia/Jerusalem.
-- Authoritative today: management_journal_current_date()
--   = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date
-- Public create RPCs take NO client date. They open/create today's page only.
-- Dated internal helpers exist for implementation/testing and are NOT granted
-- to authenticated.
--
-- Page types:
--   shared  — at most one per (institution_id, journal_date)
--             create: active manager or deputy; creator always participant;
--             participants append-only
--   personal — at most one per (owner_user_id, journal_date)
--             owner-only; no Manager override; no extra participants
--
-- Historical freeze: a page is writable only if it is the latest in its stream
-- (shared: institution; personal: owner). Newer page => older read-only.
--
-- Carry-forward: copy-on-carry of new/in_progress/blocked from the most recent
-- prior page in the same stream (not necessarily yesterday).

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.management_journal_pages (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id       UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    journal_date         DATE NOT NULL,
    page_type            TEXT NOT NULL,
    owner_user_id        UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_by_user_id   UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT management_journal_pages_type_valid
        CHECK (page_type IN ('shared', 'personal')),
    CONSTRAINT management_journal_pages_personal_owner_is_creator
        CHECK (
            page_type <> 'personal'
            OR owner_user_id = created_by_user_id
        )
);

COMMENT ON TABLE public.management_journal_pages IS
    'J1 Management Daily Journal pages. Shared vs personal streams. journal_date is Asia/Jerusalem calendar DATE.';

CREATE UNIQUE INDEX management_journal_pages_one_shared_per_institution_date
    ON public.management_journal_pages (institution_id, journal_date)
    WHERE page_type = 'shared';

CREATE UNIQUE INDEX management_journal_pages_one_personal_per_owner_date
    ON public.management_journal_pages (institution_id, owner_user_id, journal_date)
    WHERE page_type = 'personal';

CREATE INDEX management_journal_pages_institution_type_date
    ON public.management_journal_pages (institution_id, page_type, journal_date DESC);

CREATE INDEX management_journal_pages_owner_date
    ON public.management_journal_pages (owner_user_id, journal_date DESC);

CREATE TABLE public.management_journal_page_participants (
    page_id            UUID NOT NULL REFERENCES public.management_journal_pages (id) ON DELETE RESTRICT,
    user_id            UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    added_by_user_id   UUID REFERENCES public.users (id) ON DELETE RESTRICT,
    added_automatically BOOLEAN NOT NULL DEFAULT FALSE,
    added_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (page_id, user_id)
);

COMMENT ON TABLE public.management_journal_page_participants IS
    'J1 shared-page membership. Append-only. No DELETE grant. Personal pages do not use extra participants.';

CREATE INDEX management_journal_page_participants_user_id
    ON public.management_journal_page_participants (user_id);

CREATE TABLE public.management_journal_tasks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id                 UUID NOT NULL REFERENCES public.management_journal_pages (id) ON DELETE RESTRICT,
    institution_id          UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    title                   TEXT NOT NULL,
    details                 TEXT,
    note                    TEXT,
    target_time             TIME,
    responsible_user_id     UUID REFERENCES public.users (id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL,
    sort_order              INTEGER NOT NULL,
    created_by_user_id      UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origin_task_id          UUID REFERENCES public.management_journal_tasks (id) ON DELETE RESTRICT,
    origin_page_id          UUID REFERENCES public.management_journal_pages (id) ON DELETE RESTRICT,
    carried_forward         BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT management_journal_tasks_title_not_blank
        CHECK (btrim(title) <> ''),
    CONSTRAINT management_journal_tasks_status_valid
        CHECK (status IN ('new', 'in_progress', 'completed', 'blocked')),
    CONSTRAINT management_journal_tasks_carry_shape
        CHECK (
            (
                carried_forward = FALSE
                AND origin_task_id IS NULL
                AND origin_page_id IS NULL
                AND responsible_user_id IS NOT NULL
            )
            OR (
                carried_forward = TRUE
                AND origin_task_id IS NOT NULL
                AND origin_page_id IS NOT NULL
            )
        )
);

COMMENT ON TABLE public.management_journal_tasks IS
    'J1 journal tasks. Copy-on-carry. responsible_user_id nullable only for carried tasks whose prior assignee is inactive/ineligible.';

CREATE UNIQUE INDEX management_journal_tasks_one_origin_per_page
    ON public.management_journal_tasks (page_id, origin_task_id)
    WHERE origin_task_id IS NOT NULL;

CREATE INDEX management_journal_tasks_page_sort
    ON public.management_journal_tasks (page_id, sort_order, id);

CREATE INDEX management_journal_tasks_page_status
    ON public.management_journal_tasks (page_id, status);

CREATE INDEX management_journal_tasks_responsible
    ON public.management_journal_tasks (responsible_user_id);

CREATE TABLE public.management_journal_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id   UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    page_id          UUID NOT NULL REFERENCES public.management_journal_pages (id) ON DELETE RESTRICT,
    task_id          UUID REFERENCES public.management_journal_tasks (id) ON DELETE RESTRICT,
    actor_user_id    UUID REFERENCES public.users (id) ON DELETE RESTRICT,
    event_type       TEXT NOT NULL,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT management_journal_events_type_valid
        CHECK (event_type IN (
            'page_created',
            'participant_added',
            'participant_added_automatic',
            'task_created',
            'task_content_edited',
            'task_assigned',
            'task_status_changed',
            'task_note_changed',
            'task_carried_forward'
        ))
);

COMMENT ON TABLE public.management_journal_events IS
    'J1 append-only journal domain history. Membership-scoped SELECT. Writer is internal SECURITY DEFINER only.';

CREATE INDEX management_journal_events_page_created
    ON public.management_journal_events (page_id, created_at DESC);

CREATE INDEX management_journal_events_task_created
    ON public.management_journal_events (task_id, created_at DESC)
    WHERE task_id IS NOT NULL;

-- updated_at: inline trigger function (does not depend on a global set_updated_at name).
CREATE OR REPLACE FUNCTION public.management_journal_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_set_updated_at() FROM authenticated;

CREATE TRIGGER management_journal_pages_set_updated_at
    BEFORE UPDATE ON public.management_journal_pages
    FOR EACH ROW
    EXECUTE PROCEDURE public.management_journal_set_updated_at();

CREATE TRIGGER management_journal_tasks_set_updated_at
    BEFORE UPDATE ON public.management_journal_tasks
    FOR EACH ROW
    EXECUTE PROCEDURE public.management_journal_set_updated_at();

-- -----------------------------------------------------------------------------
-- Grants / RLS (SELECT-only for authenticated; mutations via RPC)
-- -----------------------------------------------------------------------------

ALTER TABLE public.management_journal_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_journal_page_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_journal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_journal_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.management_journal_pages FROM PUBLIC;
REVOKE ALL ON TABLE public.management_journal_pages FROM anon;
REVOKE ALL ON TABLE public.management_journal_pages FROM authenticated;
REVOKE ALL ON TABLE public.management_journal_page_participants FROM PUBLIC;
REVOKE ALL ON TABLE public.management_journal_page_participants FROM anon;
REVOKE ALL ON TABLE public.management_journal_page_participants FROM authenticated;
REVOKE ALL ON TABLE public.management_journal_tasks FROM PUBLIC;
REVOKE ALL ON TABLE public.management_journal_tasks FROM anon;
REVOKE ALL ON TABLE public.management_journal_tasks FROM authenticated;
REVOKE ALL ON TABLE public.management_journal_events FROM PUBLIC;
REVOKE ALL ON TABLE public.management_journal_events FROM anon;
REVOKE ALL ON TABLE public.management_journal_events FROM authenticated;

GRANT SELECT ON TABLE public.management_journal_pages TO authenticated;
GRANT SELECT ON TABLE public.management_journal_page_participants TO authenticated;
GRANT SELECT ON TABLE public.management_journal_tasks TO authenticated;
GRANT SELECT ON TABLE public.management_journal_events TO authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.management_journal_current_date()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date;
$$;

COMMENT ON FUNCTION public.management_journal_current_date() IS
    'J1: Asia/Jerusalem calendar date. Do not use browser-local midnight as journal_date.';

CREATE OR REPLACE FUNCTION public.management_journal_is_management_role(
    p_role public.user_role
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_role IN (
        'institution_manager'::public.user_role,
        'deputy'::public.user_role,
        'secretary'::public.user_role
    );
$$;

CREATE OR REPLACE FUNCTION public.management_journal_can_assign(
    p_actor_role public.user_role,
    p_actor_user_id UUID,
    p_target_role public.user_role,
    p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
    IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_actor_role = 'institution_manager'::public.user_role THEN
        IF p_target_user_id = p_actor_user_id THEN
            RETURN TRUE;
        END IF;
        RETURN p_target_role IN (
            'deputy'::public.user_role,
            'secretary'::public.user_role
        );
    END IF;

    IF p_actor_role = 'deputy'::public.user_role THEN
        IF p_target_user_id = p_actor_user_id THEN
            RETURN TRUE;
        END IF;
        RETURN p_target_role = 'secretary'::public.user_role;
    END IF;

    IF p_actor_role = 'secretary'::public.user_role THEN
        RETURN p_target_user_id = p_actor_user_id
           AND p_target_role = 'secretary'::public.user_role;
    END IF;

    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.management_journal_history_write(
    p_institution_id UUID,
    p_page_id UUID,
    p_task_id UUID,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_metadata JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_institution_id IS NULL OR p_page_id IS NULL OR p_event_type IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.management_journal_events (
        institution_id,
        page_id,
        task_id,
        actor_user_id,
        event_type,
        metadata,
        created_at
    )
    VALUES (
        p_institution_id,
        p_page_id,
        p_task_id,
        p_actor_user_id,
        p_event_type,
        COALESCE(p_metadata, '{}'::jsonb),
        NOW()
    );
END;
$$;

COMMENT ON FUNCTION public.management_journal_history_write(UUID, UUID, UUID, UUID, TEXT, JSONB) IS
    'J1 internal append-only journal history writer. Not granted to authenticated.';

REVOKE ALL ON FUNCTION public.management_journal_history_write(UUID, UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_history_write(UUID, UUID, UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_history_write(UUID, UUID, UUID, UUID, TEXT, JSONB) FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_require_active_management_caller()
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_caller public.users%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_caller
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_caller.status <> 'active'
       OR v_caller.institution_id IS NULL
       OR NOT public.management_journal_is_management_role(v_caller.primary_role)
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_caller;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_require_active_management_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_require_active_management_caller() FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_require_active_management_caller() FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_page_is_frozen(
    p_page public.management_journal_pages
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_page.id IS NULL THEN
        RETURN TRUE;
    END IF;

    IF p_page.page_type = 'shared' THEN
        RETURN EXISTS (
            SELECT 1
            FROM public.management_journal_pages AS newer
            WHERE newer.institution_id = p_page.institution_id
              AND newer.page_type = 'shared'
              AND newer.journal_date > p_page.journal_date
        );
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.management_journal_pages AS newer
        WHERE newer.page_type = 'personal'
          AND newer.institution_id = p_page.institution_id
          AND newer.owner_user_id = p_page.owner_user_id
          AND newer.journal_date > p_page.journal_date
    );
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_page_is_frozen(public.management_journal_pages) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_page_is_frozen(public.management_journal_pages) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_page_is_frozen(public.management_journal_pages) FROM authenticated;

CREATE OR REPLACE FUNCTION public.auth_user_can_read_management_journal_page(
    p_page_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
BEGIN
    IF v_actor IS NULL OR p_page_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT *
    INTO v_caller
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_caller.status <> 'active'
       OR v_caller.institution_id IS NULL
       OR NOT public.management_journal_is_management_role(v_caller.primary_role)
    THEN
        RETURN FALSE;
    END IF;

    SELECT *
    INTO v_page
    FROM public.management_journal_pages
    WHERE id = p_page_id;

    IF NOT FOUND
       OR v_page.institution_id IS DISTINCT FROM v_caller.institution_id
    THEN
        RETURN FALSE;
    END IF;

    IF v_page.page_type = 'personal' THEN
        RETURN v_page.owner_user_id = v_actor;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.management_journal_page_participants AS p
        WHERE p.page_id = v_page.id
          AND p.user_id = v_actor
    );
END;
$$;

COMMENT ON FUNCTION public.auth_user_can_read_management_journal_page(UUID) IS
    'J1: active manager/deputy/secretary may read a shared page iff participant; personal iff owner. No Manager override. Teacher/Platform Admin denied.';

CREATE OR REPLACE FUNCTION public.management_journal_lock_page(
    p_page_id UUID
)
RETURNS public.management_journal_pages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_page public.management_journal_pages%ROWTYPE;
BEGIN
    SELECT *
    INTO v_page
    FROM public.management_journal_pages
    WHERE id = p_page_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_page;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_lock_page(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_lock_page(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_lock_page(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_assert_page_writable(
    p_page public.management_journal_pages,
    p_caller public.users
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_page.institution_id IS DISTINCT FROM p_caller.institution_id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF public.management_journal_page_is_frozen(p_page) THEN
        RAISE EXCEPTION 'journal_page_frozen'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_page.page_type = 'personal' THEN
        IF p_page.owner_user_id IS DISTINCT FROM p_caller.id THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.management_journal_page_participants AS p
        WHERE p.page_id = p_page.id
          AND p.user_id = p_caller.id
    ) THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_assert_page_writable(public.management_journal_pages, public.users) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_assert_page_writable(public.management_journal_pages, public.users) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_assert_page_writable(public.management_journal_pages, public.users) FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_lock_validate_target_user(
    p_target_user_id UUID,
    p_institution_id UUID
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target public.users%ROWTYPE;
BEGIN
    IF p_target_user_id IS NULL OR p_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Canonical assignment lock: users row FOR UPDATE before the task row.
    SELECT *
    INTO v_target
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_target.status <> 'active'
       OR v_target.institution_id IS DISTINCT FROM p_institution_id
       OR NOT public.management_journal_is_management_role(v_target.primary_role)
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_lock_validate_target_user(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_lock_validate_target_user(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_lock_validate_target_user(UUID, UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_add_participant_internal(
    p_page public.management_journal_pages,
    p_target public.users,
    p_actor_user_id UUID,
    p_automatic BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_page.page_type <> 'shared' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.management_journal_page_participants (
        page_id,
        user_id,
        added_by_user_id,
        added_automatically,
        added_at
    )
    VALUES (
        p_page.id,
        p_target.id,
        p_actor_user_id,
        COALESCE(p_automatic, FALSE),
        NOW()
    )
    ON CONFLICT (page_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        PERFORM public.management_journal_history_write(
            p_page.institution_id,
            p_page.id,
            NULL,
            p_actor_user_id,
            CASE WHEN COALESCE(p_automatic, FALSE)
                THEN 'participant_added_automatic'
                ELSE 'participant_added'
            END,
            jsonb_build_object(
                'target_user_id', p_target.id,
                'target_primary_role', p_target.primary_role::TEXT,
                'automatic', COALESCE(p_automatic, FALSE)
            )
        );
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_add_participant_internal(public.management_journal_pages, public.users, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_add_participant_internal(public.management_journal_pages, public.users, UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_add_participant_internal(public.management_journal_pages, public.users, UUID, BOOLEAN) FROM authenticated;

CREATE OR REPLACE FUNCTION public.management_journal_carry_into_page(
    p_new_page public.management_journal_pages,
    p_actor public.users
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prior public.management_journal_pages%ROWTYPE;
    v_src public.management_journal_tasks%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_keep BOOLEAN;
    v_responsible UUID;
    v_carried INTEGER := 0;
    v_new_id UUID;
BEGIN
    IF p_new_page.page_type = 'shared' THEN
        SELECT *
        INTO v_prior
        FROM public.management_journal_pages
        WHERE institution_id = p_new_page.institution_id
          AND page_type = 'shared'
          AND journal_date < p_new_page.journal_date
        ORDER BY journal_date DESC
        LIMIT 1
        FOR UPDATE;
    ELSE
        SELECT *
        INTO v_prior
        FROM public.management_journal_pages
        WHERE page_type = 'personal'
          AND institution_id = p_new_page.institution_id
          AND owner_user_id = p_new_page.owner_user_id
          AND journal_date < p_new_page.journal_date
        ORDER BY journal_date DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    -- Lock distinct assignees first (canonical users-before-tasks), then tasks.
    PERFORM 1
    FROM public.users AS u
    WHERE u.id IN (
        SELECT t.responsible_user_id
        FROM public.management_journal_tasks AS t
        WHERE t.page_id = v_prior.id
          AND t.status IN ('new', 'in_progress', 'blocked')
          AND t.responsible_user_id IS NOT NULL
    )
    ORDER BY u.id
    FOR UPDATE OF u;

    FOR v_src IN
        SELECT *
        FROM public.management_journal_tasks
        WHERE page_id = v_prior.id
          AND status IN ('new', 'in_progress', 'blocked')
        ORDER BY id
        FOR UPDATE
    LOOP
        v_keep := FALSE;
        v_responsible := NULL;
        v_target := NULL;

        IF p_new_page.page_type = 'personal' THEN
            v_responsible := p_new_page.owner_user_id;
            v_keep := TRUE;
        ELSIF v_src.responsible_user_id IS NOT NULL THEN
            SELECT *
            INTO v_target
            FROM public.users
            WHERE id = v_src.responsible_user_id;

            IF FOUND
               AND v_target.status = 'active'
               AND v_target.institution_id IS NOT DISTINCT FROM p_new_page.institution_id
               AND public.management_journal_is_management_role(v_target.primary_role)
            THEN
                v_keep := TRUE;
                v_responsible := v_target.id;
                PERFORM public.management_journal_add_participant_internal(
                    p_new_page,
                    v_target,
                    p_actor.id,
                    TRUE
                );
            END IF;
        END IF;

        INSERT INTO public.management_journal_tasks (
            page_id,
            institution_id,
            title,
            details,
            note,
            target_time,
            responsible_user_id,
            status,
            sort_order,
            created_by_user_id,
            origin_task_id,
            origin_page_id,
            carried_forward
        )
        VALUES (
            p_new_page.id,
            p_new_page.institution_id,
            v_src.title,
            v_src.details,
            v_src.note,
            v_src.target_time,
            v_responsible,
            v_src.status,
            v_src.sort_order,
            p_actor.id,
            v_src.id,
            v_src.page_id,
            TRUE
        )
        RETURNING id INTO v_new_id;

        PERFORM public.management_journal_history_write(
            p_new_page.institution_id,
            p_new_page.id,
            v_new_id,
            p_actor.id,
            'task_carried_forward',
            jsonb_build_object(
                'origin_task_id', v_src.id,
                'origin_page_id', v_src.page_id,
                'origin_status', v_src.status,
                'previous_responsible_user_id', v_src.responsible_user_id,
                'new_responsible_user_id', v_responsible,
                'unassigned_inactive_assignee', (NOT v_keep)
            )
        );

        v_carried := v_carried + 1;
    END LOOP;

    RETURN v_carried;
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_carry_into_page(public.management_journal_pages, public.users) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_carry_into_page(public.management_journal_pages, public.users) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_carry_into_page(public.management_journal_pages, public.users) FROM authenticated;

-- -----------------------------------------------------------------------------
-- RLS policies (after read helper exists)
-- -----------------------------------------------------------------------------

CREATE POLICY management_journal_pages_select_visible
    ON public.management_journal_pages
    FOR SELECT
    TO authenticated
    USING (public.auth_user_can_read_management_journal_page(id));

CREATE POLICY management_journal_participants_select_visible
    ON public.management_journal_page_participants
    FOR SELECT
    TO authenticated
    USING (public.auth_user_can_read_management_journal_page(page_id));

CREATE POLICY management_journal_tasks_select_visible
    ON public.management_journal_tasks
    FOR SELECT
    TO authenticated
    USING (public.auth_user_can_read_management_journal_page(page_id));

CREATE POLICY management_journal_events_select_visible
    ON public.management_journal_events
    FOR SELECT
    TO authenticated
    USING (public.auth_user_can_read_management_journal_page(page_id));

-- -----------------------------------------------------------------------------
-- Dated internal create helpers (NOT granted to authenticated)
-- Public RPCs below always pass management_journal_current_date().
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.management_journal_create_shared_page_for_date(
    p_journal_date DATE,
    p_participant_user_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_prior public.management_journal_pages%ROWTYPE;
    v_uid UUID;
    v_target public.users%ROWTYPE;
    v_carried INTEGER := 0;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    SELECT *
    INTO v_caller
    FROM public.users
    WHERE id = v_caller.id
    FOR UPDATE;

    IF v_caller.status <> 'active'
       OR v_caller.primary_role NOT IN (
            'institution_manager'::public.user_role,
            'deputy'::public.user_role
       )
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF p_journal_date IS NULL THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    -- Lock current latest shared page so concurrent edits observe freeze after this insert.
    SELECT *
    INTO v_prior
    FROM public.management_journal_pages
    WHERE institution_id = v_caller.institution_id
      AND page_type = 'shared'
    ORDER BY journal_date DESC
    LIMIT 1
    FOR UPDATE;

    -- Idempotent open: today's (or helper-date) page already exists and caller may read it.
    SELECT *
    INTO v_page
    FROM public.management_journal_pages
    WHERE institution_id = v_caller.institution_id
      AND page_type = 'shared'
      AND journal_date = p_journal_date
    FOR UPDATE;

    IF FOUND THEN
        IF EXISTS (
            SELECT 1
            FROM public.management_journal_page_participants AS p
            WHERE p.page_id = v_page.id
              AND p.user_id = v_caller.id
        ) THEN
            RETURN jsonb_build_object(
                'ok', true,
                'unchanged', true,
                'page_id', v_page.id,
                'page_type', 'shared',
                'journal_date', v_page.journal_date,
                'carried_task_count', 0
            );
        END IF;
        RAISE EXCEPTION 'journal_page_exists'
            USING ERRCODE = '23505';
    END IF;

    BEGIN
        INSERT INTO public.management_journal_pages (
            institution_id,
            journal_date,
            page_type,
            owner_user_id,
            created_by_user_id
        )
        VALUES (
            v_caller.institution_id,
            p_journal_date,
            'shared',
            v_caller.id,
            v_caller.id
        )
        RETURNING * INTO v_page;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT *
            INTO v_page
            FROM public.management_journal_pages
            WHERE institution_id = v_caller.institution_id
              AND page_type = 'shared'
              AND journal_date = p_journal_date;

            IF FOUND AND EXISTS (
                SELECT 1
                FROM public.management_journal_page_participants AS p
                WHERE p.page_id = v_page.id
                  AND p.user_id = v_caller.id
            ) THEN
                RETURN jsonb_build_object(
                    'ok', true,
                    'unchanged', true,
                    'page_id', v_page.id,
                    'page_type', 'shared',
                    'journal_date', v_page.journal_date,
                    'carried_task_count', 0
                );
            END IF;
            RAISE EXCEPTION 'journal_page_exists'
                USING ERRCODE = '23505';
    END;

    PERFORM public.management_journal_add_participant_internal(
        v_page,
        v_caller,
        v_caller.id,
        FALSE
    );

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        NULL,
        v_caller.id,
        'page_created',
        jsonb_build_object(
            'page_type', 'shared',
            'journal_date', v_page.journal_date
        )
    );

    IF p_participant_user_ids IS NOT NULL THEN
        FOREACH v_uid IN ARRAY p_participant_user_ids
        LOOP
            IF v_uid IS NULL OR v_uid = v_caller.id THEN
                CONTINUE;
            END IF;
            v_target := public.management_journal_lock_validate_target_user(
                v_uid,
                v_caller.institution_id
            );
            PERFORM public.management_journal_add_participant_internal(
                v_page,
                v_target,
                v_caller.id,
                FALSE
            );
        END LOOP;
    END IF;

    v_carried := public.management_journal_carry_into_page(v_page, v_caller);

    RETURN jsonb_build_object(
        'ok', true,
        'unchanged', false,
        'page_id', v_page.id,
        'page_type', 'shared',
        'journal_date', v_page.journal_date,
        'carried_task_count', v_carried
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.management_journal_create_personal_page_for_date(
    p_journal_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_prior public.management_journal_pages%ROWTYPE;
    v_carried INTEGER := 0;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    SELECT *
    INTO v_caller
    FROM public.users
    WHERE id = v_caller.id
    FOR UPDATE;

    IF v_caller.status <> 'active' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF p_journal_date IS NULL THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_prior
    FROM public.management_journal_pages
    WHERE page_type = 'personal'
      AND institution_id = v_caller.institution_id
      AND owner_user_id = v_caller.id
    ORDER BY journal_date DESC
    LIMIT 1
    FOR UPDATE;

    SELECT *
    INTO v_page
    FROM public.management_journal_pages
    WHERE page_type = 'personal'
      AND institution_id = v_caller.institution_id
      AND owner_user_id = v_caller.id
      AND journal_date = p_journal_date
    FOR UPDATE;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'ok', true,
            'unchanged', true,
            'page_id', v_page.id,
            'page_type', 'personal',
            'journal_date', v_page.journal_date,
            'carried_task_count', 0
        );
    END IF;

    BEGIN
        INSERT INTO public.management_journal_pages (
            institution_id,
            journal_date,
            page_type,
            owner_user_id,
            created_by_user_id
        )
        VALUES (
            v_caller.institution_id,
            p_journal_date,
            'personal',
            v_caller.id,
            v_caller.id
        )
        RETURNING * INTO v_page;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT *
            INTO v_page
            FROM public.management_journal_pages
            WHERE page_type = 'personal'
              AND institution_id = v_caller.institution_id
              AND owner_user_id = v_caller.id
              AND journal_date = p_journal_date;

            IF FOUND THEN
                RETURN jsonb_build_object(
                    'ok', true,
                    'unchanged', true,
                    'page_id', v_page.id,
                    'page_type', 'personal',
                    'journal_date', v_page.journal_date,
                    'carried_task_count', 0
                );
            END IF;
            RAISE EXCEPTION 'journal_page_exists'
                USING ERRCODE = '23505';
    END;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        NULL,
        v_caller.id,
        'page_created',
        jsonb_build_object(
            'page_type', 'personal',
            'journal_date', v_page.journal_date
        )
    );

    v_carried := public.management_journal_carry_into_page(v_page, v_caller);

    RETURN jsonb_build_object(
        'ok', true,
        'unchanged', false,
        'page_id', v_page.id,
        'page_type', 'personal',
        'journal_date', v_page.journal_date,
        'carried_task_count', v_carried
    );
END;
$$;

REVOKE ALL ON FUNCTION public.management_journal_create_shared_page_for_date(DATE, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_create_shared_page_for_date(DATE, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_create_shared_page_for_date(DATE, UUID[]) FROM authenticated;

REVOKE ALL ON FUNCTION public.management_journal_create_personal_page_for_date(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_create_personal_page_for_date(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.management_journal_create_personal_page_for_date(DATE) FROM authenticated;

COMMENT ON FUNCTION public.management_journal_create_shared_page_for_date(DATE, UUID[]) IS
    'J1 internal dated shared-page create. Not granted to authenticated. Public RPC always passes management_journal_current_date().';

COMMENT ON FUNCTION public.management_journal_create_personal_page_for_date(DATE) IS
    'J1 internal dated personal-page create. Not granted to authenticated. Public RPC always passes management_journal_current_date().';

-- -----------------------------------------------------------------------------
-- Public RPCs (today only; no caller-controlled journal_date)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_management_journal_shared_page(
    p_participant_user_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.management_journal_create_shared_page_for_date(
        public.management_journal_current_date(),
        COALESCE(p_participant_user_ids, ARRAY[]::UUID[])
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_management_journal_personal_page()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.management_journal_create_personal_page_for_date(
        public.management_journal_current_date()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.add_management_journal_page_participant(
    p_page_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_added BOOLEAN;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    IF v_caller.primary_role NOT IN (
            'institution_manager'::public.user_role,
            'deputy'::public.user_role
       )
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_page := public.management_journal_lock_page(p_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    IF v_page.page_type <> 'shared' THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_target := public.management_journal_lock_validate_target_user(
        p_user_id,
        v_caller.institution_id
    );

    v_added := public.management_journal_add_participant_internal(
        v_page,
        v_target,
        v_caller.id,
        FALSE
    );

    RETURN jsonb_build_object(
        'ok', true,
        'page_id', v_page.id,
        'user_id', v_target.id,
        'added', v_added
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_management_journal_task(
    p_page_id UUID,
    p_title TEXT,
    p_responsible_user_id UUID,
    p_details TEXT DEFAULT NULL,
    p_target_time TIME DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_task public.management_journal_tasks%ROWTYPE;
    v_sort INTEGER;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();
    v_page := public.management_journal_lock_page(p_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    IF p_responsible_user_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- users lock before task insert (no existing task row yet).
    v_target := public.management_journal_lock_validate_target_user(
        p_responsible_user_id,
        v_caller.institution_id
    );

    IF v_page.page_type = 'personal' THEN
        IF v_target.id <> v_page.owner_user_id OR v_caller.id <> v_page.owner_user_id THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM public.management_journal_page_participants
            WHERE page_id = v_page.id
              AND user_id = v_target.id
        ) THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;

        IF NOT public.management_journal_can_assign(
            v_caller.primary_role,
            v_caller.id,
            v_target.primary_role,
            v_target.id
        ) THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT COALESCE(MAX(sort_order), 0) + 1
    INTO v_sort
    FROM public.management_journal_tasks
    WHERE page_id = v_page.id;

    INSERT INTO public.management_journal_tasks (
        page_id,
        institution_id,
        title,
        details,
        target_time,
        responsible_user_id,
        status,
        sort_order,
        created_by_user_id,
        carried_forward
    )
    VALUES (
        v_page.id,
        v_page.institution_id,
        btrim(p_title),
        p_details,
        p_target_time,
        v_target.id,
        'new',
        v_sort,
        v_caller.id,
        FALSE
    )
    RETURNING * INTO v_task;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        v_task.id,
        v_caller.id,
        'task_created',
        jsonb_build_object(
            'responsible_user_id', v_target.id,
            'status', 'new'
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'task_id', v_task.id,
        'page_id', v_page.id,
        'status', v_task.status,
        'responsible_user_id', v_task.responsible_user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_management_journal_task_content(
    p_task_id UUID,
    p_title TEXT,
    p_details TEXT DEFAULT NULL,
    p_target_time TIME DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_task public.management_journal_tasks%ROWTYPE;
    v_page_id UUID;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    SELECT page_id
    INTO v_page_id
    FROM public.management_journal_tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_page := public.management_journal_lock_page(v_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    SELECT *
    INTO v_task
    FROM public.management_journal_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND OR v_task.page_id IS DISTINCT FROM v_page.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_task.created_by_user_id <> v_caller.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.management_journal_tasks
    SET
        title = btrim(p_title),
        details = p_details,
        target_time = p_target_time
    WHERE id = v_task.id;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        v_task.id,
        v_caller.id,
        'task_content_edited',
        jsonb_build_object('title', btrim(p_title))
    );

    RETURN jsonb_build_object('ok', true, 'task_id', v_task.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_management_journal_task_note(
    p_task_id UUID,
    p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_task public.management_journal_tasks%ROWTYPE;
    v_page_id UUID;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    SELECT page_id
    INTO v_page_id
    FROM public.management_journal_tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_page := public.management_journal_lock_page(v_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    SELECT *
    INTO v_task
    FROM public.management_journal_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND OR v_task.page_id IS DISTINCT FROM v_page.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_task.responsible_user_id IS DISTINCT FROM v_caller.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.management_journal_tasks
    SET note = p_note
    WHERE id = v_task.id;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        v_task.id,
        v_caller.id,
        'task_note_changed',
        '{}'::jsonb
    );

    RETURN jsonb_build_object('ok', true, 'task_id', v_task.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_management_journal_task(
    p_task_id UUID,
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_target public.users%ROWTYPE;
    v_task public.management_journal_tasks%ROWTYPE;
    v_previous UUID;
    v_page_id UUID;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    SELECT page_id
    INTO v_page_id
    FROM public.management_journal_tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_page := public.management_journal_lock_page(v_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    -- Canonical assignment lock order: target users row FOR UPDATE, then task FOR UPDATE.
    v_target := public.management_journal_lock_validate_target_user(
        p_target_user_id,
        v_caller.institution_id
    );

    SELECT *
    INTO v_task
    FROM public.management_journal_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND OR v_task.page_id IS DISTINCT FROM v_page.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_page.page_type = 'personal' THEN
        IF v_target.id <> v_page.owner_user_id OR v_caller.id <> v_page.owner_user_id THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM public.management_journal_page_participants
            WHERE page_id = v_page.id
              AND user_id = v_target.id
        ) THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;

        IF NOT public.management_journal_can_assign(
            v_caller.primary_role,
            v_caller.id,
            v_target.primary_role,
            v_target.id
        ) THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_previous := v_task.responsible_user_id;

    UPDATE public.management_journal_tasks
    SET responsible_user_id = v_target.id
    WHERE id = v_task.id;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        v_task.id,
        v_caller.id,
        'task_assigned',
        jsonb_build_object(
            'previous_responsible_user_id', v_previous,
            'new_responsible_user_id', v_target.id,
            'target_primary_role', v_target.primary_role::TEXT
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'task_id', v_task.id,
        'responsible_user_id', v_target.id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_management_journal_task_status(
    p_task_id UUID,
    p_expected_status TEXT,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller public.users%ROWTYPE;
    v_page public.management_journal_pages%ROWTYPE;
    v_task public.management_journal_tasks%ROWTYPE;
    v_updated INTEGER;
    v_page_id UUID;
BEGIN
    v_caller := public.management_journal_require_active_management_caller();

    IF p_new_status IS NULL OR p_new_status NOT IN ('new', 'in_progress', 'completed', 'blocked') THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    IF p_expected_status IS NULL OR p_expected_status NOT IN ('new', 'in_progress', 'completed', 'blocked') THEN
        RAISE EXCEPTION 'journal_invalid_argument'
            USING ERRCODE = '22023';
    END IF;

    SELECT page_id
    INTO v_page_id
    FROM public.management_journal_tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    v_page := public.management_journal_lock_page(v_page_id);
    PERFORM public.management_journal_assert_page_writable(v_page, v_caller);

    SELECT *
    INTO v_task
    FROM public.management_journal_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND OR v_task.page_id IS DISTINCT FROM v_page.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF v_task.responsible_user_id IS DISTINCT FROM v_caller.id THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.management_journal_tasks
    SET status = p_new_status
    WHERE id = v_task.id
      AND status = p_expected_status;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        RAISE EXCEPTION 'journal_stale_status'
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.management_journal_history_write(
        v_page.institution_id,
        v_page.id,
        v_task.id,
        v_caller.id,
        'task_status_changed',
        jsonb_build_object(
            'previous_status', p_expected_status,
            'new_status', p_new_status
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'task_id', v_task.id,
        'status', p_new_status
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- RPC privileges
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.management_journal_current_date() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_current_date() FROM anon;
GRANT EXECUTE ON FUNCTION public.management_journal_current_date() TO authenticated;

REVOKE ALL ON FUNCTION public.management_journal_is_management_role(public.user_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_is_management_role(public.user_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.management_journal_is_management_role(public.user_role) TO authenticated;

REVOKE ALL ON FUNCTION public.management_journal_can_assign(public.user_role, UUID, public.user_role, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.management_journal_can_assign(public.user_role, UUID, public.user_role, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.management_journal_can_assign(public.user_role, UUID, public.user_role, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.auth_user_can_read_management_journal_page(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_can_read_management_journal_page(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.auth_user_can_read_management_journal_page(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_management_journal_shared_page(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_management_journal_shared_page(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_management_journal_shared_page(UUID[]) TO authenticated;

REVOKE ALL ON FUNCTION public.create_management_journal_personal_page() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_management_journal_personal_page() FROM anon;
GRANT EXECUTE ON FUNCTION public.create_management_journal_personal_page() TO authenticated;

REVOKE ALL ON FUNCTION public.add_management_journal_page_participant(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_management_journal_page_participant(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_management_journal_page_participant(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) TO authenticated;

REVOKE ALL ON FUNCTION public.update_management_journal_task_content(UUID, TEXT, TEXT, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_management_journal_task_content(UUID, TEXT, TEXT, TIME) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_management_journal_task_content(UUID, TEXT, TEXT, TIME) TO authenticated;

REVOKE ALL ON FUNCTION public.update_management_journal_task_note(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_management_journal_task_note(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_management_journal_task_note(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_management_journal_task(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.update_management_journal_task_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_management_journal_task_status(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_management_journal_task_status(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_management_journal_shared_page(UUID[]) IS
    'J1: active manager/deputy opens or creates TODAY''s unique shared page (Asia/Jerusalem). No client date. Creator is participant. Carry-forward runs only on first create.';

COMMENT ON FUNCTION public.create_management_journal_personal_page() IS
    'J1: active manager/deputy/secretary opens or creates TODAY''s personal page (Asia/Jerusalem). No client date. Private. Carry-forward on first create only. Inactive caller fails closed.';

COMMENT ON FUNCTION public.add_management_journal_page_participant(UUID, UUID) IS
    'J1: append-only shared membership. No remove. Frozen pages denied.';

COMMENT ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) IS
    'J1: create task on writable page. Shared assignment matrix. Personal owner-only.';

COMMENT ON FUNCTION public.update_management_journal_task_content(UUID, TEXT, TEXT, TIME) IS
    'J1: original creator edits title/details/target_time. Responsible cannot rewrite text unless also creator.';

COMMENT ON FUNCTION public.update_management_journal_task_note(UUID, TEXT) IS
    'J1: current responsible user only.';

COMMENT ON FUNCTION public.assign_management_journal_task(UUID, UUID) IS
    'J1: reassign with users-row FOR UPDATE then task FOR UPDATE. Shared matrix. Personal owner-only.';

COMMENT ON FUNCTION public.update_management_journal_task_status(UUID, TEXT, TEXT) IS
    'J1: responsible-only status CAS (expected previous status). No Manager override.';
