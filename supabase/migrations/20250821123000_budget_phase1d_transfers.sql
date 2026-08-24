-- =============================================================================
-- MPEX — School Budget Management Phase 1D: Intra-source budget transfers
-- =============================================================================
-- Forward-only. Does NOT edit applied P1A / P1B / P1C migrations.
-- Does NOT implement: cross-funding-source transfers, commitments, expenses,
-- invoices, reimbursements, requests integration, UI, or Phase 3 quotation/PDF.
-- Does NOT touch public.requests.
--
-- Depends on:
--   P1A 20250821120000_budget_phase1a_configuration_schema.sql
--   P1B 20250821121000_budget_phase1b_permission_foundation.sql
--   P1C 20250821122000_budget_phase1c_ledger_foundation.sql

-- -----------------------------------------------------------------------------
-- Operation taxonomy: add budget_transfer (reason required)
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_financial_operations
    DROP CONSTRAINT budget_financial_operations_type_valid;

ALTER TABLE public.budget_financial_operations
    ADD CONSTRAINT budget_financial_operations_type_valid
        CHECK (operation_type IN (
            'initial_allocation',
            'allocation_adjustment',
            'budget_transfer'
        ));

ALTER TABLE public.budget_financial_operations
    DROP CONSTRAINT budget_financial_operations_adjustment_reason_required;

ALTER TABLE public.budget_financial_operations
    ADD CONSTRAINT budget_financial_operations_reason_required_for_typed_ops
        CHECK (
            operation_type NOT IN ('allocation_adjustment', 'budget_transfer')
            OR (reason IS NOT NULL AND BTRIM(reason) <> '')
        );

COMMENT ON TABLE public.budget_financial_operations IS
    'Immutable Budget financial command log (P1C+P1D). Fingerprint is server-generated.';

-- -----------------------------------------------------------------------------
-- Ledger taxonomy: transfer_out / transfer_in under budget_authority only
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_ledger_entries
    DROP CONSTRAINT budget_ledger_entries_event_dimension_match;

ALTER TABLE public.budget_ledger_entries
    ADD CONSTRAINT budget_ledger_entries_event_dimension_match
        CHECK (
            (
                financial_dimension = 'budget_authority'
                AND event_type IN (
                    'initial_allocation',
                    'allocation_adjustment',
                    'transfer_out',
                    'transfer_in'
                )
            )
            -- commitment / actual_expense event types reserved for later phases
        );

ALTER TABLE public.budget_ledger_entries
    ADD CONSTRAINT budget_ledger_entries_transfer_out_negative
        CHECK (
            event_type <> 'transfer_out'
            OR amount_minor < 0
        );

ALTER TABLE public.budget_ledger_entries
    ADD CONSTRAINT budget_ledger_entries_transfer_in_positive
        CHECK (
            event_type <> 'transfer_in'
            OR amount_minor > 0
        );

COMMENT ON TABLE public.budget_ledger_entries IS
    'Append-only Budget ledger (P1C+P1D). P1D writes transfer_out/transfer_in on budget_authority.';

-- At most one transfer_out and one transfer_in per operation (structural).
CREATE UNIQUE INDEX idx_budget_ledger_one_transfer_out_per_operation
    ON public.budget_ledger_entries (operation_id)
    WHERE financial_dimension = 'budget_authority'
      AND event_type = 'transfer_out';

CREATE UNIQUE INDEX idx_budget_ledger_one_transfer_in_per_operation
    ON public.budget_ledger_entries (operation_id)
    WHERE financial_dimension = 'budget_authority'
      AND event_type = 'transfer_in';

-- -----------------------------------------------------------------------------
-- Ledger/operation type alignment (replace P1C helper in place)
-- -----------------------------------------------------------------------------

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
       OR (
            NEW.event_type IN ('transfer_out', 'transfer_in')
            AND v_op.operation_type <> 'budget_transfer'
       )
       OR (
            v_op.operation_type = 'budget_transfer'
            AND NEW.event_type NOT IN ('transfer_out', 'transfer_in')
       )
    THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_ledger_operation_scope() IS
    'P1C+P1D: ledger event_type must match financial operation_type; tenant/period/actor aligned.';

-- -----------------------------------------------------------------------------
-- Transfer pair invariant — deferred to commit (never committed incomplete)
-- Structural: unique indexes + sign CHECKs + event/dimension CHECK.
-- Transactional: every budget_transfer operation must have exactly two sibling
-- ledger rows, opposite signed amounts, distinct allocations, net zero.
-- Enforced from BOTH sides:
--   - operation INSERT schedules commit-time validation (covers zero ledger rows)
--   - ledger transfer INSERT schedules the same validation (covers malformed pairs)
-- RPC still inserts the operation then both ledger rows in one transaction;
-- deferred checks run at COMMIT after the pair exists.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_budget_transfer_operation_pair(
    p_operation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_op public.budget_financial_operations%ROWTYPE;
    v_out public.budget_ledger_entries%ROWTYPE;
    v_in public.budget_ledger_entries%ROWTYPE;
    v_count INTEGER;
BEGIN
    SELECT *
    INTO v_op
    FROM public.budget_financial_operations
    WHERE id = p_operation_id;

    IF NOT FOUND OR v_op.operation_type <> 'budget_transfer' THEN
        RETURN;
    END IF;

    -- Deferred to COMMIT: zero/incomplete ledger state is allowed mid-transaction.
    -- At commit the operation must have exactly two ledger rows.
    SELECT COUNT(*)
    INTO v_count
    FROM public.budget_ledger_entries
    WHERE operation_id = p_operation_id;

    IF v_count <> 2 THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
    INTO v_out
    FROM public.budget_ledger_entries
    WHERE operation_id = p_operation_id
      AND financial_dimension = 'budget_authority'
      AND event_type = 'transfer_out';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
    INTO v_in
    FROM public.budget_ledger_entries
    WHERE operation_id = p_operation_id
      AND financial_dimension = 'budget_authority'
      AND event_type = 'transfer_in';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_out.allocation_id IS NOT DISTINCT FROM v_in.allocation_id THEN
        RAISE EXCEPTION 'budget_transfer_same_allocation'
            USING ERRCODE = 'P0001';
    END IF;

    -- Overflow-safe pair: out < 0, in > 0, in = (0 - out).
    -- Ledger CHECK already confines amount_minor to ±9999999999999, so
    -- (0 - out) cannot hit BIGINT_MIN. Do not call PostgreSQL ABS on BIGINT.
    IF v_out.amount_minor >= 0
       OR v_in.amount_minor <= 0
       OR v_in.amount_minor <> (0::BIGINT - v_out.amount_minor)
    THEN
        RAISE EXCEPTION 'budget_not_found'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_budget_transfer_operation_pair(UUID) IS
    'P1D: canonical commit-time pair invariant for budget_transfer (exactly transfer_out + transfer_in, net zero).';

REVOKE ALL ON FUNCTION public.assert_budget_transfer_operation_pair(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_budget_transfer_operation_pair(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_budget_transfer_operation_pair(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_budget_transfer_operation_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Operation-side: schedules even when zero ledger rows follow.
    PERFORM public.assert_budget_transfer_operation_pair(NEW.id);
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_transfer_operation_pair() IS
    'P1D: deferred operation-side pair invariant for budget_transfer inserts.';

REVOKE ALL ON FUNCTION public.enforce_budget_transfer_operation_pair() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_transfer_operation_pair() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_transfer_operation_pair() FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_budget_transfer_ledger_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Ledger-side: same canonical assert; cannot bypass pair validation via transfer rows.
    PERFORM public.assert_budget_transfer_operation_pair(NEW.operation_id);
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_transfer_ledger_pair() IS
    'P1D: deferred ledger-side pair invariant for transfer_out/transfer_in inserts.';

REVOKE ALL ON FUNCTION public.enforce_budget_transfer_ledger_pair() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_transfer_ledger_pair() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_transfer_ledger_pair() FROM authenticated;

DROP TRIGGER IF EXISTS budget_financial_operations_transfer_pair ON public.budget_financial_operations;
CREATE CONSTRAINT TRIGGER budget_financial_operations_transfer_pair
    AFTER INSERT ON public.budget_financial_operations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.operation_type = 'budget_transfer')
    EXECUTE PROCEDURE public.enforce_budget_transfer_operation_pair();

DROP TRIGGER IF EXISTS budget_ledger_entries_transfer_pair ON public.budget_ledger_entries;
CREATE CONSTRAINT TRIGGER budget_ledger_entries_transfer_pair
    AFTER INSERT ON public.budget_ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.event_type IN ('transfer_out', 'transfer_in'))
    EXECUTE PROCEDURE public.enforce_budget_transfer_ledger_pair();

-- -----------------------------------------------------------------------------
-- Available-balance helper (P1C formula: authority − commitment − expense)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_allocation_available_minor(
    p_allocation_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.available_minor
    FROM public.budget_allocation_balances_v AS b
    WHERE b.allocation_id = p_allocation_id;
$$;

COMMENT ON FUNCTION public.budget_allocation_available_minor(UUID) IS
    'P1D: authoritative operational available_minor from P1C balance view.';

REVOKE ALL ON FUNCTION public.budget_allocation_available_minor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_allocation_available_minor(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_allocation_available_minor(UUID) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Server-generated transfer fingerprint
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_fingerprint_budget_transfer(
    p_source_allocation_id UUID,
    p_destination_allocation_id UUID,
    p_amount_minor BIGINT,
    p_reason TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT public.budget_sha256_hex(
        '{"amount_minor":"'
        || p_amount_minor::TEXT
        || '","destination_allocation_id":"'
        || lower(p_destination_allocation_id::TEXT)
        || '","operation_type":"budget_transfer","reason":'
        || to_jsonb(BTRIM(p_reason))::TEXT
        || ',"source_allocation_id":"'
        || lower(p_source_allocation_id::TEXT)
        || '"}'
    );
$$;

COMMENT ON FUNCTION public.budget_fingerprint_budget_transfer(UUID, UUID, BIGINT, TEXT) IS
    'P1D: server-side SHA-256 fingerprint for budget_transfer. No client fingerprint input.';

REVOKE ALL ON FUNCTION public.budget_fingerprint_budget_transfer(UUID, UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_fingerprint_budget_transfer(UUID, UUID, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_fingerprint_budget_transfer(UUID, UUID, BIGINT, TEXT) FROM authenticated;

-- -----------------------------------------------------------------------------
-- transfer_budget_authority
-- Naming: matches P1C verb_noun_budget_* RPC style (set_initial_budget_allocation,
-- adjust_budget_allocation) and the specified transfer_budget_authority contract.
-- Authorization: budget.transfer_funds only. No role fallback.
-- Lock order: period → funding source → allocations (UUID ascending) → initialization re-check → operation → ledger
-- -----------------------------------------------------------------------------

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

    -- Lock order: period → funding source → allocations (UUID ascending) → initialization re-check → operation → ledger
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

    -- Initialization re-check after allocation locks.
    -- Initialized = budget_authority / initial_allocation ledger event only.
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

    -- Recalculate source available after locks (authority − commitment − expense).
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

COMMENT ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) IS
    'P1D: intra-source budget_authority transfer. Requires budget.transfer_funds. Fingerprint server-side.';

REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_budget_authority(UUID, UUID, BIGINT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- P1D function EXECUTE security matrix
-- -----------------------------------------------------------------------------
-- Client EXECUTE YES (authenticated only):
--   transfer_budget_authority
-- Internal / no client EXECUTE:
--   budget_allocation_available_minor
--   budget_fingerprint_budget_transfer
--   assert_budget_transfer_operation_pair
--   enforce_budget_transfer_operation_pair
--   enforce_budget_transfer_ledger_pair
-- PUBLIC = NO, anon = NO
-- Transfer pair triggers (both DEFERRABLE INITIALLY DEFERRED):
--   budget_financial_operations_transfer_pair (operation-side; covers zero ledger)
--   budget_ledger_entries_transfer_pair (ledger-side; covers malformed pairs)

--
-- Stable error codes used by P1D:
--   budget_permission_denied
--   budget_management_not_enabled
--   budget_not_found
--   budget_period_closed
--   budget_structure_locked
--   budget_invalid_amount
--   budget_insufficient_available
--   budget_duplicate_operation
--   budget_transfer_cross_source_forbidden
--   budget_transfer_same_allocation
--   budget_transfer_source_not_initialized
--   budget_transfer_destination_not_initialized
