-- =============================================================================
-- MPEX — School Budget Management Phase 1C: Allocations + Ledger Foundation
-- =============================================================================
-- Forward-only. Authoritative budget_authority only.
-- Does NOT implement: transfers, commitments, expenses, receipts, P1D RPCs.
-- Does NOT touch public.requests or Phase 3 quotation/PDF work.
-- Does NOT edit applied P1A/P1B migrations.
--
-- Depends on:
--   P1A 20250821120000_budget_phase1a_configuration_schema.sql
--   P1B 20250821121000_budget_phase1b_permission_foundation.sql
--
-- Fingerprint hashing uses extensions.digest (pgcrypto on Supabase;
-- config.toml extra_search_path includes extensions).

-- -----------------------------------------------------------------------------
-- Constants / helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_money_business_cap()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT 9999999999999::BIGINT;
$$;

COMMENT ON FUNCTION public.budget_money_business_cap() IS
    'P1C: ILS minor-unit business cap (9_999_999_999_999).';

REVOKE ALL ON FUNCTION public.budget_money_business_cap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_money_business_cap() FROM anon;
REVOKE ALL ON FUNCTION public.budget_money_business_cap() FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_sha256_hex(p_canonical TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT encode(digest(convert_to(p_canonical, 'UTF8'), 'sha256'), 'hex');
$$;

COMMENT ON FUNCTION public.budget_sha256_hex(TEXT) IS
    'P1C: SHA-256 hex of UTF-8 canonical fingerprint text via pgcrypto digest().';

REVOKE ALL ON FUNCTION public.budget_sha256_hex(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_sha256_hex(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_sha256_hex(TEXT) FROM authenticated;

-- -----------------------------------------------------------------------------
-- budget_allocations — stable leaf bucket identity (no money columns)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_allocations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id    UUID        NOT NULL,
    funding_source_id   UUID        NOT NULL,
    category_id         UUID        NOT NULL,
    created_by_user_id  UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_allocations_period_institution_fk
        FOREIGN KEY (budget_period_id, institution_id)
        REFERENCES public.budget_periods (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_allocations_funding_source_scope_fk
        FOREIGN KEY (funding_source_id, budget_period_id, institution_id)
        REFERENCES public.budget_funding_sources (id, budget_period_id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_allocations_category_institution_fk
        FOREIGN KEY (category_id, institution_id)
        REFERENCES public.budget_categories (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_allocations_id_institution_unique
        UNIQUE (id, institution_id),
    CONSTRAINT budget_allocations_id_period_institution_unique
        UNIQUE (id, budget_period_id, institution_id),
    CONSTRAINT budget_allocations_period_category_unique
        UNIQUE (budget_period_id, category_id)
);

COMMENT ON TABLE public.budget_allocations IS
    'Stable Budget leaf allocation identity (P1C). Money lives only in ledger entries.';

CREATE INDEX idx_budget_allocations_budget_period_id
    ON public.budget_allocations (budget_period_id);

CREATE INDEX idx_budget_allocations_funding_source_id
    ON public.budget_allocations (funding_source_id);

CREATE INDEX idx_budget_allocations_category_id
    ON public.budget_allocations (category_id);

CREATE OR REPLACE FUNCTION public.enforce_budget_allocation_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_category public.budget_categories%ROWTYPE;
    v_has_child BOOLEAN;
BEGIN
    SELECT *
    INTO v_category
    FROM public.budget_categories
    WHERE id = NEW.category_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.institution_id IS DISTINCT FROM v_category.institution_id
       OR NEW.budget_period_id IS DISTINCT FROM v_category.budget_period_id
       OR NEW.funding_source_id IS DISTINCT FROM v_category.funding_source_id
    THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.budget_categories AS c
        WHERE c.parent_category_id = NEW.category_id
    )
    INTO v_has_child;

    IF v_has_child THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_allocation_scope() IS
    'P1C: allocation must target a leaf category with matching period/source/institution.';

REVOKE ALL ON FUNCTION public.enforce_budget_allocation_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_allocation_scope() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_allocation_scope() FROM authenticated;

DROP TRIGGER IF EXISTS budget_allocations_enforce_scope ON public.budget_allocations;
CREATE TRIGGER budget_allocations_enforce_scope
    BEFORE INSERT OR UPDATE OF institution_id, budget_period_id, funding_source_id, category_id
    ON public.budget_allocations
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_allocation_scope();

-- -----------------------------------------------------------------------------
-- Leaf-stability: parent with allocation/history cannot gain first child
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_budget_category_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_parent public.budget_categories%ROWTYPE;
    v_parent_locked BOOLEAN;
BEGIN
    IF NEW.parent_category_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT *
    INTO v_parent
    FROM public.budget_categories
    WHERE id = NEW.parent_category_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid parent category.'
            USING ERRCODE = '23503';
    END IF;

    IF v_parent.parent_category_id IS NOT NULL THEN
        RAISE EXCEPTION 'Budget category hierarchy cannot exceed two levels.'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.institution_id IS DISTINCT FROM v_parent.institution_id
       OR NEW.budget_period_id IS DISTINCT FROM v_parent.budget_period_id
       OR NEW.funding_source_id IS DISTINCT FROM v_parent.funding_source_id
    THEN
        RAISE EXCEPTION 'Child category must match parent institution, period, and funding source.'
            USING ERRCODE = '23514';
    END IF;

    -- P1C leaf-stability: allocation or financial history on parent locks structure.
    SELECT EXISTS (
        SELECT 1
        FROM public.budget_allocations AS a
        WHERE a.category_id = NEW.parent_category_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.budget_ledger_entries AS le
        INNER JOIN public.budget_allocations AS a
            ON a.id = le.allocation_id
        WHERE a.category_id = NEW.parent_category_id
    )
    INTO v_parent_locked;

    IF v_parent_locked THEN
        RAISE EXCEPTION 'budget_structure_locked'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_category_hierarchy() IS
    'P1A depth/scope + P1C leaf-stability (budget_structure_locked). SECURITY INVOKER, fixed search_path.';

REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM authenticated;

-- -----------------------------------------------------------------------------
-- budget_financial_operations — immutable command log
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_financial_operations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id    UUID        NOT NULL,
    operation_type      TEXT        NOT NULL,
    idempotency_key     TEXT        NOT NULL,
    request_fingerprint TEXT        NOT NULL,
    actor_user_id       UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    reason              TEXT,
    metadata            JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_financial_operations_period_institution_fk
        FOREIGN KEY (budget_period_id, institution_id)
        REFERENCES public.budget_periods (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_financial_operations_type_valid
        CHECK (operation_type IN ('initial_allocation', 'allocation_adjustment')),
    CONSTRAINT budget_financial_operations_idempotency_key_not_blank
        CHECK (BTRIM(idempotency_key) <> ''),
    CONSTRAINT budget_financial_operations_idempotency_key_length
        CHECK (char_length(idempotency_key) <= 128),
    CONSTRAINT budget_financial_operations_fingerprint_sha256
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT budget_financial_operations_institution_idempotency_unique
        UNIQUE (institution_id, idempotency_key),
    CONSTRAINT budget_financial_operations_adjustment_reason_required
        CHECK (
            operation_type <> 'allocation_adjustment'
            OR (reason IS NOT NULL AND BTRIM(reason) <> '')
        )
);

COMMENT ON TABLE public.budget_financial_operations IS
    'Immutable Budget financial command log (P1C). Fingerprint is server-generated.';

CREATE INDEX idx_budget_financial_operations_period_created_at
    ON public.budget_financial_operations (budget_period_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.budget_financial_operations_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'budget_financial_operations is append-only'
        USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.budget_financial_operations_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_financial_operations_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.budget_financial_operations_reject_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS budget_financial_operations_no_update ON public.budget_financial_operations;
CREATE TRIGGER budget_financial_operations_no_update
    BEFORE UPDATE ON public.budget_financial_operations
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_financial_operations_reject_mutation();

DROP TRIGGER IF EXISTS budget_financial_operations_no_delete ON public.budget_financial_operations;
CREATE TRIGGER budget_financial_operations_no_delete
    BEFORE DELETE ON public.budget_financial_operations
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_financial_operations_reject_mutation();

-- -----------------------------------------------------------------------------
-- budget_ledger_entries — append-only monetary journal
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_ledger_entries (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id          UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id        UUID        NOT NULL,
    operation_id            UUID        NOT NULL
        REFERENCES public.budget_financial_operations (id) ON DELETE RESTRICT,
    allocation_id           UUID        NOT NULL,
    financial_dimension     TEXT        NOT NULL,
    event_type              TEXT        NOT NULL,
    amount_minor            BIGINT      NOT NULL,
    actor_user_id           UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_type          TEXT,
    reference_id            UUID,
    metadata                JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_ledger_entries_period_institution_fk
        FOREIGN KEY (budget_period_id, institution_id)
        REFERENCES public.budget_periods (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_ledger_entries_allocation_scope_fk
        FOREIGN KEY (allocation_id, budget_period_id, institution_id)
        REFERENCES public.budget_allocations (id, budget_period_id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_ledger_entries_dimension_valid
        CHECK (financial_dimension IN ('budget_authority', 'commitment', 'actual_expense')),
    CONSTRAINT budget_ledger_entries_event_dimension_match
        CHECK (
            (
                financial_dimension = 'budget_authority'
                AND event_type IN ('initial_allocation', 'allocation_adjustment')
            )
            -- commitment / actual_expense event types reserved for later phases
        ),
    CONSTRAINT budget_ledger_entries_amount_nonzero
        CHECK (amount_minor <> 0),
    CONSTRAINT budget_ledger_entries_amount_cap
        CHECK (
            amount_minor BETWEEN -9999999999999 AND 9999999999999
        )
);

COMMENT ON TABLE public.budget_ledger_entries IS
    'Append-only Budget ledger (P1C). P1C writes budget_authority only.';

COMMENT ON COLUMN public.budget_ledger_entries.financial_dimension IS
    'Explicit financial dimension. Available is never stored.';

COMMENT ON COLUMN public.budget_ledger_entries.amount_minor IS
    'ILS minor units BIGINT. Positive credits authority; negative debits.';

CREATE UNIQUE INDEX idx_budget_ledger_one_initial_per_allocation
    ON public.budget_ledger_entries (allocation_id)
    WHERE financial_dimension = 'budget_authority'
      AND event_type = 'initial_allocation';

CREATE INDEX idx_budget_ledger_entries_allocation_dimension
    ON public.budget_ledger_entries (allocation_id, financial_dimension);

CREATE INDEX idx_budget_ledger_entries_period_dimension
    ON public.budget_ledger_entries (budget_period_id, financial_dimension);

CREATE INDEX idx_budget_ledger_entries_operation_id
    ON public.budget_ledger_entries (operation_id);

CREATE OR REPLACE FUNCTION public.budget_ledger_entries_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'budget_ledger_entries is append-only'
        USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.budget_ledger_entries_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_ledger_entries_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.budget_ledger_entries_reject_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS budget_ledger_entries_no_update ON public.budget_ledger_entries;
CREATE TRIGGER budget_ledger_entries_no_update
    BEFORE UPDATE ON public.budget_ledger_entries
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_ledger_entries_reject_mutation();

DROP TRIGGER IF EXISTS budget_ledger_entries_no_delete ON public.budget_ledger_entries;
CREATE TRIGGER budget_ledger_entries_no_delete
    BEFORE DELETE ON public.budget_ledger_entries
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_ledger_entries_reject_mutation();

CREATE OR REPLACE FUNCTION public.enforce_budget_ledger_operation_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_op public.budget_financial_operations%ROWTYPE;
BEGIN
    SELECT *
    INTO v_op
    FROM public.budget_financial_operations
    WHERE id = NEW.operation_id;

    IF NOT FOUND
       OR v_op.institution_id IS DISTINCT FROM NEW.institution_id
       OR v_op.budget_period_id IS DISTINCT FROM NEW.budget_period_id
    THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.actor_user_id IS DISTINCT FROM v_op.actor_user_id THEN
        RAISE EXCEPTION 'budget_permission_denied'
            USING ERRCODE = 'P0001';
    END IF;

    IF (NEW.event_type = 'initial_allocation' AND v_op.operation_type <> 'initial_allocation')
       OR (NEW.event_type = 'allocation_adjustment' AND v_op.operation_type <> 'allocation_adjustment')
    THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_budget_ledger_operation_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_ledger_operation_scope() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_ledger_operation_scope() FROM authenticated;

DROP TRIGGER IF EXISTS budget_ledger_entries_enforce_operation_scope ON public.budget_ledger_entries;
CREATE TRIGGER budget_ledger_entries_enforce_operation_scope
    BEFORE INSERT ON public.budget_ledger_entries
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_ledger_operation_scope();

-- -----------------------------------------------------------------------------
-- Internal balance projections (no client grants)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.budget_allocation_balances_v
WITH (security_invoker = true)
AS
SELECT
    a.id AS allocation_id,
    a.institution_id,
    a.budget_period_id,
    a.funding_source_id,
    a.category_id,
    COALESCE((
        SELECT SUM(le.amount_minor)
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = a.id
          AND le.financial_dimension = 'budget_authority'
          AND le.event_type = 'initial_allocation'
    ), 0)::BIGINT AS original_budget_authority_minor,
    COALESCE((
        SELECT SUM(le.amount_minor)
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = a.id
          AND le.financial_dimension = 'budget_authority'
    ), 0)::BIGINT AS current_budget_authority_minor,
    COALESCE((
        SELECT SUM(le.amount_minor)
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = a.id
          AND le.financial_dimension = 'commitment'
    ), 0)::BIGINT AS open_commitment_minor,
    COALESCE((
        SELECT SUM(le.amount_minor)
        FROM public.budget_ledger_entries AS le
        WHERE le.allocation_id = a.id
          AND le.financial_dimension = 'actual_expense'
    ), 0)::BIGINT AS actual_expense_minor,
    (
        COALESCE((
            SELECT SUM(le.amount_minor)
            FROM public.budget_ledger_entries AS le
            WHERE le.allocation_id = a.id
              AND le.financial_dimension = 'budget_authority'
        ), 0)
        - COALESCE((
            SELECT SUM(le.amount_minor)
            FROM public.budget_ledger_entries AS le
            WHERE le.allocation_id = a.id
              AND le.financial_dimension = 'commitment'
        ), 0)
        - COALESCE((
            SELECT SUM(le.amount_minor)
            FROM public.budget_ledger_entries AS le
            WHERE le.allocation_id = a.id
              AND le.financial_dimension = 'actual_expense'
        ), 0)
    )::BIGINT AS available_minor
FROM public.budget_allocations AS a;

COMMENT ON VIEW public.budget_allocation_balances_v IS
    'Internal P1C allocation balances. No authenticated SELECT.';

CREATE OR REPLACE VIEW public.budget_funding_source_balances_v
WITH (security_invoker = true)
AS
SELECT
    fs.id AS funding_source_id,
    fs.institution_id,
    fs.budget_period_id,
    fs.authorized_amount_minor AS authorized_minor,
    COALESCE((
        SELECT SUM(b.current_budget_authority_minor)
        FROM public.budget_allocation_balances_v AS b
        WHERE b.funding_source_id = fs.id
    ), 0)::BIGINT AS allocated_current_minor,
    (
        fs.authorized_amount_minor
        - COALESCE((
            SELECT SUM(b.current_budget_authority_minor)
            FROM public.budget_allocation_balances_v AS b
            WHERE b.funding_source_id = fs.id
        ), 0)
    )::BIGINT AS reserve_minor
FROM public.budget_funding_sources AS fs;

COMMENT ON VIEW public.budget_funding_source_balances_v IS
    'Internal P1C funding-source reserve projection. No authenticated SELECT.';

REVOKE ALL ON TABLE public.budget_allocation_balances_v FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_allocation_balances_v FROM anon;
REVOKE ALL ON TABLE public.budget_allocation_balances_v FROM authenticated;

REVOKE ALL ON TABLE public.budget_funding_source_balances_v FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_funding_source_balances_v FROM anon;
REVOKE ALL ON TABLE public.budget_funding_source_balances_v FROM authenticated;

-- -----------------------------------------------------------------------------
-- Internal balance helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_allocation_current_authority_minor(
    p_allocation_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(le.amount_minor), 0)::BIGINT
    FROM public.budget_ledger_entries AS le
    WHERE le.allocation_id = p_allocation_id
      AND le.financial_dimension = 'budget_authority';
$$;

REVOKE ALL ON FUNCTION public.budget_allocation_current_authority_minor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_allocation_current_authority_minor(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_allocation_current_authority_minor(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_funding_source_reserve_minor(
    p_funding_source_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT (
        fs.authorized_amount_minor
        - COALESCE((
            SELECT SUM(le.amount_minor)
            FROM public.budget_ledger_entries AS le
            INNER JOIN public.budget_allocations AS a
                ON a.id = le.allocation_id
            WHERE a.funding_source_id = fs.id
              AND le.financial_dimension = 'budget_authority'
        ), 0)
    )::BIGINT
    FROM public.budget_funding_sources AS fs
    WHERE fs.id = p_funding_source_id;
$$;

REVOKE ALL ON FUNCTION public.budget_funding_source_reserve_minor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_funding_source_reserve_minor(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_funding_source_reserve_minor(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_category_is_leaf(p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.budget_categories AS c
        WHERE c.id = p_category_id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.budget_categories AS child
        WHERE child.parent_category_id = p_category_id
    );
$$;

REVOKE ALL ON FUNCTION public.budget_category_is_leaf(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_category_is_leaf(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_category_is_leaf(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_fingerprint_initial_allocation(
    p_period_id UUID,
    p_category_id UUID,
    p_amount_minor BIGINT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT public.budget_sha256_hex(
        '{"amount_minor":"'
        || p_amount_minor::TEXT
        || '","category_id":"'
        || lower(p_category_id::TEXT)
        || '","operation_type":"initial_allocation","period_id":"'
        || lower(p_period_id::TEXT)
        || '"}'
    );
$$;

REVOKE ALL ON FUNCTION public.budget_fingerprint_initial_allocation(UUID, UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_fingerprint_initial_allocation(UUID, UUID, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_fingerprint_initial_allocation(UUID, UUID, BIGINT) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_fingerprint_allocation_adjustment(
    p_allocation_id UUID,
    p_delta_minor BIGINT,
    p_reason TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT public.budget_sha256_hex(
        '{"allocation_id":"'
        || lower(p_allocation_id::TEXT)
        || '","delta_minor":"'
        || p_delta_minor::TEXT
        || '","operation_type":"allocation_adjustment","reason":'
        || to_jsonb(BTRIM(p_reason))::TEXT
        || '}'
    );
$$;

REVOKE ALL ON FUNCTION public.budget_fingerprint_allocation_adjustment(UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_fingerprint_allocation_adjustment(UUID, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_fingerprint_allocation_adjustment(UUID, BIGINT, TEXT) FROM authenticated;

-- -----------------------------------------------------------------------------
-- set_initial_budget_allocation
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

    -- Lock order: period → funding source → allocation → idempotency/operation → ledger
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

COMMENT ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) IS
    'P1C: once-per-allocation initial budget_authority. Requires budget.allocate_funds. Fingerprint server-side.';

REVOKE ALL ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_initial_budget_allocation(UUID, UUID, BIGINT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- adjust_budget_allocation
-- Authorization: budget.allocate_funds only (P1B catalogue: allocate and adjust authority).
-- -----------------------------------------------------------------------------

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

    -- Lock order: period → funding source → allocation → operation → ledger
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

COMMENT ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) IS
    'P1C: allocation_adjustment on budget_authority. Requires budget.allocate_funds. Reason required.';

REVOKE ALL ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_budget_allocation(UUID, BIGINT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- get_budget_period_balances — authoritative read surface
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_budget_period_balances(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_user public.users%ROWTYPE;
    v_period public.budget_periods%ROWTYPE;
    v_authorized BIGINT := 0;
    v_allocated BIGINT := 0;
    v_reserve BIGINT := 0;
    v_commitment BIGINT := 0;
    v_expense BIGINT := 0;
    v_available BIGINT := 0;
    v_sources JSONB := '[]'::JSONB;
    v_allocations JSONB := '[]'::JSONB;
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
        'budget.view'
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

    SELECT COALESCE(SUM(fs.authorized_amount_minor), 0)::BIGINT
    INTO v_authorized
    FROM public.budget_funding_sources AS fs
    WHERE fs.budget_period_id = v_period.id;

    SELECT COALESCE(SUM(b.current_budget_authority_minor), 0)::BIGINT,
           COALESCE(SUM(b.open_commitment_minor), 0)::BIGINT,
           COALESCE(SUM(b.actual_expense_minor), 0)::BIGINT,
           COALESCE(SUM(b.available_minor), 0)::BIGINT
    INTO v_allocated, v_commitment, v_expense, v_available
    FROM public.budget_allocation_balances_v AS b
    WHERE b.budget_period_id = v_period.id;

    v_reserve := v_authorized - v_allocated;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'funding_source_id', s.funding_source_id,
                'authorized_minor', s.authorized_minor,
                'allocated_current_minor', s.allocated_current_minor,
                'reserve_minor', s.reserve_minor
            )
            ORDER BY s.funding_source_id
        ),
        '[]'::JSONB
    )
    INTO v_sources
    FROM public.budget_funding_source_balances_v AS s
    WHERE s.budget_period_id = v_period.id
      AND s.institution_id = v_actor_user.institution_id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'allocation_id', a.allocation_id,
                'funding_source_id', a.funding_source_id,
                'category_id', a.category_id,
                'original_budget_authority_minor', a.original_budget_authority_minor,
                'current_budget_authority_minor', a.current_budget_authority_minor,
                'open_commitment_minor', a.open_commitment_minor,
                'actual_expense_minor', a.actual_expense_minor,
                'available_minor', a.available_minor
            )
            ORDER BY a.allocation_id
        ),
        '[]'::JSONB
    )
    INTO v_allocations
    FROM public.budget_allocation_balances_v AS a
    WHERE a.budget_period_id = v_period.id
      AND a.institution_id = v_actor_user.institution_id;

    RETURN jsonb_build_object(
        'ok', true,
        'period_id', v_period.id,
        'institution_id', v_period.institution_id,
        'period_status', v_period.status,
        'totals', jsonb_build_object(
            'authorized_minor', v_authorized,
            'allocated_current_minor', v_allocated,
            'reserve_minor', v_reserve,
            'open_commitment_minor', v_commitment,
            'actual_expense_minor', v_expense,
            'operational_available_minor', v_available
        ),
        'funding_sources', v_sources,
        'allocations', v_allocations
    );
END;
$$;

COMMENT ON FUNCTION public.get_budget_period_balances(UUID) IS
    'P1C: authoritative period balances via internal views. Requires budget.view.';

REVOKE ALL ON FUNCTION public.get_budget_period_balances(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_budget_period_balances(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_budget_period_balances(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- RLS / ACL — fail closed; mutations via SECURITY DEFINER RPCs only
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_financial_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_ledger_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.budget_allocations FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_allocations FROM anon;
REVOKE ALL ON TABLE public.budget_allocations FROM authenticated;

REVOKE ALL ON TABLE public.budget_financial_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_financial_operations FROM anon;
REVOKE ALL ON TABLE public.budget_financial_operations FROM authenticated;

REVOKE ALL ON TABLE public.budget_ledger_entries FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_ledger_entries FROM anon;
REVOKE ALL ON TABLE public.budget_ledger_entries FROM authenticated;

-- No permissive policies. Prefer get_budget_period_balances for reads.

-- -----------------------------------------------------------------------------
-- P1C function EXECUTE security matrix
-- -----------------------------------------------------------------------------
-- Client EXECUTE YES (authenticated only):
--   set_initial_budget_allocation
--   adjust_budget_allocation
--   get_budget_period_balances
-- Internal / no client EXECUTE:
--   budget_money_business_cap
--   budget_sha256_hex
--   budget_sha256 helpers / fingerprints
--   budget_allocation_current_authority_minor
--   budget_funding_source_reserve_minor
--   budget_category_is_leaf
--   enforce_* / reject_mutation triggers
-- All: PUBLIC = NO, anon = NO
--
-- Stable error codes used by P1C RPCs / triggers:
--   'budget_permission_denied'
--   'budget_management_not_enabled'
--   'budget_period_not_draft'
--   'budget_period_not_active'
--   'budget_period_closed'
--   'budget_invalid_amount'
--   'budget_insufficient_available'
--   'budget_initial_allocation_exists'
--   'budget_duplicate_operation'
--   'budget_structure_locked'
--   'budget_not_found'
