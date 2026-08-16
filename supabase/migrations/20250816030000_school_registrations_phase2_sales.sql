-- =============================================================================
-- MPEX — School registration sales handling (Phase 2)
-- =============================================================================
-- Platform Admin sales workflow only: statuses, notes, status history,
-- follow-up, and extensible activity timeline.
-- No Phase 3 messaging. No Phase 4 institution conversion.
-- Preserves Phase 1 fail-closed table grants (no anon/authenticated table access).

-- -----------------------------------------------------------------------------
-- 1. Lifecycle statuses + follow_up_at
-- -----------------------------------------------------------------------------

-- Remap any Phase 1 placeholder statuses before tightening the CHECK.
UPDATE public.school_registrations
SET status = CASE status
    WHEN 'in_review' THEN 'awaiting_response'
    WHEN 'converted' THEN 'closed'
    WHEN 'rejected' THEN 'not_relevant'
    ELSE status
END
WHERE status IN ('in_review', 'converted', 'rejected');

ALTER TABLE public.school_registrations
    DROP CONSTRAINT IF EXISTS school_registrations_status_valid;

ALTER TABLE public.school_registrations
    ADD CONSTRAINT school_registrations_status_valid
        CHECK (status IN (
            'new',
            'contacted',
            'awaiting_response',
            'interested',
            'closed',
            'not_relevant'
        ));

ALTER TABLE public.school_registrations
    ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.school_registrations.follow_up_at IS
    'Optional Platform Admin follow-up timestamp (Phase 2). Cleared by setting NULL.';

CREATE INDEX IF NOT EXISTS idx_school_registrations_follow_up_at
    ON public.school_registrations (follow_up_at)
    WHERE follow_up_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Append-only internal notes
-- -----------------------------------------------------------------------------

CREATE TABLE public.school_registration_notes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID        NOT NULL
        REFERENCES public.school_registrations (id) ON DELETE CASCADE,
    author_user_id      UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    note_text           TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_registration_notes_note_text_not_blank
        CHECK (BTRIM(note_text) <> ''),
    CONSTRAINT school_registration_notes_note_text_max_len
        CHECK (char_length(note_text) <= 2000)
);

COMMENT ON TABLE public.school_registration_notes IS
    'Append-only Platform Admin sales notes on school registrations (Phase 2).';

CREATE INDEX idx_school_registration_notes_registration_created
    ON public.school_registration_notes (registration_id, created_at ASC);

ALTER TABLE public.school_registration_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_registration_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.school_registration_notes FROM anon;
REVOKE ALL ON TABLE public.school_registration_notes FROM authenticated;

-- -----------------------------------------------------------------------------
-- 3. Immutable status history
-- -----------------------------------------------------------------------------

CREATE TABLE public.school_registration_status_history (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID        NOT NULL
        REFERENCES public.school_registrations (id) ON DELETE CASCADE,
    previous_status     TEXT        NOT NULL,
    new_status          TEXT        NOT NULL,
    changed_by          UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_registration_status_history_previous_valid
        CHECK (previous_status IN (
            'new', 'contacted', 'awaiting_response', 'interested', 'closed', 'not_relevant'
        )),
    CONSTRAINT school_registration_status_history_new_valid
        CHECK (new_status IN (
            'new', 'contacted', 'awaiting_response', 'interested', 'closed', 'not_relevant'
        )),
    CONSTRAINT school_registration_status_history_changed
        CHECK (previous_status IS DISTINCT FROM new_status)
);

COMMENT ON TABLE public.school_registration_status_history IS
    'Immutable status change events for school registrations (Phase 2).';

CREATE INDEX idx_school_registration_status_history_reg_changed
    ON public.school_registration_status_history (registration_id, changed_at ASC);

ALTER TABLE public.school_registration_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_registration_status_history FROM PUBLIC;
REVOKE ALL ON TABLE public.school_registration_status_history FROM anon;
REVOKE ALL ON TABLE public.school_registration_status_history FROM authenticated;

-- -----------------------------------------------------------------------------
-- 4. Extensible activity timeline (Phase 3 event types added later via ALTER)
-- -----------------------------------------------------------------------------

CREATE TABLE public.school_registration_activities (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID        NOT NULL
        REFERENCES public.school_registrations (id) ON DELETE CASCADE,
    event_type          TEXT        NOT NULL,
    actor_user_id       UUID        NULL
        REFERENCES public.users (id) ON DELETE SET NULL,
    payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT school_registration_activities_event_type_valid
        CHECK (event_type IN (
            'registration_created',
            'note_added',
            'status_changed',
            'follow_up_set',
            'follow_up_rescheduled',
            'follow_up_cleared'
            -- Phase 3: email_sent, whatsapp_sent, quotation_sent (ALTER CHECK later)
        ))
);

COMMENT ON TABLE public.school_registration_activities IS
    'Chronological sales activity timeline for school registrations. Phase 2 events only; Phase 3 messaging types extend via migration.';

CREATE INDEX idx_school_registration_activities_reg_created
    ON public.school_registration_activities (registration_id, created_at ASC, id ASC);

ALTER TABLE public.school_registration_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.school_registration_activities FROM PUBLIC;
REVOKE ALL ON TABLE public.school_registration_activities FROM anon;
REVOKE ALL ON TABLE public.school_registration_activities FROM authenticated;

-- Backfill created events for existing Phase 1 intake rows.
INSERT INTO public.school_registration_activities (
    registration_id,
    event_type,
    actor_user_id,
    payload,
    created_at
)
SELECT
    r.id,
    'registration_created',
    NULL,
    '{}'::jsonb,
    r.created_at
FROM public.school_registrations AS r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.school_registration_activities AS a
    WHERE a.registration_id = r.id
      AND a.event_type = 'registration_created'
);

-- -----------------------------------------------------------------------------
-- 5. Replace list/get RPCs to include follow_up_at
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.platform_admin_list_school_registrations();
DROP FUNCTION IF EXISTS public.platform_admin_get_school_registration(UUID);

CREATE OR REPLACE FUNCTION public.platform_admin_list_school_registrations()
RETURNS TABLE (
    id UUID,
    school_name TEXT,
    institution_symbol TEXT,
    city TEXT,
    applicant_role TEXT,
    contact_full_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT,
    follow_up_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    RETURN QUERY
    SELECT
        r.id,
        r.school_name,
        r.institution_symbol,
        r.city,
        r.applicant_role,
        r.contact_full_name,
        r.email,
        r.phone,
        r.status,
        r.follow_up_at,
        r.created_at,
        r.updated_at
    FROM public.school_registrations AS r
    ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_list_school_registrations() IS
    'Lists school registration intake rows for active Platform Admin only (Phase 2 includes follow_up_at).';

REVOKE ALL ON FUNCTION public.platform_admin_list_school_registrations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_school_registrations() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_school_registrations() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_get_school_registration(p_id UUID)
RETURNS TABLE (
    id UUID,
    school_name TEXT,
    institution_symbol TEXT,
    city TEXT,
    applicant_role TEXT,
    contact_full_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT,
    follow_up_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    converted_institution_id UUID,
    converted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.school_name,
        r.institution_symbol,
        r.city,
        r.applicant_role,
        r.contact_full_name,
        r.email,
        r.phone,
        r.status,
        r.follow_up_at,
        r.created_at,
        r.updated_at,
        r.converted_institution_id,
        r.converted_at
    FROM public.school_registrations AS r
    WHERE r.id = p_id;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_get_school_registration(UUID) IS
    'Returns one school registration for active Platform Admin only (Phase 2 includes follow_up_at).';

REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_get_school_registration(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_school_registration(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Status mutation (atomic with history + activity)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_update_school_registration_status(
    p_registration_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_status TEXT;
    v_previous TEXT;
    v_history_id UUID;
BEGIN
    v_actor_id := public.platform_admin_require_active();

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    v_status := lower(btrim(COALESCE(p_new_status, '')));
    IF v_status NOT IN (
        'new', 'contacted', 'awaiting_response', 'interested', 'closed', 'not_relevant'
    ) THEN
        RAISE EXCEPTION 'Invalid status.' USING ERRCODE = '22023';
    END IF;

    SELECT r.status INTO v_previous
    FROM public.school_registrations AS r
    WHERE r.id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
    END IF;

    -- No-op: do not fabricate history/activity.
    IF v_previous = v_status THEN
        RETURN jsonb_build_object(
            'ok', true,
            'changed', false,
            'status', v_status
        );
    END IF;

    UPDATE public.school_registrations
    SET status = v_status
    WHERE id = p_registration_id;

    INSERT INTO public.school_registration_status_history (
        registration_id,
        previous_status,
        new_status,
        changed_by
    )
    VALUES (
        p_registration_id,
        v_previous,
        v_status,
        v_actor_id
    )
    RETURNING id INTO v_history_id;

    INSERT INTO public.school_registration_activities (
        registration_id,
        event_type,
        actor_user_id,
        payload
    )
    VALUES (
        p_registration_id,
        'status_changed',
        v_actor_id,
        jsonb_build_object(
            'previous_status', v_previous,
            'new_status', v_status,
            'history_id', v_history_id
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'changed', true,
        'status', v_status,
        'previous_status', v_previous,
        'history_id', v_history_id
    );
END;
$$;

COMMENT ON FUNCTION public.platform_admin_update_school_registration_status(UUID, TEXT) IS
    'Platform Admin atomic status update with immutable history + timeline event.';

REVOKE ALL ON FUNCTION public.platform_admin_update_school_registration_status(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_update_school_registration_status(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_update_school_registration_status(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Append note
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_add_school_registration_note(
    p_registration_id UUID,
    p_note_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_note TEXT;
    v_note_id UUID;
BEGIN
    v_actor_id := public.platform_admin_require_active();

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    v_note := btrim(COALESCE(p_note_text, ''));
    IF v_note = '' THEN
        RAISE EXCEPTION 'Note text is required.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_note) > 2000 THEN
        RAISE EXCEPTION 'Note text is too long.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.school_registrations WHERE id = p_registration_id
    ) THEN
        RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.school_registration_notes (
        registration_id,
        author_user_id,
        note_text
    )
    VALUES (
        p_registration_id,
        v_actor_id,
        v_note
    )
    RETURNING id INTO v_note_id;

    INSERT INTO public.school_registration_activities (
        registration_id,
        event_type,
        actor_user_id,
        payload
    )
    VALUES (
        p_registration_id,
        'note_added',
        v_actor_id,
        jsonb_build_object(
            'note_id', v_note_id,
            'preview', left(v_note, 120)
        )
    );

    RETURN jsonb_build_object('ok', true, 'note_id', v_note_id);
END;
$$;

COMMENT ON FUNCTION public.platform_admin_add_school_registration_note(UUID, TEXT) IS
    'Platform Admin append-only internal note on a school registration.';

REVOKE ALL ON FUNCTION public.platform_admin_add_school_registration_note(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_add_school_registration_note(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_add_school_registration_note(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Follow-up set / reschedule / clear
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_set_school_registration_follow_up(
    p_registration_id UUID,
    p_follow_up_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_previous TIMESTAMPTZ;
    v_event_type TEXT;
BEGIN
    v_actor_id := public.platform_admin_require_active();

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    SELECT r.follow_up_at INTO v_previous
    FROM public.school_registrations AS r
    WHERE r.id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found.' USING ERRCODE = 'P0002';
    END IF;

    -- No-op clear/set of identical value: no activity noise.
    IF v_previous IS NOT DISTINCT FROM p_follow_up_at THEN
        RETURN jsonb_build_object(
            'ok', true,
            'changed', false,
            'follow_up_at', p_follow_up_at
        );
    END IF;

    IF p_follow_up_at IS NULL THEN
        v_event_type := 'follow_up_cleared';
    ELSIF v_previous IS NULL THEN
        v_event_type := 'follow_up_set';
    ELSE
        v_event_type := 'follow_up_rescheduled';
    END IF;

    UPDATE public.school_registrations
    SET follow_up_at = p_follow_up_at
    WHERE id = p_registration_id;

    INSERT INTO public.school_registration_activities (
        registration_id,
        event_type,
        actor_user_id,
        payload
    )
    VALUES (
        p_registration_id,
        v_event_type,
        v_actor_id,
        jsonb_build_object(
            'previous_follow_up_at', v_previous,
            'follow_up_at', p_follow_up_at
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'changed', true,
        'event_type', v_event_type,
        'follow_up_at', p_follow_up_at
    );
END;
$$;

COMMENT ON FUNCTION public.platform_admin_set_school_registration_follow_up(UUID, TIMESTAMPTZ) IS
    'Platform Admin set/reschedule/clear follow_up_at with timeline audit.';

REVOKE ALL ON FUNCTION public.platform_admin_set_school_registration_follow_up(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_set_school_registration_follow_up(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_school_registration_follow_up(UUID, TIMESTAMPTZ) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Read notes + activity (Platform Admin only)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_admin_list_school_registration_notes(
    p_registration_id UUID
)
RETURNS TABLE (
    id UUID,
    registration_id UUID,
    author_user_id UUID,
    note_text TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        n.id,
        n.registration_id,
        n.author_user_id,
        n.note_text,
        n.created_at
    FROM public.school_registration_notes AS n
    WHERE n.registration_id = p_registration_id
    ORDER BY n.created_at ASC, n.id ASC;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_list_school_registration_notes(UUID) IS
    'Lists append-only internal notes for one registration (Platform Admin only).';

REVOKE ALL ON FUNCTION public.platform_admin_list_school_registration_notes(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_school_registration_notes(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_school_registration_notes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_list_school_registration_activity(
    p_registration_id UUID
)
RETURNS TABLE (
    id UUID,
    registration_id UUID,
    event_type TEXT,
    actor_user_id UUID,
    payload JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.platform_admin_require_active();

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'Invalid registration id.' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        a.id,
        a.registration_id,
        a.event_type,
        a.actor_user_id,
        a.payload,
        a.created_at
    FROM public.school_registration_activities AS a
    WHERE a.registration_id = p_registration_id
    ORDER BY a.created_at ASC, a.id ASC;
END;
$$;

COMMENT ON FUNCTION public.platform_admin_list_school_registration_activity(UUID) IS
    'Chronological sales activity timeline for one registration (Platform Admin only).';

REVOKE ALL ON FUNCTION public.platform_admin_list_school_registration_activity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_school_registration_activity(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_school_registration_activity(UUID) TO authenticated;
