-- =============================================================================
-- EduFlow Phase 2B.1A — Internal Request Notes Database Foundation
-- =============================================================================
-- Secretary-only internal notes on service requests. institution_id is
-- denormalized from the parent request for tenant-scoped access. Teachers and
-- managers have no access. UI is deferred to a later phase.

CREATE TABLE public.request_notes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID        NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    created_by_user_id  UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    note_text           TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT request_notes_note_text_not_blank CHECK (BTRIM(note_text) <> '')
);

COMMENT ON TABLE public.request_notes IS
    'Internal secretary-only notes on service requests (Phase 2B.1A).';

CREATE INDEX idx_request_notes_request_id
    ON public.request_notes (request_id);

CREATE INDEX idx_request_notes_institution_id
    ON public.request_notes (institution_id);

CREATE INDEX idx_request_notes_created_by_user_id
    ON public.request_notes (created_by_user_id);

CREATE INDEX idx_request_notes_request_id_created_at
    ON public.request_notes (request_id, created_at DESC);

CREATE TRIGGER request_notes_set_updated_at
    BEFORE UPDATE ON public.request_notes
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

COMMENT ON TRIGGER request_notes_set_updated_at ON public.request_notes IS
    'Maintains updated_at when a request note is modified.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.request_notes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_notes TO authenticated;

CREATE POLICY request_notes_secretary_select_institution
    ON public.request_notes
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );

CREATE POLICY request_notes_secretary_insert_institution
    ON public.request_notes
    FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND public.auth_user_is_active_secretary_for_institution(institution_id)
        AND public.request_belongs_to_institution(request_id, institution_id)
    );

CREATE POLICY request_notes_secretary_update_institution
    ON public.request_notes
    FOR UPDATE
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    )
    WITH CHECK (
        public.auth_user_is_active_secretary_for_institution(institution_id)
        AND public.request_belongs_to_institution(request_id, institution_id)
    );

CREATE POLICY request_notes_secretary_delete_institution
    ON public.request_notes
    FOR DELETE
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );
