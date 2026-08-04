-- =============================================================================
-- MPEX Printing Requests — Phase 1
-- Domain, security, storage, lifecycle contracts (no production UI)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Institution printing settings (prospective policy source of truth)
-- -----------------------------------------------------------------------------

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS minimum_print_notice_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS deadline_warning_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS file_retention_days INTEGER;

UPDATE public.institutions
SET
    minimum_print_notice_minutes = COALESCE(minimum_print_notice_minutes, 60),
    deadline_warning_minutes = COALESCE(deadline_warning_minutes, 120),
    file_retention_days = COALESCE(file_retention_days, 90)
WHERE minimum_print_notice_minutes IS NULL
   OR deadline_warning_minutes IS NULL
   OR file_retention_days IS NULL;

ALTER TABLE public.institutions
    ALTER COLUMN minimum_print_notice_minutes SET DEFAULT 60,
    ALTER COLUMN deadline_warning_minutes SET DEFAULT 120,
    ALTER COLUMN file_retention_days SET DEFAULT 90,
    ALTER COLUMN minimum_print_notice_minutes SET NOT NULL,
    ALTER COLUMN deadline_warning_minutes SET NOT NULL,
    ALTER COLUMN file_retention_days SET NOT NULL;

ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_minimum_print_notice_minutes_valid;
ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_minimum_print_notice_minutes_valid
    CHECK (minimum_print_notice_minutes >= 0 AND minimum_print_notice_minutes <= 10080);

ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_deadline_warning_minutes_valid;
ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_deadline_warning_minutes_valid
    CHECK (deadline_warning_minutes >= 0 AND deadline_warning_minutes <= 10080);

ALTER TABLE public.institutions
    DROP CONSTRAINT IF EXISTS institutions_file_retention_days_valid;
ALTER TABLE public.institutions
    ADD CONSTRAINT institutions_file_retention_days_valid
    CHECK (file_retention_days >= 1 AND file_retention_days <= 3650);

COMMENT ON COLUMN public.institutions.minimum_print_notice_minutes IS
    'Minimum minutes before required_by that a printing request may be submitted or retargeted.';
COMMENT ON COLUMN public.institutions.deadline_warning_minutes IS
    'Minutes before required_by when a request becomes visually urgent (UI in later phases).';
COMMENT ON COLUMN public.institutions.file_retention_days IS
    'Days to retain physical printing files after request completion/cancellation. Default 90.';

-- -----------------------------------------------------------------------------
-- Per-institution human-readable request number counters
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printing_request_number_counters (
    institution_id UUID PRIMARY KEY REFERENCES public.institutions (id) ON DELETE CASCADE,
    next_number INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT printing_request_number_counters_next_positive CHECK (next_number >= 1)
);

ALTER TABLE public.printing_request_number_counters ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Printing requests
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number INTEGER NOT NULL,
    institution_id UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    teacher_user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    required_by TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    assigned_secretary_user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    files_purged_at TIMESTAMPTZ,

    CONSTRAINT printing_requests_status_valid CHECK (
        status IN (
            'submitted',
            'in_progress',
            'needs_correction',
            'printed',
            'rejected',
            'cancelled'
        )
    ),
    CONSTRAINT printing_requests_number_positive CHECK (request_number > 0),
    CONSTRAINT printing_requests_institution_number_unique UNIQUE (institution_id, request_number)
);

CREATE INDEX IF NOT EXISTS idx_printing_requests_institution_id
    ON public.printing_requests (institution_id);
