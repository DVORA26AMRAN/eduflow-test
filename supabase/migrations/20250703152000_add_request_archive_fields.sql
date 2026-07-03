-- =============================================================================
-- EduFlow Phase 2C.1A — Request Archive Foundation
-- =============================================================================
-- Soft-archive support for institution requests. Archived rows remain in
-- public.requests; secretaries may set archived_at / archived_by_user_id only.
-- Physical DELETE is not granted.

ALTER TABLE public.requests
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_by_user_id UUID REFERENCES public.users (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.requests.archived_at IS
    'When set, the request is archived and hidden from the active secretary inbox (Phase 2C.1A).';

COMMENT ON COLUMN public.requests.archived_by_user_id IS
    'Secretary who archived the request; must equal auth.uid() when set (Phase 2C.1A).';

ALTER TABLE public.requests
    ADD CONSTRAINT requests_archive_fields_paired CHECK (
        (archived_at IS NULL AND archived_by_user_id IS NULL)
        OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
    );

CREATE INDEX idx_requests_institution_archived_at
    ON public.requests (institution_id, archived_at);

GRANT UPDATE (archived_at, archived_by_user_id) ON public.requests TO authenticated;

-- -----------------------------------------------------------------------------
-- Secretary column-level update enforcement (extends Phase 1B.3B.1)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_requests_secretary_update_columns()
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
       OR NEW.request_type IS DISTINCT FROM OLD.request_type
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF (NEW.archived_at IS DISTINCT FROM OLD.archived_at
        OR NEW.archived_by_user_id IS DISTINCT FROM OLD.archived_by_user_id)
       AND NEW.status IS DISTINCT FROM OLD.status
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at
            OR NEW.archived_by_user_id IS DISTINCT FROM OLD.archived_by_user_id)
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.archived_by_user_id IS NOT NULL
       AND NEW.archived_by_user_id IS DISTINCT FROM auth.uid()
    THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_requests_secretary_update_columns() IS
    'Ensures active secretaries may mutate request status or archive fields separately, not other columns.';

CREATE POLICY requests_secretary_archive_institution
    ON public.requests
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    )
    WITH CHECK (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND (
            archived_by_user_id IS NULL
            OR archived_by_user_id = auth.uid()
        )
    );
