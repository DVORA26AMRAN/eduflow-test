-- =============================================================================
-- EduFlow — Institution logo branding fields
-- =============================================================================
-- Maps to application "school" branding: logoUrl / logoUpdatedAt on institutions.

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.institutions.logo_url IS
    'Public or signed URL reference to the institution logo file in storage. NULL shows the UI placeholder.';

COMMENT ON COLUMN public.institutions.logo_updated_at IS
    'Timestamp of the latest logo upload, replacement, or removal.';
