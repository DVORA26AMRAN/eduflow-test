-- =============================================================================
-- MPEX — School Budget Management Phase 1A: Configuration Schema
-- =============================================================================
-- Forward-only. Configuration structure only (periods, funding sources, categories).
-- Does NOT implement: ledger, allocations, transfers, financial RPCs, permissions.
-- Does NOT touch public.requests or Phase 3 quotation/PDF work.
--
-- P1B will add budget_user_has_capability() and bootstrap grants.
-- P1C will add budget_allocations, ledger, and the leaf-stability rule:
--   once a level-1 category has allocation/financial history, creating its first
--   sub-category beneath it is forbidden (budget_structure_locked).
-- Until P1B: RLS enabled with no authenticated/anon policies (fail closed).

-- -----------------------------------------------------------------------------
-- budget_periods
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_periods (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id          UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    name                    TEXT        NOT NULL,
    start_date              DATE        NOT NULL,
    end_date                DATE        NOT NULL,
    status                  TEXT        NOT NULL,
    created_by_user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    activated_at            TIMESTAMPTZ,
    activated_by_user_id    UUID        REFERENCES public.users (id) ON DELETE RESTRICT,
    closed_at               TIMESTAMPTZ,
    closed_by_user_id       UUID        REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_periods_name_not_blank
        CHECK (BTRIM(name) <> ''),
    CONSTRAINT budget_periods_end_date_valid
        CHECK (end_date >= start_date),
    CONSTRAINT budget_periods_status_valid
        CHECK (status IN ('draft', 'active', 'closed')),
    -- Lifecycle metadata must match status exactly (fail closed against impossible states).
    CONSTRAINT budget_periods_lifecycle_valid
        CHECK (
            (
                status = 'draft'
                AND activated_at IS NULL
                AND activated_by_user_id IS NULL
                AND closed_at IS NULL
                AND closed_by_user_id IS NULL
            )
            OR (
                status = 'active'
                AND activated_at IS NOT NULL
                AND activated_by_user_id IS NOT NULL
                AND closed_at IS NULL
                AND closed_by_user_id IS NULL
            )
            OR (
                status = 'closed'
                AND activated_at IS NOT NULL
                AND activated_by_user_id IS NOT NULL
                AND closed_at IS NOT NULL
                AND closed_by_user_id IS NOT NULL
                AND closed_at >= activated_at
            )
        ),
    CONSTRAINT budget_periods_id_institution_unique
        UNIQUE (id, institution_id),
    CONSTRAINT budget_periods_institution_name_unique
        UNIQUE (institution_id, name)
);

COMMENT ON TABLE public.budget_periods IS
    'Institutional budget period (P1A). Status: draft | active | closed. At most one active period per institution.';

COMMENT ON COLUMN public.budget_periods.status IS
    'draft: structure editable. active: operational (future phases). closed: terminal for mutations.';

CREATE UNIQUE INDEX idx_budget_periods_one_active_per_institution
    ON public.budget_periods (institution_id)
    WHERE status = 'active';

CREATE INDEX idx_budget_periods_institution_status
    ON public.budget_periods (institution_id, status);

CREATE INDEX idx_budget_periods_institution_start_date
    ON public.budget_periods (institution_id, start_date DESC);

DROP TRIGGER IF EXISTS budget_periods_set_updated_at ON public.budget_periods;
CREATE TRIGGER budget_periods_set_updated_at
    BEFORE UPDATE ON public.budget_periods
    FOR EACH ROW
    EXECUTE PROCEDURE public.set_updated_at();

