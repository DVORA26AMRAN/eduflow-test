-- =============================================================================
-- EduFlow Phase 1D.1A — Request Attachments Database Foundation
-- =============================================================================
-- Metadata table for files stored in Supabase Storage. institution_id is
-- denormalized from the parent request for tenant-scoped secretary reads.
-- UPDATE/DELETE policies and Storage object RLS are deferred to a later phase.

CREATE TABLE public.request_attachments (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID        NOT NULL REFERENCES public.requests (id) ON DELETE CASCADE,
    institution_id      UUID        NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    uploaded_by_user_id UUID        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    storage_bucket      TEXT        NOT NULL,
    storage_path        TEXT        NOT NULL,
    file_name           TEXT        NOT NULL,
    file_type           TEXT        NOT NULL,
    file_size_bytes     INTEGER     NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT request_attachments_file_size_bytes_positive CHECK (file_size_bytes > 0),
    CONSTRAINT request_attachments_storage_path_not_blank CHECK (BTRIM(storage_path) <> ''),
    CONSTRAINT request_attachments_file_name_not_blank CHECK (BTRIM(file_name) <> '')
);

COMMENT ON TABLE public.request_attachments IS
    'Metadata for files attached to service requests (Phase 1D.1A).';

CREATE INDEX idx_request_attachments_request_id
    ON public.request_attachments (request_id);

CREATE INDEX idx_request_attachments_institution_id
    ON public.request_attachments (institution_id);

CREATE INDEX idx_request_attachments_uploaded_by_user_id
    ON public.request_attachments (uploaded_by_user_id);

CREATE INDEX idx_request_attachments_request_id_created_at
    ON public.request_attachments (request_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS helpers (SECURITY DEFINER avoids recursion with users/requests policies)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_belongs_to_institution(
    p_request_id UUID,
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.requests AS r
        WHERE r.id = p_request_id
          AND r.institution_id = p_institution_id
    );
$$;

COMMENT ON FUNCTION public.request_belongs_to_institution(UUID, UUID) IS
    'Returns true when the given request belongs to the given institution.';

REVOKE ALL ON FUNCTION public.request_belongs_to_institution(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_belongs_to_institution(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.request_attachments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.request_attachments TO authenticated;

CREATE POLICY request_attachments_teacher_select_own_requests
    ON public.request_attachments
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_teacher_who_created_request(request_id)
    );

CREATE POLICY request_attachments_teacher_insert_own_requests
    ON public.request_attachments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        uploaded_by_user_id = auth.uid()
        AND public.auth_user_is_active_teacher_who_created_request(request_id)
        AND public.request_belongs_to_institution(request_id, institution_id)
    );

CREATE POLICY request_attachments_secretary_select_institution
    ON public.request_attachments
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_is_active_secretary_for_institution(institution_id)
    );

-- -----------------------------------------------------------------------------
-- Supabase Storage bucket
-- -----------------------------------------------------------------------------
-- Private bucket for request file binaries. Object-level Storage RLS policies
-- are deferred until the upload UI phase. Recommended object path layout:
--   {institution_id}/{request_id}/{attachment_id}/{file_name}
-- storage_path in public.request_attachments should store the full object key.

INSERT INTO storage.buckets (id, name, public)
VALUES ('request-attachments', 'request-attachments', false)
ON CONFLICT (id) DO NOTHING;
