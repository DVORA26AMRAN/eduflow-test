-- =============================================================================
-- MPEX — School Budget Management Phase 1B: Permission Foundation
-- =============================================================================
-- Forward-only. Institution-scoped Budget authorization only.
-- Depends on P1A (20250821120000_budget_phase1a_configuration_schema.sql).
-- Does NOT implement: ledger, allocations, transfers, financial RPCs, UI.
-- Does NOT touch public.requests or Phase 3 quotation/PDF work.
--
-- Compatibility: existing public.capabilities / public.user_capabilities are
-- pre-baseline with unknown catalogue semantics and zero app usage. Budget uses
-- a bounded domain-specific grant model (budget_capabilities + budget_user_grants).
--
-- P1C will add ledger/allocation foundation.

-- -----------------------------------------------------------------------------
-- Capability catalogue (immutable machine identifiers)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_capabilities (
    capability_key  TEXT        PRIMARY KEY,
    description     TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_capabilities_key_not_blank
        CHECK (BTRIM(capability_key) <> ''),
    CONSTRAINT budget_capabilities_key_namespace_valid
        CHECK (capability_key ~ '^budget\.[a-z_]+$')
);

COMMENT ON TABLE public.budget_capabilities IS
    'Budget capability catalogue (P1B). Machine identifiers are immutable.';

INSERT INTO public.budget_capabilities (capability_key, description)
VALUES
    ('budget.view', 'View institution budget configuration and balances'),
    ('budget.manage_structure', 'Manage budget periods, funding sources, and categories'),
    ('budget.allocate_funds', 'Allocate and adjust budget authority'),
    ('budget.transfer_funds', 'Transfer budget authority between allocations'),
    ('budget.activate_period', 'Activate a draft budget period'),
    ('budget.close_period', 'Close an active budget period'),
    ('budget.approve_request', 'Approve teacher budget requests into commitments'),
    ('budget.verify_invoice', 'Verify invoices and record actual expenses'),
    ('budget.cancel_commitment', 'Cancel or release budget commitments'),
    ('budget.prepare_report', 'Prepare budget reporting submissions'),
    ('budget.approve_report', 'Approve budget reporting submissions'),
    ('budget.submit_report', 'Submit budget reports to external bodies'),
    ('budget.manage_settings', 'Administer Budget capability grants')
