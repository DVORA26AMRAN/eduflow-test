-- =============================================================================
-- EduFlow — Secretary shared-page task create/assign deny (forward-only)
-- =============================================================================
-- Does NOT edit 20250819107000.
-- Does NOT change management_journal_can_assign globally.
-- Does NOT change status/note/content RPCs, RLS, or users ACL.
--
-- Shared page: Secretary may not create or assign/reassign tasks.
-- Personal page: owner create / self-assignment semantics unchanged.
-- =============================================================================

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
        -- Shared: Secretary may read/work assigned tasks but must not create.
        IF v_caller.primary_role = 'secretary'::public.user_role THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;

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
        -- Shared: Secretary may not assign or reassign tasks.
        IF v_caller.primary_role = 'secretary'::public.user_role THEN
            RAISE EXCEPTION 'Permission denied.'
                USING ERRCODE = '42501';
        END IF;

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

REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_management_journal_task(UUID, TEXT, UUID, TEXT, TIME) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_management_journal_task(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_management_journal_task(UUID, UUID) TO authenticated;
