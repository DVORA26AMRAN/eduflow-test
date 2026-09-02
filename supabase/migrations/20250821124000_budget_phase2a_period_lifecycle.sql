-- =============================================================================
-- MPEX — School Budget Management Phase 2A: Budget Period Lifecycle
-- =============================================================================
-- Forward-only. Period lifecycle RPCs, audit, overlap enforcement, end-date
-- financial freeze, and closed-period immutability.
-- Does NOT edit P1A/P1B/P1C/P1D migrations.
-- Does NOT implement: funding-source UI, category UI, structure copy, allocation
-- UI, transfer UI, commitments, expenses, request integration, carry-forward,
-- automatic activation/closing.
-- Does NOT touch public.requests or Phase 3 quotation/PDF work.

-- -----------------------------------------------------------------------------
-- budget_periods — forward-only metadata extension
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_periods
    ADD COLUMN IF NOT EXISTS updated_by_user_id UUID
        REFERENCES public.users (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.budget_periods.updated_by_user_id IS
    'P2A: last metadata/lifecycle actor for period row updates.';

ALTER TABLE public.budget_periods
    DROP CONSTRAINT IF EXISTS budget_periods_name_max_length;

ALTER TABLE public.budget_periods
    ADD CONSTRAINT budget_periods_name_max_length
        CHECK (LENGTH(BTRIM(name)) <= 200);

ALTER TABLE public.budget_periods
    DROP CONSTRAINT IF EXISTS budget_periods_start_before_end;

ALTER TABLE public.budget_periods
    ADD CONSTRAINT budget_periods_start_before_end
        CHECK (start_date < end_date);

-- -----------------------------------------------------------------------------
-- Period lifecycle audit (append-only — separate from permission/financial audit)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_period_lifecycle_audit_events (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id    UUID        NOT NULL
        REFERENCES public.budget_periods (id) ON DELETE RESTRICT,
    actor_user_id       UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    event_type          TEXT        NOT NULL,
    metadata            JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_period_lifecycle_audit_event_type_valid
        CHECK (event_type IN (
            'period_created',
            'period_metadata_updated',
            'period_activated',
            'period_closed'
        ))
);

COMMENT ON TABLE public.budget_period_lifecycle_audit_events IS
    'Append-only Budget period lifecycle audit (P2A).';

CREATE INDEX idx_budget_period_lifecycle_audit_institution_created_at
    ON public.budget_period_lifecycle_audit_events (institution_id, created_at DESC);

CREATE INDEX idx_budget_period_lifecycle_audit_period_created_at
    ON public.budget_period_lifecycle_audit_events (budget_period_id, created_at DESC);

ALTER TABLE public.budget_period_lifecycle_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.budget_period_lifecycle_audit_events FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_period_lifecycle_audit_events FROM anon;
REVOKE ALL ON TABLE public.budget_period_lifecycle_audit_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_period_lifecycle_audit_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'budget_not_found'
        USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.budget_period_lifecycle_audit_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_period_lifecycle_audit_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.budget_period_lifecycle_audit_reject_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS budget_period_lifecycle_audit_no_update
    ON public.budget_period_lifecycle_audit_events;
CREATE TRIGGER budget_period_lifecycle_audit_no_update
    BEFORE UPDATE ON public.budget_period_lifecycle_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_period_lifecycle_audit_reject_mutation();

DROP TRIGGER IF EXISTS budget_period_lifecycle_audit_no_delete
    ON public.budget_period_lifecycle_audit_events;
CREATE TRIGGER budget_period_lifecycle_audit_no_delete
    BEFORE DELETE ON public.budget_period_lifecycle_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_period_lifecycle_audit_reject_mutation();

-- -----------------------------------------------------------------------------
-- Non-overlap enforcement (database-level defense in depth)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_budget_period_no_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.budget_periods AS p
        WHERE p.institution_id = NEW.institution_id
          AND p.id IS DISTINCT FROM NEW.id
          AND NEW.start_date <= p.end_date
          AND NEW.end_date >= p.start_date
    ) THEN
        RAISE EXCEPTION 'budget_period_overlap'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_period_no_overlap() IS
    'P2A: same-institution budget period date ranges must not overlap.';

REVOKE ALL ON FUNCTION public.enforce_budget_period_no_overlap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_period_no_overlap() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_period_no_overlap() FROM authenticated;

DROP TRIGGER IF EXISTS budget_periods_enforce_no_overlap ON public.budget_periods;
CREATE TRIGGER budget_periods_enforce_no_overlap
    BEFORE INSERT OR UPDATE OF institution_id, start_date, end_date
    ON public.budget_periods
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_period_no_overlap();

-- -----------------------------------------------------------------------------
-- Closed terminal immutability + forbidden status regressions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_budget_period_lifecycle_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'budget_period_closed'
            USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status = 'closed' THEN
        RAISE EXCEPTION 'budget_period_closed'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status = 'draft' AND NEW.status = 'active' THEN
            NULL;
        ELSIF OLD.status = 'active' AND NEW.status = 'closed' THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'budget_period_closed'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
        IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
           OR NEW.activated_by_user_id IS DISTINCT FROM OLD.activated_by_user_id
           OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
           OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id
        THEN
            RAISE EXCEPTION 'budget_period_not_draft'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'active' THEN
        IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
           OR NEW.name IS DISTINCT FROM OLD.name
           OR NEW.start_date IS DISTINCT FROM OLD.start_date
           OR NEW.end_date IS DISTINCT FROM OLD.end_date
           OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
           OR NEW.activated_by_user_id IS DISTINCT FROM OLD.activated_by_user_id
           OR NEW.closed_at IS NOT NULL
           OR NEW.closed_by_user_id IS NOT NULL
        THEN
            RAISE EXCEPTION 'budget_period_not_draft'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_period_lifecycle_immutability() IS
    'P2A: closed periods are terminal; active metadata is immutable; no deletes.';

REVOKE ALL ON FUNCTION public.enforce_budget_period_lifecycle_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_period_lifecycle_immutability() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_period_lifecycle_immutability() FROM authenticated;