CREATE INDEX IF NOT EXISTS idx_printing_requests_teacher_user_id
    ON public.printing_requests (teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_printing_requests_status
    ON public.printing_requests (institution_id, status);
CREATE INDEX IF NOT EXISTS idx_printing_requests_required_by
    ON public.printing_requests (institution_id, required_by);
CREATE INDEX IF NOT EXISTS idx_printing_requests_assigned_secretary
    ON public.printing_requests (assigned_secretary_user_id)
    WHERE assigned_secretary_user_id IS NOT NULL;

COMMENT ON TABLE public.printing_requests IS
    'Teacher printing jobs. request_number is human-readable and never used for authorization.';
COMMENT ON COLUMN public.printing_requests.files_purged_at IS
    'Set when physical storage objects are removed after retention; business history remains.';

-- -----------------------------------------------------------------------------
-- Print items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.print_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printing_request_id UUID NOT NULL REFERENCES public.printing_requests (id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    storage_bucket TEXT NOT NULL DEFAULT 'printing-files',
    storage_object_path TEXT,
    original_filename TEXT NOT NULL,
    detected_file_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    display_order INTEGER NOT NULL,
    page_selection_mode TEXT NOT NULL DEFAULT 'all',
    page_selection_value TEXT,
    copies INTEGER NOT NULL DEFAULT 1,
    color_mode TEXT NOT NULL DEFAULT 'black_and_white',
    paper_size TEXT NOT NULL DEFAULT 'a4',
    orientation TEXT NOT NULL DEFAULT 'portrait',
    sides TEXT NOT NULL DEFAULT 'single_sided',
    duplex_flip_mode TEXT,
    pages_per_sheet INTEGER NOT NULL DEFAULT 1,
    scale_mode TEXT NOT NULL DEFAULT 'fit_to_page',
    custom_scale_percent INTEGER,
    "collate" BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    correction_reason TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT print_items_display_order_positive CHECK (display_order >= 1 AND display_order <= 10),
    CONSTRAINT print_items_file_size_positive CHECK (file_size_bytes > 0),
    CONSTRAINT print_items_file_size_max CHECK (file_size_bytes <= 52428800),
    CONSTRAINT print_items_copies_valid CHECK (copies >= 1 AND copies <= 500),
    CONSTRAINT print_items_page_mode_valid CHECK (page_selection_mode IN ('all', 'custom')),
    CONSTRAINT print_items_color_mode_valid CHECK (color_mode IN ('black_and_white', 'color')),
    CONSTRAINT print_items_orientation_valid CHECK (orientation IN ('portrait', 'landscape')),
    CONSTRAINT print_items_sides_valid CHECK (sides IN ('single_sided', 'double_sided')),
    CONSTRAINT print_items_duplex_flip_valid CHECK (
        duplex_flip_mode IS NULL
        OR duplex_flip_mode IN ('long_edge', 'short_edge')
    ),
    CONSTRAINT print_items_pages_per_sheet_valid CHECK (pages_per_sheet IN (1, 2, 4, 6, 9)),
    CONSTRAINT print_items_scale_mode_valid CHECK (
        scale_mode IN ('fit_to_page', 'original_100', 'custom')
    ),
    CONSTRAINT print_items_custom_scale_valid CHECK (
        custom_scale_percent IS NULL
        OR (custom_scale_percent >= 10 AND custom_scale_percent <= 400)
    ),
    CONSTRAINT print_items_status_valid CHECK (
        status IN (
            'pending',
            'processing',
            'returned_for_correction',
            'resubmitted',
            'printed',
            'rejected'
        )
    ),
    CONSTRAINT print_items_request_order_unique UNIQUE (printing_request_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_print_items_request_id
    ON public.print_items (printing_request_id);
CREATE INDEX IF NOT EXISTS idx_print_items_institution_id
    ON public.print_items (institution_id);

COMMENT ON TABLE public.print_items IS
    'Per-document print configuration. Same source file may appear more than once.';
COMMENT ON COLUMN public.print_items.copies IS
    'Positive integer. Backend upper limit is 500 copies per item (Phase 1).';

-- -----------------------------------------------------------------------------
-- Audit events (append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printing_request_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable for institution-level actions (e.g. settings updates) with no request row.
    printing_request_id UUID REFERENCES public.printing_requests (id) ON DELETE CASCADE,
    print_item_id UUID REFERENCES public.print_items (id) ON DELETE SET NULL,
    institution_id UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_printing_audit_request_id
    ON public.printing_request_audit_events (printing_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_printing_audit_institution_id
    ON public.printing_request_audit_events (institution_id, created_at DESC);

COMMENT ON TABLE public.printing_request_audit_events IS
    'Append-only printing audit trail. Never silently overwritten.';

-- -----------------------------------------------------------------------------
-- Private storage bucket
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'printing-files',
    'printing-files',
    FALSE,
    52428800,
    NULL
)
ON CONFLICT (id) DO UPDATE
SET
    public = FALSE,
    file_size_limit = 52428800;

-- =============================================================================
-- Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.printing_allowed_file_types()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'application/rtf',
        'text/plain',
        'text/rtf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
        'text/csv',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'image/tiff',
        'image/bmp'
    ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.printing_is_allowed_file_type(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(COALESCE(p_type, ''))) = ANY (
        SELECT lower(unnest(public.printing_allowed_file_types()))
    );
$$;

CREATE OR REPLACE FUNCTION public.printing_is_valid_page_selection(
    p_mode TEXT,
    p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_token TEXT;
    v_part TEXT;
    v_left INT;
    v_right INT;
BEGIN
    IF p_mode = 'all' THEN
        RETURN p_value IS NULL OR btrim(p_value) = '';
    END IF;

    IF p_mode IS DISTINCT FROM 'custom' THEN
        RETURN FALSE;
    END IF;

    IF NULLIF(btrim(COALESCE(p_value, '')), '') IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_value !~ '^[0-9,\-]+$' THEN
        RETURN FALSE;
    END IF;

    FOREACH v_token IN ARRAY string_to_array(btrim(p_value), ',')
    LOOP
        v_part := btrim(v_token);
        IF v_part = '' THEN
            RETURN FALSE;
        END IF;

        IF v_part ~ '^[0-9]+$' THEN
            IF v_part::INT < 1 THEN
                RETURN FALSE;
            END IF;
        ELSIF v_part ~ '^[0-9]+-[0-9]+$' THEN
            v_left := split_part(v_part, '-', 1)::INT;
            v_right := split_part(v_part, '-', 2)::INT;
            IF v_left < 1 OR v_right < 1 OR v_left > v_right THEN
                RETURN FALSE;
            END IF;
        ELSE
            RETURN FALSE;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.printing_allocate_request_number(
    p_institution_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_number INTEGER;
BEGIN
    INSERT INTO public.printing_request_number_counters (institution_id, next_number)
    VALUES (p_institution_id, 2)
    ON CONFLICT (institution_id) DO UPDATE
    SET next_number = public.printing_request_number_counters.next_number + 1
    RETURNING next_number - 1 INTO v_number;

    RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_allocate_request_number(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.printing_write_audit(
    p_printing_request_id UUID,
    p_print_item_id UUID,
    p_institution_id UUID,
    p_actor_user_id UUID,
    p_action TEXT,
    p_previous_state TEXT,
    p_new_state TEXT,
    p_reason TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.printing_request_audit_events (
        printing_request_id,
        print_item_id,
        institution_id,
        actor_user_id,
        action,
        previous_state,
        new_state,
        reason,
        metadata
    ) VALUES (
        p_printing_request_id,
        p_print_item_id,
        p_institution_id,
        p_actor_user_id,
        p_action,
        p_previous_state,
        p_new_state,
        NULLIF(btrim(COALESCE(p_reason, '')), ''),
        COALESCE(p_metadata, '{}'::JSONB)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_write_audit(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.printing_derive_parent_status(
    p_printing_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_parent public.printing_requests%ROWTYPE;
    v_total INTEGER := 0;
    v_printed INTEGER := 0;
    v_rejected INTEGER := 0;
    v_correction INTEGER := 0;
    v_actionable INTEGER := 0;
BEGIN
    SELECT * INTO v_parent
    FROM public.printing_requests
    WHERE id = p_printing_request_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_parent.status = 'cancelled' THEN
        RETURN 'cancelled';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'printed'),
        COUNT(*) FILTER (WHERE status = 'rejected'),
        COUNT(*) FILTER (WHERE status IN ('returned_for_correction', 'resubmitted')),
        COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'resubmitted'))
    INTO v_total, v_printed, v_rejected, v_correction, v_actionable
    FROM public.print_items
    WHERE printing_request_id = p_printing_request_id;

    IF v_total = 0 THEN
        RETURN v_parent.status;
    END IF;

    IF v_correction > 0 THEN
        RETURN 'needs_correction';
    END IF;

    IF v_printed + v_rejected = v_total AND v_printed > 0 THEN
        RETURN 'printed';
    END IF;

    IF v_rejected = v_total THEN
        RETURN 'rejected';
    END IF;

    IF v_actionable > 0 OR v_parent.assigned_secretary_user_id IS NOT NULL THEN
        RETURN 'in_progress';
    END IF;

    RETURN 'submitted';
END;
$$;

REVOKE ALL ON FUNCTION public.printing_derive_parent_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_derive_parent_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.printing_sync_parent_status(
    p_printing_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next TEXT;
    v_prev TEXT;
BEGIN
    SELECT status INTO v_prev
    FROM public.printing_requests
    WHERE id = p_printing_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_prev = 'cancelled' THEN
        RETURN 'cancelled';
    END IF;

    v_next := public.printing_derive_parent_status(p_printing_request_id);

    UPDATE public.printing_requests
    SET
        status = v_next,
        updated_at = NOW()
    WHERE id = p_printing_request_id
      AND status IS DISTINCT FROM v_next;

    RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_sync_parent_status(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.printing_item_transition_allowed(
    p_from TEXT,
    p_to TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_from = p_to THEN TRUE
        WHEN p_from = 'pending' AND p_to IN ('processing', 'returned_for_correction', 'printed', 'rejected') THEN TRUE
        WHEN p_from = 'processing' AND p_to IN ('returned_for_correction', 'printed', 'rejected', 'pending') THEN TRUE
        WHEN p_from = 'returned_for_correction' AND p_to IN ('resubmitted', 'rejected') THEN TRUE
        WHEN p_from = 'resubmitted' AND p_to IN ('processing', 'returned_for_correction', 'printed', 'rejected') THEN TRUE
        ELSE FALSE
    END;
$$;

CREATE OR REPLACE FUNCTION public.printing_is_overdue(
    p_required_by TIMESTAMPTZ,
    p_status TEXT,
    p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_required_by < p_now
       AND p_status NOT IN ('printed', 'rejected', 'cancelled');
$$;

CREATE OR REPLACE FUNCTION public.printing_validate_required_by(
    p_institution_id UUID,
    p_required_by TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notice INTEGER;
    v_timezone TEXT;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT minimum_print_notice_minutes, timezone
    INTO v_notice, v_timezone
    FROM public.institutions
    WHERE id = p_institution_id;

    IF NOT FOUND THEN
        RETURN 'PRINT_REQUEST_FORBIDDEN';
    END IF;

    -- Instant comparison; callers must build required_by using institution timezone.
    IF p_required_by < (v_now + make_interval(mins => v_notice)) THEN
        RETURN 'PRINT_REQUEST_TOO_LATE';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) TO authenticated;

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.printing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printing_request_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.printing_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.print_items FROM PUBLIC;
REVOKE ALL ON TABLE public.printing_request_audit_events FROM PUBLIC;
REVOKE ALL ON TABLE public.printing_request_number_counters FROM PUBLIC;
REVOKE ALL ON TABLE public.printing_requests FROM anon;
REVOKE ALL ON TABLE public.print_items FROM anon;
REVOKE ALL ON TABLE public.printing_request_audit_events FROM anon;
REVOKE ALL ON TABLE public.printing_request_number_counters FROM anon;
REVOKE ALL ON TABLE public.printing_requests FROM authenticated;
REVOKE ALL ON TABLE public.print_items FROM authenticated;
REVOKE ALL ON TABLE public.printing_request_audit_events FROM authenticated;
REVOKE ALL ON TABLE public.printing_request_number_counters FROM authenticated;

GRANT SELECT ON public.printing_requests TO authenticated;
GRANT SELECT ON public.print_items TO authenticated;
GRANT SELECT ON public.printing_request_audit_events TO authenticated;

-- Append-only audit: reject UPDATE/DELETE from any role path.
CREATE OR REPLACE FUNCTION public.printing_audit_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'printing_request_audit_events is append-only'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS printing_audit_no_update ON public.printing_request_audit_events;
CREATE TRIGGER printing_audit_no_update
    BEFORE UPDATE ON public.printing_request_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.printing_audit_reject_mutation();

DROP TRIGGER IF EXISTS printing_audit_no_delete ON public.printing_request_audit_events;
CREATE TRIGGER printing_audit_no_delete
    BEFORE DELETE ON public.printing_request_audit_events
    FOR EACH ROW
    EXECUTE PROCEDURE public.printing_audit_reject_mutation();

DROP POLICY IF EXISTS printing_requests_teacher_select_own ON public.printing_requests;
CREATE POLICY printing_requests_teacher_select_own
    ON public.printing_requests
    FOR SELECT
    TO authenticated
    USING (
        teacher_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_for_institution(institution_id)
    );

DROP POLICY IF EXISTS printing_requests_staff_select_institution ON public.printing_requests;
CREATE POLICY printing_requests_staff_select_institution
    ON public.printing_requests
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

DROP POLICY IF EXISTS print_items_teacher_select_own ON public.print_items;
CREATE POLICY print_items_teacher_select_own
    ON public.print_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = print_items.printing_request_id
              AND r.teacher_user_id = auth.uid()
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
        )
    );

DROP POLICY IF EXISTS print_items_staff_select_institution ON public.print_items;
CREATE POLICY print_items_staff_select_institution
    ON public.print_items
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

DROP POLICY IF EXISTS printing_audit_teacher_select_own ON public.printing_request_audit_events;
CREATE POLICY printing_audit_teacher_select_own
    ON public.printing_request_audit_events
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = printing_request_audit_events.printing_request_id
              AND r.teacher_user_id = auth.uid()
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
        )
    );

DROP POLICY IF EXISTS printing_audit_staff_select_institution ON public.printing_request_audit_events;
CREATE POLICY printing_audit_staff_select_institution
    ON public.printing_request_audit_events
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        OR public.auth_user_is_active_institution_manager_for_institution(institution_id)
    );

-- Storage path helper: {institution_id}/{request_id}/{item_id}/{object}
CREATE OR REPLACE FUNCTION public.printing_institution_id_from_storage_path(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_part TEXT;
BEGIN
    v_part := split_part(p_name, '/', 1);
    IF v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_part::UUID;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.printing_request_id_from_storage_path(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_part TEXT;
BEGIN
    v_part := split_part(p_name, '/', 2);
    IF v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_part::UUID;
    END IF;
    RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS printing_files_teacher_select ON storage.objects;
CREATE POLICY printing_files_teacher_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'printing-files'
        AND EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = public.printing_request_id_from_storage_path(name)
              AND r.teacher_user_id = auth.uid()
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
        )
    );

DROP POLICY IF EXISTS printing_files_teacher_insert ON storage.objects;
CREATE POLICY printing_files_teacher_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'printing-files'
        AND EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = public.printing_request_id_from_storage_path(name)
              AND r.teacher_user_id = auth.uid()
              AND r.assigned_secretary_user_id IS NULL
              AND r.status IN ('submitted', 'needs_correction')
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
        )
    );

DROP POLICY IF EXISTS printing_files_staff_select ON storage.objects;
CREATE POLICY printing_files_staff_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'printing-files'
        AND (
            public.auth_user_is_active_secretary_for_institution(
                public.printing_institution_id_from_storage_path(name)
            )
            OR public.auth_user_is_active_institution_manager_for_institution(
                public.printing_institution_id_from_storage_path(name)
            )
        )
    );