-- -----------------------------------------------------------------------------
-- budget_funding_sources
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_funding_sources (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id          UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id        UUID        NOT NULL,
    name                    TEXT        NOT NULL,
    external_reference_code TEXT,
    authorized_amount_minor BIGINT      NOT NULL,
    status                  TEXT        NOT NULL,
    display_order           INTEGER     NOT NULL DEFAULT 0,
    created_by_user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_funding_sources_period_institution_fk
        FOREIGN KEY (budget_period_id, institution_id)
        REFERENCES public.budget_periods (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_funding_sources_name_not_blank
        CHECK (BTRIM(name) <> ''),
    CONSTRAINT budget_funding_sources_authorized_amount_positive
        CHECK (authorized_amount_minor > 0),
    CONSTRAINT budget_funding_sources_authorized_amount_cap
        CHECK (authorized_amount_minor <= 9999999999999),
    CONSTRAINT budget_funding_sources_status_valid
        CHECK (status IN ('active', 'archived')),
    CONSTRAINT budget_funding_sources_id_institution_unique
        UNIQUE (id, institution_id),
    CONSTRAINT budget_funding_sources_id_period_institution_unique
        UNIQUE (id, budget_period_id, institution_id)
);

COMMENT ON TABLE public.budget_funding_sources IS
    'Funding source within a budget period (P1A). authorized_amount_minor is ILS minor units (BIGINT).';

COMMENT ON COLUMN public.budget_funding_sources.authorized_amount_minor IS
    'ILS minor units only. ₪1.00 = 100 minor. Mutable in draft only (enforced in future RPC phases).';

CREATE UNIQUE INDEX idx_budget_funding_sources_active_name_per_period
    ON public.budget_funding_sources (budget_period_id, name)
    WHERE status = 'active';

CREATE INDEX idx_budget_funding_sources_period_status
    ON public.budget_funding_sources (budget_period_id, status);

CREATE INDEX idx_budget_funding_sources_institution_period
    ON public.budget_funding_sources (institution_id, budget_period_id);

DROP TRIGGER IF EXISTS budget_funding_sources_set_updated_at ON public.budget_funding_sources;
CREATE TRIGGER budget_funding_sources_set_updated_at
    BEFORE UPDATE ON public.budget_funding_sources
    FOR EACH ROW
    EXECUTE PROCEDURE public.set_updated_at();

-- -----------------------------------------------------------------------------
-- budget_categories — two-level hierarchy (Category → Sub-category)
-- -----------------------------------------------------------------------------

CREATE TABLE public.budget_categories (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id          UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    budget_period_id        UUID        NOT NULL,
    funding_source_id       UUID        NOT NULL,
    parent_category_id      UUID,
    name                    TEXT        NOT NULL,
    status                  TEXT        NOT NULL,
    display_order           INTEGER     NOT NULL DEFAULT 0,
    created_by_user_id      UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_categories_period_institution_fk
        FOREIGN KEY (budget_period_id, institution_id)
        REFERENCES public.budget_periods (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_categories_funding_source_scope_fk
        FOREIGN KEY (funding_source_id, budget_period_id, institution_id)
        REFERENCES public.budget_funding_sources (id, budget_period_id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_categories_parent_institution_fk
        FOREIGN KEY (parent_category_id, institution_id)
        REFERENCES public.budget_categories (id, institution_id)
        ON DELETE RESTRICT,
    CONSTRAINT budget_categories_name_not_blank
        CHECK (BTRIM(name) <> ''),
    CONSTRAINT budget_categories_status_valid
        CHECK (status IN ('active', 'archived')),
    CONSTRAINT budget_categories_id_institution_unique
        UNIQUE (id, institution_id)
);

COMMENT ON TABLE public.budget_categories IS
    'Two-level budget category tree under a funding source (P1A). parent_category_id NULL = level 1; non-null = level 2 sub-category.';

COMMENT ON COLUMN public.budget_categories.parent_category_id IS
    'NULL for level-1 category. References level-1 parent for sub-categories. Max depth = 2 (enforced by trigger).';

CREATE UNIQUE INDEX idx_budget_categories_active_level1_name
    ON public.budget_categories (funding_source_id, name)
    WHERE parent_category_id IS NULL
      AND status = 'active';

CREATE UNIQUE INDEX idx_budget_categories_active_level2_name
    ON public.budget_categories (parent_category_id, name)
    WHERE parent_category_id IS NOT NULL
      AND status = 'active';

CREATE INDEX idx_budget_categories_funding_source_parent_status
    ON public.budget_categories (funding_source_id, parent_category_id, status);

CREATE INDEX idx_budget_categories_budget_period_id
    ON public.budget_categories (budget_period_id);

DROP TRIGGER IF EXISTS budget_categories_set_updated_at ON public.budget_categories;
CREATE TRIGGER budget_categories_set_updated_at
    BEFORE UPDATE ON public.budget_categories
    FOR EACH ROW
    EXECUTE PROCEDURE public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Category hierarchy enforcement (max depth = 2; parent/child scope match)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_budget_category_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_parent public.budget_categories%ROWTYPE;
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

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_budget_category_hierarchy() IS
    'P1A: enforce max depth 2 and parent/child tenant scope. P1C adds leaf-stability when allocations exist. SECURITY INVOKER with fixed search_path.';

REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_budget_category_hierarchy() FROM authenticated;

DROP TRIGGER IF EXISTS budget_categories_enforce_hierarchy ON public.budget_categories;
CREATE TRIGGER budget_categories_enforce_hierarchy
    BEFORE INSERT OR UPDATE OF parent_category_id, institution_id, budget_period_id, funding_source_id
    ON public.budget_categories
    FOR EACH ROW
    EXECUTE PROCEDURE public.enforce_budget_category_hierarchy();

-- -----------------------------------------------------------------------------
-- RLS / ACL — fail closed until P1B capability helper exists
-- -----------------------------------------------------------------------------

ALTER TABLE public.budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.budget_periods FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_periods FROM anon;
REVOKE ALL ON TABLE public.budget_periods FROM authenticated;

REVOKE ALL ON TABLE public.budget_funding_sources FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_funding_sources FROM anon;
REVOKE ALL ON TABLE public.budget_funding_sources FROM authenticated;

REVOKE ALL ON TABLE public.budget_categories FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_categories FROM anon;
REVOKE ALL ON TABLE public.budget_categories FROM authenticated;

-- Intentionally no RLS policies for anon/authenticated until P1B.
-- service_role retains default ownership privileges for future SECURITY DEFINER RPCs.