DROP TRIGGER IF EXISTS budget_periods_enforce_lifecycle_immutability ON public.budget_periods;
CREATE TRIGGER budget_periods_enforce_lifecycle_immutability
    BEFORE UPDATE OR DELETE ON public.budget_periods
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_period_lifecycle_immutability();

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_write_period_lifecycle_audit(
    p_institution_id UUID,
    p_budget_period_id UUID,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.budget_period_lifecycle_audit_events (
        institution_id,
        budget_period_id,
        actor_user_id,
        event_type,
        metadata
    )
    VALUES (
        p_institution_id,
        p_budget_period_id,
        p_actor_user_id,
        p_event_type,
        COALESCE(p_metadata, '{}'::JSONB)
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.budget_write_period_lifecycle_audit(UUID, UUID, UUID, TEXT, JSONB)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_write_period_lifecycle_audit(UUID, UUID, UUID, TEXT, JSONB)
    FROM anon;
REVOKE ALL ON FUNCTION public.budget_write_period_lifecycle_audit(UUID, UUID, UUID, TEXT, JSONB)
    FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_lock_institution_budget_periods(
    p_institution_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_institution public.institutions%ROWTYPE;
BEGIN
    -- Institution row is the stable mutex even when zero budget_periods exist.
    SELECT *
    INTO v_institution
    FROM public.institutions
    WHERE id = p_institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM p.id
    FROM public.budget_periods AS p
    WHERE p.institution_id = p_institution_id
    ORDER BY p.id
    FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION public.budget_lock_institution_budget_periods(UUID) IS
    'P2A: institution-row mutex then budget_period rows (UUID ascending). No SKIP LOCKED.';

REVOKE ALL ON FUNCTION public.budget_lock_institution_budget_periods(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_lock_institution_budget_periods(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_lock_institution_budget_periods(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_period_has_overlap(
    p_institution_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_exclude_period_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.budget_periods AS p
        WHERE p.institution_id = p_institution_id
          AND (p_exclude_period_id IS NULL OR p.id IS DISTINCT FROM p_exclude_period_id)
          AND p.start_date <= p_end_date
          AND p.end_date >= p_start_date
    );
$$;

REVOKE ALL ON FUNCTION public.budget_period_has_overlap(UUID, DATE, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_period_has_overlap(UUID, DATE, DATE, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_period_has_overlap(UUID, DATE, DATE, UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_period_financial_mutation_error(
    p_period public.budget_periods
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_period.status = 'closed' THEN
        RETURN 'budget_period_closed';
    END IF;

    IF p_period.status NOT IN ('draft', 'active') THEN
        RETURN 'budget_period_closed';
    END IF;

    IF CURRENT_DATE > p_period.end_date THEN
        RETURN 'budget_period_ended';
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.budget_period_financial_mutation_error(public.budget_periods) IS
    'P2A: stable error code when financial mutation is forbidden (closed or past end_date).';

REVOKE ALL ON FUNCTION public.budget_period_financial_mutation_error(public.budget_periods)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_period_financial_mutation_error(public.budget_periods)
    FROM anon;
REVOKE ALL ON FUNCTION public.budget_period_financial_mutation_error(public.budget_periods)
    FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_period_activation_totals(
    p_period_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'authorized_minor', COALESCE((
            SELECT SUM(fs.authorized_amount_minor)::BIGINT
            FROM public.budget_funding_sources AS fs
            WHERE fs.budget_period_id = p_period_id
        ), 0),
        'allocated_current_minor', COALESCE((
            SELECT SUM(b.current_budget_authority_minor)::BIGINT
            FROM public.budget_allocation_balances_v AS b
            WHERE b.budget_period_id = p_period_id
        ), 0),
        'reserve_minor', COALESCE((
            SELECT SUM(v.reserve_minor)::BIGINT
            FROM public.budget_funding_source_balances_v AS v
            WHERE v.budget_period_id = p_period_id
        ), 0)
    );
$$;

REVOKE ALL ON FUNCTION public.budget_period_activation_totals(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_period_activation_totals(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_period_activation_totals(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_build_activation_review_payload(
    p_period public.budget_periods,
    p_institution_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_blockers JSONB := '[]'::JSONB;
    v_warnings JSONB := '[]'::JSONB;
    v_totals JSONB;
    v_authorized BIGINT;
    v_allocated BIGINT;
    v_reserve BIGINT;
    v_active_funding_count INTEGER;
BEGIN
    v_totals := public.budget_period_activation_totals(p_period.id);
    v_authorized := COALESCE((v_totals ->> 'authorized_minor')::BIGINT, 0);
    v_allocated := COALESCE((v_totals ->> 'allocated_current_minor')::BIGINT, 0);
    v_reserve := COALESCE((v_totals ->> 'reserve_minor')::BIGINT, 0);

    IF p_period.status <> 'draft' THEN
        v_blockers := v_blockers || jsonb_build_array('period_not_draft');
    END IF;

    IF CURRENT_DATE < p_period.start_date THEN
        v_blockers := v_blockers || jsonb_build_array('before_start_date');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.budget_periods AS p
        WHERE p.institution_id = p_institution_id
          AND p.status = 'active'
          AND p.id IS DISTINCT FROM p_period.id
    ) THEN
        v_blockers := v_blockers || jsonb_build_array('active_period_exists');
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_active_funding_count
    FROM public.budget_funding_sources AS fs
    WHERE fs.budget_period_id = p_period.id
      AND fs.institution_id = p_institution_id
      AND fs.status = 'active'
      AND fs.authorized_amount_minor > 0;

    IF v_active_funding_count = 0 THEN
        v_blockers := v_blockers || jsonb_build_array('no_authorized_funding');
    END IF;

    IF v_allocated > v_authorized THEN
        v_blockers := v_blockers || jsonb_build_array('financial_invariant_violation');
    END IF;

    IF v_active_funding_count > 0 AND v_reserve > 0 THEN
        v_warnings := v_warnings || jsonb_build_array('unallocated_reserve');
    END IF;

    RETURN jsonb_build_object(
        'period_id', p_period.id,
        'ready', jsonb_array_length(v_blockers) = 0,
        'blockers', v_blockers,
        'warnings', v_warnings,
        'totals', v_totals
    );
END;
$$;

REVOKE ALL ON FUNCTION public.budget_build_activation_review_payload(public.budget_periods, UUID)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_build_activation_review_payload(public.budget_periods, UUID)
    FROM anon;
REVOKE ALL ON FUNCTION public.budget_build_activation_review_payload(public.budget_periods, UUID)
    FROM authenticated;

-- -----------------------------------------------------------------------------
-- create_budget_period_draft
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_budget_period_draft(
    p_name TEXT,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_name TEXT := BTRIM(COALESCE(p_name, ''));
    v_period public.budget_periods%ROWTYPE;
BEGIN
    IF v_actor IS NULL
       OR v_name = ''
       OR LENGTH(v_name) > 200
       OR p_start_date IS NULL
       OR p_end_date IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF p_start_date >= p_end_date THEN
        RETURN public.budget_fail('budget_invalid_dates');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.manage_structure'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    -- Lock order: institution row → all institution periods (UUID ascending) → overlap re-check → insert
    PERFORM public.budget_lock_institution_budget_periods(v_actor_user.institution_id);

    IF public.budget_period_has_overlap(
        v_actor_user.institution_id,
        p_start_date,
        p_end_date,
        NULL
    ) THEN
        RETURN public.budget_fail('budget_period_overlap');
    END IF;

    INSERT INTO public.budget_periods (
        institution_id,
        name,
        start_date,
        end_date,
        status,
        created_by_user_id,
        updated_by_user_id
    )
    VALUES (
        v_actor_user.institution_id,
        v_name,
        p_start_date,
        p_end_date,
        'draft',
        v_actor,
        v_actor
    )
    RETURNING * INTO v_period;

    PERFORM public.budget_write_period_lifecycle_audit(
        v_actor_user.institution_id,
        v_period.id,
        v_actor,
        'period_created',
        jsonb_build_object(
            'name', v_period.name,
            'start_date', v_period.start_date,
            'end_date', v_period.end_date,
            'status', v_period.status
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'period_id', v_period.id,
        'status', v_period.status,
        'name', v_period.name,
        'start_date', v_period.start_date,
        'end_date', v_period.end_date
    );
END;
$$;

COMMENT ON FUNCTION public.create_budget_period_draft(TEXT, DATE, DATE) IS
    'P2A: create Draft budget period. Requires budget.manage_structure. Status is always draft.';

REVOKE ALL ON FUNCTION public.create_budget_period_draft(TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_budget_period_draft(TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_budget_period_draft(TEXT, DATE, DATE) TO authenticated;

-- -----------------------------------------------------------------------------
-- edit_budget_period_draft
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.edit_budget_period_draft(
    p_period_id UUID,
    p_name TEXT DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_name TEXT;
    v_start DATE;
    v_end DATE;
    v_before JSONB;
BEGIN
    IF v_actor IS NULL OR p_period_id IS NULL THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.manage_structure'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    -- Lock order: institution row → all institution periods (UUID ascending) → target re-read → overlap re-check → update
    PERFORM public.budget_lock_institution_budget_periods(v_actor_user.institution_id);

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = p_period_id
      AND institution_id = v_actor_user.institution_id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status <> 'draft' THEN
        RETURN public.budget_fail('budget_period_not_draft');
    END IF;

    v_name := COALESCE(NULLIF(BTRIM(COALESCE(p_name, '')), ''), v_period.name);
    v_start := COALESCE(p_start_date, v_period.start_date);
    v_end := COALESCE(p_end_date, v_period.end_date);

    IF v_name = '' OR LENGTH(v_name) > 200 THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF v_start >= v_end THEN
        RETURN public.budget_fail('budget_invalid_dates');
    END IF;

    IF public.budget_period_has_overlap(
        v_actor_user.institution_id,
        v_start,
        v_end,
        v_period.id
    ) THEN
        RETURN public.budget_fail('budget_period_overlap');
    END IF;

    v_before := jsonb_build_object(
        'name', v_period.name,
        'start_date', v_period.start_date,
        'end_date', v_period.end_date
    );

    UPDATE public.budget_periods
    SET name = v_name,
        start_date = v_start,
        end_date = v_end,
        updated_by_user_id = v_actor
    WHERE id = v_period.id
    RETURNING * INTO v_period;

    PERFORM public.budget_write_period_lifecycle_audit(
        v_actor_user.institution_id,
        v_period.id,
        v_actor,
        'period_metadata_updated',
        jsonb_build_object(
            'before', v_before,
            'after', jsonb_build_object(
                'name', v_period.name,
                'start_date', v_period.start_date,
                'end_date', v_period.end_date
            )
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'period_id', v_period.id,
        'status', v_period.status,
        'name', v_period.name,
        'start_date', v_period.start_date,
        'end_date', v_period.end_date
    );
END;
$$;

COMMENT ON FUNCTION public.edit_budget_period_draft(UUID, TEXT, DATE, DATE) IS
    'P2A: edit Draft period metadata only. Requires budget.manage_structure.';

REVOKE ALL ON FUNCTION public.edit_budget_period_draft(UUID, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_budget_period_draft(UUID, TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_budget_period_draft(UUID, TEXT, DATE, DATE) TO authenticated;

-- -----------------------------------------------------------------------------
-- get_budget_period_activation_review
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_budget_period_activation_review(
    p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_review JSONB;
BEGIN
    IF v_actor IS NULL OR p_period_id IS NULL THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.activate_period'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = p_period_id
      AND institution_id = v_actor_user.institution_id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    v_review := public.budget_build_activation_review_payload(
        v_period,
        v_actor_user.institution_id
    );

    RETURN jsonb_build_object('ok', true) || v_review;
END;
$$;

COMMENT ON FUNCTION public.get_budget_period_activation_review(UUID) IS
    'P2A: advisory activation readiness review. Requires budget.activate_period.';

REVOKE ALL ON FUNCTION public.get_budget_period_activation_review(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_budget_period_activation_review(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_budget_period_activation_review(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- activate_budget_period
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_budget_period(
    p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_review JSONB;
BEGIN
    IF v_actor IS NULL OR p_period_id IS NULL THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.activate_period'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    -- Lock order: institution row → all institution periods (UUID ascending) → target re-check → activate
    PERFORM public.budget_lock_institution_budget_periods(v_actor_user.institution_id);

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = p_period_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status <> 'draft' THEN
        RETURN public.budget_fail('budget_period_not_draft');
    END IF;

    IF CURRENT_DATE < v_period.start_date THEN
        RETURN public.budget_fail('budget_period_before_start');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.budget_periods AS p
        WHERE p.institution_id = v_actor_user.institution_id
          AND p.status = 'active'
          AND p.id IS DISTINCT FROM v_period.id
    ) THEN
        RETURN public.budget_fail('budget_period_active_exists');
    END IF;

    v_review := public.budget_build_activation_review_payload(
        v_period,
        v_actor_user.institution_id
    );

    IF COALESCE((v_review ->> 'ready')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN public.budget_fail('budget_period_activation_blocked');
    END IF;

    UPDATE public.budget_periods
    SET status = 'active',
        activated_at = NOW(),
        activated_by_user_id = v_actor,
        updated_by_user_id = v_actor
    WHERE id = v_period.id
    RETURNING * INTO v_period;

    PERFORM public.budget_write_period_lifecycle_audit(
        v_actor_user.institution_id,
        v_period.id,
        v_actor,
        'period_activated',
        jsonb_build_object(
            'status', v_period.status,
            'activated_at', v_period.activated_at
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'period_id', v_period.id,
        'status', v_period.status,
        'activated_at', v_period.activated_at
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN public.budget_fail('budget_period_active_exists');
END;
$$;

COMMENT ON FUNCTION public.activate_budget_period(UUID) IS
    'P2A: manual Draft → Active activation. Requires budget.activate_period. Does not auto-close other periods.';

REVOKE ALL ON FUNCTION public.activate_budget_period(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_budget_period(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_budget_period(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- close_budget_period
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_budget_period(
    p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
BEGIN
    IF v_actor IS NULL OR p_period_id IS NULL THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.close_period'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = p_period_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status <> 'active' THEN
        RETURN public.budget_fail('budget_period_not_active');
    END IF;

    -- Deferred commitment gate (Phase 2A boundary):
    -- Commitments are not implemented yet. When commitment ledger events exist,
    -- open_commitment_minor > 0 must block closing. Reserve/unallocated authority alone
    -- does NOT block closing.
    IF EXISTS (
        SELECT 1
        FROM public.budget_allocation_balances_v AS b
        WHERE b.budget_period_id = v_period.id
          AND b.open_commitment_minor > 0
    ) THEN
        RETURN public.budget_fail('budget_period_open_commitments');
    END IF;

    UPDATE public.budget_periods
    SET status = 'closed',
        closed_at = NOW(),
        closed_by_user_id = v_actor,
        updated_by_user_id = v_actor
    WHERE id = v_period.id
    RETURNING * INTO v_period;

    PERFORM public.budget_write_period_lifecycle_audit(
        v_actor_user.institution_id,
        v_period.id,
        v_actor,
        'period_closed',
        jsonb_build_object(
            'status', v_period.status,
            'closed_at', v_period.closed_at
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'period_id', v_period.id,
        'status', v_period.status,
        'closed_at', v_period.closed_at
    );
END;
$$;

COMMENT ON FUNCTION public.close_budget_period(UUID) IS
    'P2A: explicit Active → Closed. Requires budget.close_period. Closed is terminal.';

REVOKE ALL ON FUNCTION public.close_budget_period(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_budget_period(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_budget_period(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- list_budget_periods — historical read surface
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_budget_periods()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_periods JSONB := '[]'::JSONB;
BEGIN
    IF v_actor IS NULL THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.view'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'period_id', p.id,
                'name', p.name,
                'start_date', p.start_date,
                'end_date', p.end_date,
                'status', p.status,
                'created_by_user_id', p.created_by_user_id,
                'created_at', p.created_at,
                'updated_by_user_id', p.updated_by_user_id,
                'updated_at', p.updated_at,
                'activated_at', p.activated_at,
                'activated_by_user_id', p.activated_by_user_id,
                'closed_at', p.closed_at,
                'closed_by_user_id', p.closed_by_user_id
            )
            ORDER BY p.start_date DESC, p.created_at DESC
        ),
        '[]'::JSONB
    )
    INTO v_periods
    FROM public.budget_periods AS p
    WHERE p.institution_id = v_actor_user.institution_id;

    RETURN jsonb_build_object(
        'ok', true,
        'periods', v_periods
    );
END;
$$;

COMMENT ON FUNCTION public.list_budget_periods() IS
    'P2A: list institution budget periods (draft/active/closed). Requires budget.view.';

REVOKE ALL ON FUNCTION public.list_budget_periods() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_budget_periods() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_budget_periods() TO authenticated;

-- -----------------------------------------------------------------------------
-- P1C/P1D financial RPCs — forward-only end-date freeze patch
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_initial_budget_allocation(
    p_period_id UUID,
    p_category_id UUID,
    p_amount_minor BIGINT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_category public.budget_categories%ROWTYPE;
    v_source public.budget_funding_sources%ROWTYPE;
    v_allocation public.budget_allocations%ROWTYPE;
    v_existing_op public.budget_financial_operations%ROWTYPE;
    v_existing_ledger public.budget_ledger_entries%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_fingerprint TEXT;
    v_reserve BIGINT;
    v_operation_id UUID;
    v_ledger_id UUID;
    v_constraint TEXT;
    v_fin_err TEXT;
BEGIN
    IF v_actor IS NULL
       OR p_period_id IS NULL
       OR p_category_id IS NULL
       OR v_key = ''
       OR LENGTH(v_key) > 128
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF p_amount_minor IS NULL
       OR p_amount_minor <= 0
       OR p_amount_minor > public.budget_money_business_cap()
    THEN
        RETURN public.budget_fail('budget_invalid_amount');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.allocate_funds'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = p_period_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status = 'closed' THEN
        RETURN public.budget_fail('budget_period_closed');
    END IF;

    IF v_period.status <> 'draft' THEN
        RETURN public.budget_fail('budget_period_not_draft');
    END IF;

    v_fin_err := public.budget_period_financial_mutation_error(v_period);
    IF v_fin_err IS NOT NULL THEN
        RETURN public.budget_fail(v_fin_err);
    END IF;

    SELECT *
    INTO v_category
    FROM public.budget_categories
    WHERE id = p_category_id
      AND institution_id = v_actor_user.institution_id
      AND budget_period_id = v_period.id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF NOT public.budget_category_is_leaf(v_category.id) THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_category.status <> 'active' THEN
        RETURN public.budget_fail('budget_structure_locked');
    END IF;

    SELECT *
    INTO v_source
    FROM public.budget_funding_sources
    WHERE id = v_category.funding_source_id
      AND institution_id = v_actor_user.institution_id
      AND budget_period_id = v_period.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source.status <> 'active' THEN
        RETURN public.budget_fail('budget_structure_locked');
    END IF;

    SELECT *
    INTO v_allocation
    FROM public.budget_allocations
    WHERE budget_period_id = v_period.id
      AND category_id = v_category.id
    FOR UPDATE;

    v_fingerprint := public.budget_fingerprint_initial_allocation(
        v_period.id,
        v_category.id,
        p_amount_minor
    );

    SELECT *
    INTO v_existing_op
    FROM public.budget_financial_operations
    WHERE institution_id = v_actor_user.institution_id
      AND idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'initial_allocation'
           OR v_existing_op.request_fingerprint <> v_fingerprint
        THEN
            RETURN public.budget_fail('budget_duplicate_operation');
        END IF;

        SELECT *
        INTO v_existing_ledger
        FROM public.budget_ledger_entries
        WHERE operation_id = v_existing_op.id
        LIMIT 1;

        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'operation_id', v_existing_op.id,
            'allocation_id', v_existing_ledger.allocation_id,
            'ledger_entry_id', v_existing_ledger.id,
            'amount_minor', v_existing_ledger.amount_minor
        );
    END IF;

    IF v_allocation.id IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM public.budget_ledger_entries AS le
           WHERE le.allocation_id = v_allocation.id
             AND le.financial_dimension = 'budget_authority'
             AND le.event_type = 'initial_allocation'
       )
    THEN
        RETURN public.budget_fail('budget_initial_allocation_exists');
    END IF;

    v_reserve := public.budget_funding_source_reserve_minor(v_source.id);
    IF v_reserve IS NULL OR p_amount_minor > v_reserve THEN
        RETURN public.budget_fail('budget_insufficient_available');
    END IF;

    IF v_allocation.id IS NULL THEN
        BEGIN
            INSERT INTO public.budget_allocations (
                institution_id,
                budget_period_id,
                funding_source_id,
                category_id,
                created_by_user_id
            )
            VALUES (
                v_actor_user.institution_id,
                v_period.id,
                v_source.id,
                v_category.id,
                v_actor
            )
            RETURNING * INTO v_allocation;
        EXCEPTION
            WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

                IF v_constraint IS DISTINCT FROM 'budget_allocations_period_category_unique' THEN
                    RAISE;
                END IF;

                SELECT *
                INTO v_allocation
                FROM public.budget_allocations
                WHERE budget_period_id = v_period.id
                  AND category_id = v_category.id
                FOR UPDATE;

                IF NOT FOUND
                   OR v_allocation.institution_id IS DISTINCT FROM v_actor_user.institution_id
                   OR v_allocation.budget_period_id IS DISTINCT FROM v_period.id
                   OR v_allocation.funding_source_id IS DISTINCT FROM v_source.id
                   OR v_allocation.category_id IS DISTINCT FROM v_category.id
                THEN
                    RAISE;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM public.budget_ledger_entries AS le
                    WHERE le.allocation_id = v_allocation.id
                      AND le.financial_dimension = 'budget_authority'
                      AND le.event_type = 'initial_allocation'
                ) THEN
                    RETURN public.budget_fail('budget_initial_allocation_exists');
                END IF;
        END;
    END IF;

    BEGIN
        INSERT INTO public.budget_financial_operations (
            institution_id,
            budget_period_id,
            operation_type,
            idempotency_key,
            request_fingerprint,
            actor_user_id,
            reason,
            metadata
        )
        VALUES (
            v_actor_user.institution_id,
            v_period.id,
            'initial_allocation',
            v_key,
            v_fingerprint,
            v_actor,
            NULL,
            jsonb_build_object(
                'allocation_id', v_allocation.id,
                'category_id', v_category.id,
                'amount_minor', p_amount_minor
            )
        )
        RETURNING id INTO v_operation_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT *
            INTO v_existing_op
            FROM public.budget_financial_operations
            WHERE institution_id = v_actor_user.institution_id
              AND idempotency_key = v_key;

            IF NOT FOUND
               OR v_existing_op.operation_type <> 'initial_allocation'
               OR v_existing_op.request_fingerprint <> v_fingerprint
            THEN
                RETURN public.budget_fail('budget_duplicate_operation');
            END IF;

            SELECT *
            INTO v_existing_ledger
            FROM public.budget_ledger_entries
            WHERE operation_id = v_existing_op.id
            LIMIT 1;

            RETURN jsonb_build_object(
                'ok', true,
                'duplicate', true,
                'operation_id', v_existing_op.id,
                'allocation_id', v_existing_ledger.allocation_id,
                'ledger_entry_id', v_existing_ledger.id,
                'amount_minor', v_existing_ledger.amount_minor
            );
    END;

    BEGIN
        INSERT INTO public.budget_ledger_entries (
            institution_id,
            budget_period_id,
            operation_id,
            allocation_id,
            financial_dimension,
            event_type,
            amount_minor,
            actor_user_id
        )
        VALUES (
            v_actor_user.institution_id,
            v_period.id,
            v_operation_id,
            v_allocation.id,
            'budget_authority',
            'initial_allocation',
            p_amount_minor,
            v_actor
        )
        RETURNING id INTO v_ledger_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN public.budget_fail('budget_initial_allocation_exists');
    END;

    RETURN jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'operation_id', v_operation_id,
        'allocation_id', v_allocation.id,
        'ledger_entry_id', v_ledger_id,
        'amount_minor', p_amount_minor
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_budget_allocation(
    p_allocation_id UUID,
    p_delta_minor BIGINT,
    p_reason TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_category public.budget_categories%ROWTYPE;
    v_source public.budget_funding_sources%ROWTYPE;
    v_allocation public.budget_allocations%ROWTYPE;
    v_existing_op public.budget_financial_operations%ROWTYPE;
    v_existing_ledger public.budget_ledger_entries%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_reason TEXT := BTRIM(COALESCE(p_reason, ''));
    v_fingerprint TEXT;
    v_current BIGINT;
    v_reserve BIGINT;
    v_operation_id UUID;
    v_ledger_id UUID;
    v_fin_err TEXT;
BEGIN
    IF v_actor IS NULL
       OR p_allocation_id IS NULL
       OR v_key = ''
       OR LENGTH(v_key) > 128
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF v_reason = '' THEN
        RETURN public.budget_fail('budget_invalid_amount');
    END IF;

    IF p_delta_minor IS NULL
       OR p_delta_minor = 0
       OR p_delta_minor < -9999999999999
       OR p_delta_minor > public.budget_money_business_cap()
    THEN
        RETURN public.budget_fail('budget_invalid_amount');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.allocate_funds'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_allocation
    FROM public.budget_allocations
    WHERE id = p_allocation_id
      AND institution_id = v_actor_user.institution_id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = v_allocation.budget_period_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status = 'closed' THEN
        RETURN public.budget_fail('budget_period_closed');
    END IF;

    IF v_period.status NOT IN ('draft', 'active') THEN
        RETURN public.budget_fail('budget_period_closed');
    END IF;

    v_fin_err := public.budget_period_financial_mutation_error(v_period);
    IF v_fin_err IS NOT NULL THEN
        RETURN public.budget_fail(v_fin_err);
    END IF;

    SELECT *
    INTO v_source
    FROM public.budget_funding_sources
    WHERE id = v_allocation.funding_source_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_allocation
    FROM public.budget_allocations
    WHERE id = p_allocation_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_category
    FROM public.budget_categories
    WHERE id = v_allocation.category_id
      AND institution_id = v_actor_user.institution_id
      AND budget_period_id = v_period.id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_category.status <> 'active' OR v_source.status <> 'active' THEN
        RETURN public.budget_fail('budget_structure_locked');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = v_allocation.id
          AND le.financial_dimension = 'budget_authority'
          AND le.event_type = 'initial_allocation'
    ) THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    v_fingerprint := public.budget_fingerprint_allocation_adjustment(
        v_allocation.id,
        p_delta_minor,
        v_reason
    );

    SELECT *
    INTO v_existing_op
    FROM public.budget_financial_operations
    WHERE institution_id = v_actor_user.institution_id
      AND idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'allocation_adjustment'
           OR v_existing_op.request_fingerprint <> v_fingerprint
        THEN
            RETURN public.budget_fail('budget_duplicate_operation');
        END IF;

        SELECT *
        INTO v_existing_ledger
        FROM public.budget_ledger_entries
        WHERE operation_id = v_existing_op.id
        LIMIT 1;

        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'operation_id', v_existing_op.id,
            'allocation_id', v_existing_ledger.allocation_id,
            'ledger_entry_id', v_existing_ledger.id,
            'delta_minor', v_existing_ledger.amount_minor
        );
    END IF;

    v_current := public.budget_allocation_current_authority_minor(v_allocation.id);
    v_reserve := public.budget_funding_source_reserve_minor(v_source.id);

    IF p_delta_minor > 0 THEN
        IF v_reserve IS NULL OR p_delta_minor > v_reserve THEN
            RETURN public.budget_fail('budget_insufficient_available');
        END IF;
    ELSE
        IF (v_current + p_delta_minor) < 0 THEN
            RETURN public.budget_fail('budget_insufficient_available');
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.budget_financial_operations (
            institution_id,
            budget_period_id,
            operation_type,
            idempotency_key,
            request_fingerprint,
            actor_user_id,
            reason,
            metadata
        )
        VALUES (
            v_actor_user.institution_id,
            v_period.id,
            'allocation_adjustment',
            v_key,
            v_fingerprint,
            v_actor,
            v_reason,
            jsonb_build_object(
                'allocation_id', v_allocation.id,
                'delta_minor', p_delta_minor
            )
        )
        RETURNING id INTO v_operation_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT *
            INTO v_existing_op
            FROM public.budget_financial_operations
            WHERE institution_id = v_actor_user.institution_id
              AND idempotency_key = v_key;

            IF NOT FOUND
               OR v_existing_op.operation_type <> 'allocation_adjustment'
               OR v_existing_op.request_fingerprint <> v_fingerprint
            THEN
                RETURN public.budget_fail('budget_duplicate_operation');
            END IF;

            SELECT *
            INTO v_existing_ledger
            FROM public.budget_ledger_entries
            WHERE operation_id = v_existing_op.id
            LIMIT 1;

            RETURN jsonb_build_object(
                'ok', true,
                'duplicate', true,
                'operation_id', v_existing_op.id,
                'allocation_id', v_existing_ledger.allocation_id,
                'ledger_entry_id', v_existing_ledger.id,
                'delta_minor', v_existing_ledger.amount_minor
            );
    END;

    INSERT INTO public.budget_ledger_entries (
        institution_id,
        budget_period_id,
        operation_id,
        allocation_id,
        financial_dimension,
        event_type,
        amount_minor,
        actor_user_id
    )
    VALUES (
        v_actor_user.institution_id,
        v_period.id,
        v_operation_id,
        v_allocation.id,
        'budget_authority',
        'allocation_adjustment',
        p_delta_minor,
        v_actor
    )
    RETURNING id INTO v_ledger_id;

    RETURN jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'operation_id', v_operation_id,
        'allocation_id', v_allocation.id,
        'ledger_entry_id', v_ledger_id,
        'delta_minor', p_delta_minor
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_budget_authority(
    p_source_allocation_id UUID,
    p_destination_allocation_id UUID,
    p_amount_minor BIGINT,
    p_reason TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_source_category public.budget_categories%ROWTYPE;
    v_dest_category public.budget_categories%ROWTYPE;
    v_source_fs public.budget_funding_sources%ROWTYPE;
    v_source public.budget_allocations%ROWTYPE;
    v_dest public.budget_allocations%ROWTYPE;
    v_lock_first public.budget_allocations%ROWTYPE;
    v_lock_second public.budget_allocations%ROWTYPE;
    v_first_id UUID;
    v_second_id UUID;
    v_existing_op public.budget_financial_operations%ROWTYPE;
    v_out_ledger public.budget_ledger_entries%ROWTYPE;
    v_in_ledger public.budget_ledger_entries%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_reason TEXT := BTRIM(COALESCE(p_reason, ''));
    v_fingerprint TEXT;
    v_available BIGINT;
    v_source_current BIGINT;
    v_dest_current BIGINT;
    v_operation_id UUID;
    v_fin_err TEXT;
BEGIN
    IF v_actor IS NULL
       OR p_source_allocation_id IS NULL
       OR p_destination_allocation_id IS NULL
       OR v_key = ''
       OR LENGTH(v_key) > 128
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF v_reason = '' THEN
        RETURN public.budget_fail('budget_invalid_amount');
    END IF;

    IF p_amount_minor IS NULL
       OR p_amount_minor <= 0
       OR p_amount_minor > public.budget_money_business_cap()
    THEN
        RETURN public.budget_fail('budget_invalid_amount');
    END IF;

    IF p_source_allocation_id = p_destination_allocation_id THEN
        RETURN public.budget_fail('budget_transfer_same_allocation');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.transfer_funds'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_source
    FROM public.budget_allocations
    WHERE id = p_source_allocation_id
      AND institution_id = v_actor_user.institution_id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_dest
    FROM public.budget_allocations
    WHERE id = p_destination_allocation_id
      AND institution_id = v_actor_user.institution_id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source.budget_period_id IS DISTINCT FROM v_dest.budget_period_id THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source.funding_source_id IS DISTINCT FROM v_dest.funding_source_id THEN
        RETURN public.budget_fail('budget_transfer_cross_source_forbidden');
    END IF;

    SELECT *
    INTO v_period
    FROM public.budget_periods
    WHERE id = v_source.budget_period_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_period.status = 'closed' THEN
        RETURN public.budget_fail('budget_period_closed');
    END IF;

    IF v_period.status NOT IN ('draft', 'active') THEN
        RETURN public.budget_fail('budget_period_closed');
    END IF;

    v_fin_err := public.budget_period_financial_mutation_error(v_period);
    IF v_fin_err IS NOT NULL THEN
        RETURN public.budget_fail(v_fin_err);
    END IF;

    SELECT *
    INTO v_source_fs
    FROM public.budget_funding_sources
    WHERE id = v_source.funding_source_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source_fs.status <> 'active' THEN
        RETURN public.budget_fail('budget_structure_locked');
    END IF;

    IF p_source_allocation_id < p_destination_allocation_id THEN
        v_first_id := p_source_allocation_id;
        v_second_id := p_destination_allocation_id;
    ELSE
        v_first_id := p_destination_allocation_id;
        v_second_id := p_source_allocation_id;
    END IF;

    SELECT *
    INTO v_lock_first
    FROM public.budget_allocations
    WHERE id = v_first_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_lock_second
    FROM public.budget_allocations
    WHERE id = v_second_id
      AND institution_id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_lock_first.id = p_source_allocation_id THEN
        v_source := v_lock_first;
        v_dest := v_lock_second;
    ELSE
        v_source := v_lock_second;
        v_dest := v_lock_first;
    END IF;

    IF v_source.budget_period_id IS DISTINCT FROM v_dest.budget_period_id
       OR v_source.budget_period_id IS DISTINCT FROM v_period.id
    THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source.funding_source_id IS DISTINCT FROM v_dest.funding_source_id
       OR v_source.funding_source_id IS DISTINCT FROM v_source_fs.id
    THEN
        RETURN public.budget_fail('budget_transfer_cross_source_forbidden');
    END IF;

    SELECT *
    INTO v_source_category
    FROM public.budget_categories
    WHERE id = v_source.category_id
      AND institution_id = v_actor_user.institution_id
      AND budget_period_id = v_period.id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    SELECT *
    INTO v_dest_category
    FROM public.budget_categories
    WHERE id = v_dest.category_id
      AND institution_id = v_actor_user.institution_id
      AND budget_period_id = v_period.id;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_not_found');
    END IF;

    IF v_source_category.status <> 'active'
       OR v_dest_category.status <> 'active'
    THEN
        RETURN public.budget_fail('budget_structure_locked');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = v_source.id
          AND le.financial_dimension = 'budget_authority'
          AND le.event_type = 'initial_allocation'
    ) THEN
        RETURN public.budget_fail('budget_transfer_source_not_initialized');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = v_dest.id
          AND le.financial_dimension = 'budget_authority'
          AND le.event_type = 'initial_allocation'
    ) THEN
        RETURN public.budget_fail('budget_transfer_destination_not_initialized');
    END IF;

    v_fingerprint := public.budget_fingerprint_budget_transfer(
        v_source.id,
        v_dest.id,
        p_amount_minor,
        v_reason
    );

    SELECT *
    INTO v_existing_op
    FROM public.budget_financial_operations
    WHERE institution_id = v_actor_user.institution_id
      AND idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'budget_transfer'
           OR v_existing_op.request_fingerprint <> v_fingerprint
        THEN
            RETURN public.budget_fail('budget_duplicate_operation');
        END IF;

        SELECT *
        INTO v_out_ledger
        FROM public.budget_ledger_entries
        WHERE operation_id = v_existing_op.id
          AND event_type = 'transfer_out';

        SELECT *
        INTO v_in_ledger
        FROM public.budget_ledger_entries
        WHERE operation_id = v_existing_op.id
          AND event_type = 'transfer_in';

        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'operation_id', v_existing_op.id,
            'source_allocation_id', v_out_ledger.allocation_id,
            'destination_allocation_id', v_in_ledger.allocation_id,
            'amount_minor', p_amount_minor,
            'transfer_out_ledger_entry_id', v_out_ledger.id,
            'transfer_in_ledger_entry_id', v_in_ledger.id
        );
    END IF;

    v_available := public.budget_allocation_available_minor(v_source.id);
    IF v_available IS NULL OR p_amount_minor > v_available THEN
        RETURN public.budget_fail('budget_insufficient_available');
    END IF;

    v_source_current := public.budget_allocation_current_authority_minor(v_source.id);
    v_dest_current := public.budget_allocation_current_authority_minor(v_dest.id);
    IF v_source_current IS NULL
       OR (v_source_current - p_amount_minor) < 0
       OR v_dest_current IS NULL
       OR (v_dest_current + p_amount_minor) < 0
    THEN
        RETURN public.budget_fail('budget_insufficient_available');
    END IF;

    BEGIN
        INSERT INTO public.budget_financial_operations (
            institution_id,
            budget_period_id,
            operation_type,
            idempotency_key,
            request_fingerprint,
            actor_user_id,
            reason,
            metadata
        )
        VALUES (
            v_actor_user.institution_id,
            v_period.id,
            'budget_transfer',
            v_key,
            v_fingerprint,
            v_actor,
            v_reason,
            jsonb_build_object(
                'source_allocation_id', v_source.id,
                'destination_allocation_id', v_dest.id,
                'amount_minor', p_amount_minor
            )
        )
        RETURNING id INTO v_operation_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT *
            INTO v_existing_op
            FROM public.budget_financial_operations
            WHERE institution_id = v_actor_user.institution_id
              AND idempotency_key = v_key;

            IF NOT FOUND
               OR v_existing_op.operation_type <> 'budget_transfer'
               OR v_existing_op.request_fingerprint <> v_fingerprint
            THEN
                RETURN public.budget_fail('budget_duplicate_operation');
            END IF;

            SELECT *
            INTO v_out_ledger
            FROM public.budget_ledger_entries
            WHERE operation_id = v_existing_op.id
              AND event_type = 'transfer_out';

            SELECT *
            INTO v_in_ledger
            FROM public.budget_ledger_entries
            WHERE operation_id = v_existing_op.id
              AND event_type = 'transfer_in';

            RETURN jsonb_build_object(
                'ok', true,
                'duplicate', true,
                'operation_id', v_existing_op.id,
                'source_allocation_id', v_out_ledger.allocation_id,
                'destination_allocation_id', v_in_ledger.allocation_id,
                'amount_minor', p_amount_minor,
                'transfer_out_ledger_entry_id', v_out_ledger.id,
                'transfer_in_ledger_entry_id', v_in_ledger.id
            );
    END;

    INSERT INTO public.budget_ledger_entries (
        institution_id,
        budget_period_id,
        operation_id,
        allocation_id,
        financial_dimension,
        event_type,
        amount_minor,
        actor_user_id
    )
    VALUES
        (
            v_actor_user.institution_id,
            v_period.id,
            v_operation_id,
            v_source.id,
            'budget_authority',
            'transfer_out',
            -p_amount_minor,
            v_actor
        ),
        (
            v_actor_user.institution_id,
            v_period.id,
            v_operation_id,
            v_dest.id,
            'budget_authority',
            'transfer_in',
            p_amount_minor,
            v_actor
        );

    SELECT *
    INTO v_out_ledger
    FROM public.budget_ledger_entries
    WHERE operation_id = v_operation_id
      AND event_type = 'transfer_out';

    SELECT *
    INTO v_in_ledger
    FROM public.budget_ledger_entries
    WHERE operation_id = v_operation_id
      AND event_type = 'transfer_in';

    RETURN jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'operation_id', v_operation_id,
        'source_allocation_id', v_source.id,
        'destination_allocation_id', v_dest.id,
        'amount_minor', p_amount_minor,
        'transfer_out_ledger_entry_id', v_out_ledger.id,
        'transfer_in_ledger_entry_id', v_in_ledger.id
    );
END;
$$;

COMMENT ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) IS
    'P1C+P2A: once-per-allocation initial budget_authority. P2A adds end-date financial freeze.';

REVOKE ALL ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) IS
    'P1C+P2A: allocation_adjustment on budget_authority. P2A adds end-date financial freeze.';

REVOKE ALL ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) IS
    'P1D+P2A: intra-source budget_authority transfer. P2A adds end-date financial freeze.';

REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- P2A function EXECUTE security matrix
-- -----------------------------------------------------------------------------
-- Client EXECUTE YES (authenticated only):
--   create_budget_period_draft
--   edit_budget_period_draft
--   get_budget_period_activation_review
--   activate_budget_period
--   close_budget_period
--   list_budget_periods
--   set_initial_budget_allocation (patched)
--   adjust_budget_allocation (patched)
--   transfer_budget_authority (patched)
-- Internal / no client EXECUTE:
--   budget_write_period_lifecycle_audit
--   budget_lock_institution_budget_periods
--   budget_period_has_overlap
--   budget_period_financial_mutation_error
--   budget_period_activation_totals
--   budget_build_activation_review_payload
--   enforce_budget_period_no_overlap
--   enforce_budget_period_lifecycle_immutability
--   budget_period_lifecycle_audit_reject_mutation
-- PUBLIC = NO, anon = NO
--
-- Stable error codes introduced/used by P2A:
--   budget_invalid_dates
--   budget_period_overlap
--   budget_period_before_start
--   budget_period_active_exists
--   budget_period_activation_blocked
--   budget_period_ended
--   budget_period_open_commitments (deferred commitment gate; zero rows block today)