ON CONFLICT (capability_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Institution enablement (bootstrap boundary)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_institution_enablement (
    institution_id              UUID        PRIMARY KEY
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    enabled_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enabled_by_user_id          UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    bootstrap_idempotency_key   TEXT        NOT NULL,

    CONSTRAINT budget_institution_enablement_bootstrap_key_not_blank
        CHECK (BTRIM(bootstrap_idempotency_key) <> '')
);

COMMENT ON TABLE public.budget_institution_enablement IS
    'Marks an institution as Budget-enabled after manager bootstrap (P1B). '
    'bootstrap_idempotency_key is unique per institution (not globally).';

CREATE UNIQUE INDEX idx_budget_institution_enablement_institution_bootstrap_key
    ON public.budget_institution_enablement (institution_id, bootstrap_idempotency_key);

-- -----------------------------------------------------------------------------
-- Effective user grants (authoritative after bootstrap)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_user_grants (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    user_id             UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    capability_key      TEXT        NOT NULL
        REFERENCES public.budget_capabilities (capability_key) ON DELETE RESTRICT,
    granted_by_user_id  UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_user_grants_institution_user_capability_unique
        UNIQUE (institution_id, user_id, capability_key)
);

COMMENT ON TABLE public.budget_user_grants IS
    'Effective Budget capability grants per institution user (P1B). Not role-derived.';

CREATE INDEX idx_budget_user_grants_institution_id
    ON public.budget_user_grants (institution_id);

CREATE INDEX idx_budget_user_grants_user_id
    ON public.budget_user_grants (user_id);

CREATE INDEX idx_budget_user_grants_institution_capability
    ON public.budget_user_grants (institution_id, capability_key);

-- -----------------------------------------------------------------------------
-- Permission audit (append-only security history — not financial ledger)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_permission_audit_events (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID        NOT NULL
        REFERENCES public.institutions (id) ON DELETE RESTRICT,
    actor_user_id       UUID        NOT NULL
        REFERENCES public.users (id) ON DELETE RESTRICT,
    target_user_id      UUID
        REFERENCES public.users (id) ON DELETE RESTRICT,
    capability_key      TEXT
        REFERENCES public.budget_capabilities (capability_key) ON DELETE RESTRICT,
    action              TEXT        NOT NULL,
    idempotency_key     TEXT,
    metadata            JSONB       NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_permission_audit_action_valid
        CHECK (action IN ('bootstrap', 'grant', 'revoke')),
    CONSTRAINT budget_permission_audit_bootstrap_shape
        CHECK (
            action <> 'bootstrap'
            OR (
                target_user_id IS NOT NULL
                AND capability_key IS NULL
            )
        ),
    CONSTRAINT budget_permission_audit_grant_revoke_shape
        CHECK (
            action NOT IN ('grant', 'revoke')
            OR (
                target_user_id IS NOT NULL
                AND capability_key IS NOT NULL
            )
        )
);

COMMENT ON TABLE public.budget_permission_audit_events IS
    'Append-only Budget permission audit trail (P1B). Never silently overwritten.';

CREATE INDEX idx_budget_permission_audit_institution_created_at
    ON public.budget_permission_audit_events (institution_id, created_at DESC);

CREATE INDEX idx_budget_permission_audit_target_user_id
    ON public.budget_permission_audit_events (target_user_id)
    WHERE target_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Grant scope enforcement (tenant consistency at database level)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_budget_user_grant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_user_institution_id UUID;
BEGIN
    SELECT u.institution_id
    INTO v_user_institution_id
    FROM public.users AS u
    WHERE u.id = NEW.user_id;

    IF v_user_institution_id IS NULL
       OR v_user_institution_id IS DISTINCT FROM NEW.institution_id
    THEN
        RAISE EXCEPTION 'Budget grant user must belong to the grant institution.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_budget_user_grant_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_user_grant_scope() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_user_grant_scope() FROM authenticated;

DROP TRIGGER IF EXISTS budget_user_grants_enforce_scope ON public.budget_user_grants;
CREATE TRIGGER budget_user_grants_enforce_scope
    BEFORE INSERT ON public.budget_user_grants
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_user_grant_scope();

-- -----------------------------------------------------------------------------
-- Append-only audit enforcement
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_permission_audit_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'budget_permission_audit_events is append-only'
        USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.budget_permission_audit_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_permission_audit_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.budget_permission_audit_reject_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS budget_permission_audit_no_update ON public.budget_permission_audit_events;
CREATE TRIGGER budget_permission_audit_no_update
    BEFORE UPDATE ON public.budget_permission_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_permission_audit_reject_mutation();

DROP TRIGGER IF EXISTS budget_permission_audit_no_delete ON public.budget_permission_audit_events;
CREATE TRIGGER budget_permission_audit_no_delete
    BEFORE DELETE ON public.budget_permission_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.budget_permission_audit_reject_mutation();

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.budget_fail(p_error_code TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'ok', false,
        'error_code', p_error_code
    );
$$;

REVOKE ALL ON FUNCTION public.budget_fail(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_fail(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_fail(TEXT) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_is_valid_capability(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.budget_capabilities AS c
        WHERE c.capability_key = p_capability
    );
$$;

REVOKE ALL ON FUNCTION public.budget_is_valid_capability(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_is_valid_capability(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.budget_is_valid_capability(TEXT) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_institution_is_enabled(p_institution_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.budget_institution_enablement AS e
        WHERE e.institution_id = p_institution_id
    );
$$;

REVOKE ALL ON FUNCTION public.budget_institution_is_enabled(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_institution_is_enabled(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_institution_is_enabled(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_count_active_manage_settings_holders(
    p_institution_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::INTEGER
    FROM public.budget_user_grants AS g
    INNER JOIN public.users AS u
        ON u.id = g.user_id
    WHERE g.institution_id = p_institution_id
      AND g.capability_key = 'budget.manage_settings'
      AND u.status = 'active'
      AND u.institution_id = p_institution_id;
$$;

REVOKE ALL ON FUNCTION public.budget_count_active_manage_settings_holders(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_count_active_manage_settings_holders(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.budget_count_active_manage_settings_holders(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.budget_user_has_capability(
    p_institution_id UUID,
    p_capability TEXT
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
        INNER JOIN public.budget_user_grants AS g
            ON g.user_id = u.id
           AND g.institution_id = u.institution_id
        WHERE u.id = auth.uid()
          AND u.status = 'active'
          AND u.institution_id = p_institution_id
          AND g.institution_id = p_institution_id
          AND g.capability_key = p_capability
          AND public.budget_is_valid_capability(p_capability)
          AND public.budget_institution_is_enabled(p_institution_id)
    );
$$;

COMMENT ON FUNCTION public.budget_user_has_capability(UUID, TEXT) IS
    'P1B: fail-closed capability check for auth.uid(). Grant-based only; primary_role is not sufficient.';

REVOKE ALL ON FUNCTION public.budget_user_has_capability(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_user_has_capability(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.budget_user_has_capability(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.budget_write_permission_audit(
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_target_user_id UUID,
    p_capability_key TEXT,
    p_action TEXT,
    p_idempotency_key TEXT,
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
    INSERT INTO public.budget_permission_audit_events (
        institution_id,
        actor_user_id,
        target_user_id,
        capability_key,
        action,
        idempotency_key,
        metadata
    )
    VALUES (
        p_institution_id,
        p_actor_user_id,
        p_target_user_id,
        p_capability_key,
        p_action,
        NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
        COALESCE(p_metadata, '{}'::JSONB)
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.budget_write_permission_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.budget_write_permission_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.budget_write_permission_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Bootstrap — institution manager authority only (pre-grant)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enable_budget_management_for_institution(
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
    v_institution public.institutions%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_existing public.budget_institution_enablement%ROWTYPE;
    v_capability RECORD;
    v_grants_created INTEGER := 0;
BEGIN
    IF v_actor IS NULL OR v_key = '' OR LENGTH(v_key) > 128 THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_actor_user
    FROM public.users
    WHERE id = v_actor;

    IF NOT FOUND
       OR v_actor_user.status <> 'active'
       OR v_actor_user.primary_role <> 'institution_manager'::public.user_role
       OR v_actor_user.institution_id IS NULL
    THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_institution
    FROM public.institutions
    WHERE id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_existing
    FROM public.budget_institution_enablement
    WHERE institution_id = v_institution.id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'ok', true,
            'already_enabled', true,
            'institution_id', v_institution.id,
            'enabled_at', v_existing.enabled_at
        );
    END IF;

    INSERT INTO public.budget_institution_enablement (
        institution_id,
        enabled_by_user_id,
        bootstrap_idempotency_key
    )
    VALUES (
        v_institution.id,
        v_actor,
        v_key
    );

    FOR v_capability IN
        SELECT c.capability_key
        FROM public.budget_capabilities AS c
        ORDER BY c.capability_key
    LOOP
        INSERT INTO public.budget_user_grants (
            institution_id,
            user_id,
            capability_key,
            granted_by_user_id
        )
        VALUES (
            v_institution.id,
            v_actor,
            v_capability.capability_key,
            v_actor
        )
        ON CONFLICT (institution_id, user_id, capability_key) DO NOTHING;

        v_grants_created := v_grants_created + 1;
    END LOOP;

    PERFORM public.budget_write_permission_audit(
        v_institution.id,
        v_actor,
        v_actor,
        NULL,
        'bootstrap',
        v_key,
        jsonb_build_object(
            'grants_seeded', v_grants_created,
            'enabled_by_user_id', v_actor
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'already_enabled', false,
        'institution_id', v_institution.id,
        'grants_created', v_grants_created
    );
EXCEPTION
    WHEN unique_violation THEN
        SELECT *
        INTO v_existing
        FROM public.budget_institution_enablement
        WHERE institution_id = v_actor_user.institution_id;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'ok', true,
                'already_enabled', true,
                'institution_id', v_existing.institution_id,
                'enabled_at', v_existing.enabled_at
            );
        END IF;

        RETURN public.budget_fail('budget_duplicate_operation');
END;
$$;

COMMENT ON FUNCTION public.enable_budget_management_for_institution(TEXT) IS
    'P1B: active institution_manager bootstraps Budget for own institution. '
    'Idempotent via institution row lock and institution-scoped bootstrap_idempotency_key.';

REVOKE ALL ON FUNCTION public.enable_budget_management_for_institution(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enable_budget_management_for_institution(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.enable_budget_management_for_institution(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Grant administration
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_budget_capability(
    p_target_user_id UUID,
    p_capability TEXT,
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
    v_target_user public.users%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_capability TEXT := BTRIM(COALESCE(p_capability, ''));
    v_grant_id UUID;
BEGIN
    IF v_actor IS NULL
       OR p_target_user_id IS NULL
       OR v_key = ''
       OR LENGTH(v_key) > 128
       OR NOT public.budget_is_valid_capability(v_capability)
    THEN
        RETURN public.budget_fail(
            CASE
                WHEN NOT public.budget_is_valid_capability(v_capability)
                    THEN 'budget_invalid_capability'
                ELSE 'budget_permission_denied'
            END
        );
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

    PERFORM 1
    FROM public.institutions
    WHERE id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.manage_settings'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_target_user
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_target_user.status <> 'active'
       OR v_target_user.institution_id IS DISTINCT FROM v_actor_user.institution_id
    THEN
        RETURN public.budget_fail('budget_target_user_invalid');
    END IF;

    SELECT g.id
    INTO v_grant_id
    FROM public.budget_user_grants AS g
    WHERE g.institution_id = v_actor_user.institution_id
      AND g.user_id = p_target_user_id
      AND g.capability_key = v_capability;

    IF v_grant_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'grant_id', v_grant_id,
            'institution_id', v_actor_user.institution_id,
            'user_id', p_target_user_id,
            'capability_key', v_capability
        );
    END IF;

    INSERT INTO public.budget_user_grants (
        institution_id,
        user_id,
        capability_key,
        granted_by_user_id
    )
    VALUES (
        v_actor_user.institution_id,
        p_target_user_id,
        v_capability,
        v_actor
    )
    RETURNING id INTO v_grant_id;

    PERFORM public.budget_write_permission_audit(
        v_actor_user.institution_id,
        v_actor,
        p_target_user_id,
        v_capability,
        'grant',
        v_key,
        jsonb_build_object('grant_id', v_grant_id)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'grant_id', v_grant_id,
        'institution_id', v_actor_user.institution_id,
        'user_id', p_target_user_id,
        'capability_key', v_capability
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'institution_id', v_actor_user.institution_id,
            'user_id', p_target_user_id,
            'capability_key', v_capability
        );
END;
$$;

COMMENT ON FUNCTION public.grant_budget_capability(UUID, TEXT, TEXT) IS
    'P1B: grant a Budget capability within the caller institution. '
    'Effective state deduplication uses UNIQUE (institution_id, user_id, capability_key); '
    'p_idempotency_key is audit correlation metadata only, not primary state deduplication.';

REVOKE ALL ON FUNCTION public.grant_budget_capability(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_budget_capability(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_budget_capability(UUID, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Revoke administration (last-admin protection)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_budget_capability(
    p_target_user_id UUID,
    p_capability TEXT,
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
    v_target_user public.users%ROWTYPE;
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_capability TEXT := BTRIM(COALESCE(p_capability, ''));
    v_deleted INTEGER;
    v_target_has_grant BOOLEAN;
BEGIN
    IF v_actor IS NULL
       OR p_target_user_id IS NULL
       OR v_key = ''
       OR LENGTH(v_key) > 128
       OR NOT public.budget_is_valid_capability(v_capability)
    THEN
        RETURN public.budget_fail(
            CASE
                WHEN NOT public.budget_is_valid_capability(v_capability)
                    THEN 'budget_invalid_capability'
                ELSE 'budget_permission_denied'
            END
        );
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

    PERFORM 1
    FROM public.institutions
    WHERE id = v_actor_user.institution_id
    FOR UPDATE;

    IF NOT public.budget_institution_is_enabled(v_actor_user.institution_id) THEN
        RETURN public.budget_fail('budget_management_not_enabled');
    END IF;

    IF NOT public.budget_user_has_capability(
        v_actor_user.institution_id,
        'budget.manage_settings'
    ) THEN
        RETURN public.budget_fail('budget_permission_denied');
    END IF;

    SELECT *
    INTO v_target_user
    FROM public.users
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_target_user.institution_id IS DISTINCT FROM v_actor_user.institution_id
    THEN
        RETURN public.budget_fail('budget_target_user_invalid');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.budget_user_grants AS g
        WHERE g.institution_id = v_actor_user.institution_id
          AND g.user_id = p_target_user_id
          AND g.capability_key = v_capability
    )
    INTO v_target_has_grant;

    IF NOT v_target_has_grant THEN
        RETURN jsonb_build_object(
            'ok', true,
            'unchanged', true,
            'institution_id', v_actor_user.institution_id,
            'user_id', p_target_user_id,
            'capability_key', v_capability
        );
    END IF;

    IF v_capability = 'budget.manage_settings'
       AND v_target_has_grant
       AND (
           SELECT COUNT(*)::INTEGER
           FROM public.budget_user_grants AS g
           INNER JOIN public.users AS u
               ON u.id = g.user_id
              AND u.institution_id = g.institution_id
           WHERE g.institution_id = v_actor_user.institution_id
             AND g.capability_key = 'budget.manage_settings'
             AND u.status = 'active'
             AND g.user_id <> p_target_user_id
       ) < 1
    THEN
        RETURN public.budget_fail('budget_last_admin_required');
    END IF;

    DELETE FROM public.budget_user_grants AS g
    WHERE g.institution_id = v_actor_user.institution_id
      AND g.user_id = p_target_user_id
      AND g.capability_key = v_capability;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 0 THEN
        RETURN jsonb_build_object(
            'ok', true,
            'unchanged', true,
            'institution_id', v_actor_user.institution_id,
            'user_id', p_target_user_id,
            'capability_key', v_capability
        );
    END IF;

    PERFORM public.budget_write_permission_audit(
        v_actor_user.institution_id,
        v_actor,
        p_target_user_id,
        v_capability,
        'revoke',
        v_key,
        '{}'::JSONB
    );

    RETURN jsonb_build_object(
        'ok', true,
        'unchanged', false,
        'institution_id', v_actor_user.institution_id,
        'user_id', p_target_user_id,
        'capability_key', v_capability
    );
END;
$$;

COMMENT ON FUNCTION public.revoke_budget_capability(UUID, TEXT, TEXT) IS
    'P1B: revoke a Budget capability within the caller institution. '
    'Missing grant is a no-op; audit is written only on effective revoke. '
    'p_idempotency_key is audit correlation metadata only, not primary state deduplication. '
    'manage_settings revoke rejects when post-revoke active administrator count would be zero.';

REVOKE ALL ON FUNCTION public.revoke_budget_capability(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_budget_capability(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_budget_capability(UUID, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- P1A configuration read access (budget.view via capability helper)
-- -----------------------------------------------------------------------------

GRANT SELECT ON TABLE public.budget_periods TO authenticated;
GRANT SELECT ON TABLE public.budget_funding_sources TO authenticated;
GRANT SELECT ON TABLE public.budget_categories TO authenticated;

DROP POLICY IF EXISTS budget_periods_select_view ON public.budget_periods;
CREATE POLICY budget_periods_select_view
    ON public.budget_periods
    FOR SELECT
    TO authenticated
    USING (
        public.budget_user_has_capability(institution_id, 'budget.view')
    );

DROP POLICY IF EXISTS budget_funding_sources_select_view ON public.budget_funding_sources;
CREATE POLICY budget_funding_sources_select_view
    ON public.budget_funding_sources
    FOR SELECT
    TO authenticated
    USING (
        public.budget_user_has_capability(institution_id, 'budget.view')
    );

DROP POLICY IF EXISTS budget_categories_select_view ON public.budget_categories;
CREATE POLICY budget_categories_select_view
    ON public.budget_categories
    FOR SELECT
    TO authenticated
    USING (
        public.budget_user_has_capability(institution_id, 'budget.view')
    );

-- -----------------------------------------------------------------------------
-- Permission table ACL — no direct client mutation or grant introspection
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_institution_enablement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_user_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_permission_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.budget_capabilities FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_capabilities FROM anon;
REVOKE ALL ON TABLE public.budget_capabilities FROM authenticated;

REVOKE ALL ON TABLE public.budget_institution_enablement FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_institution_enablement FROM anon;
REVOKE ALL ON TABLE public.budget_institution_enablement FROM authenticated;

REVOKE ALL ON TABLE public.budget_user_grants FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_user_grants FROM anon;
REVOKE ALL ON TABLE public.budget_user_grants FROM authenticated;

REVOKE ALL ON TABLE public.budget_permission_audit_events FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_permission_audit_events FROM anon;
REVOKE ALL ON TABLE public.budget_permission_audit_events FROM authenticated;

-- Catalogue exposed only through bounded RPCs in later phases if needed.
-- No permissive policies on permission tables until explicitly designed.

-- P1A configuration tables remain INSERT/UPDATE/DELETE revoked for authenticated.

-- -----------------------------------------------------------------------------
-- P1B function EXECUTE security matrix (N1)
-- -----------------------------------------------------------------------------
-- Internal helpers — no client EXECUTE (PUBLIC/anon/authenticated: NO):
--   budget_fail(TEXT)
--   budget_is_valid_capability(TEXT)
--   budget_institution_is_enabled(UUID)
--   budget_count_active_manage_settings_holders(UUID)
--   budget_write_permission_audit(...)
--   enforce_budget_user_grant_scope()
-- Application contract — authenticated EXECUTE YES:
--   budget_user_has_capability(UUID, TEXT)
--   enable_budget_management_for_institution(TEXT)
--   grant_budget_capability(UUID, TEXT, TEXT)
--   revoke_budget_capability(UUID, TEXT, TEXT)
-- All Budget functions: PUBLIC = NO, anon = NO
