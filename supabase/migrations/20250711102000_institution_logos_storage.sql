-- =============================================================================
-- EduFlow — Institution logos storage bucket and policies
-- =============================================================================
-- Public read bucket for school branding images. Writes restricted to platform admins.
-- Object key layout: {institution_id}/{generated_uuid}.{ext}

INSERT INTO storage.buckets (id, name, public)
VALUES ('institution-logos', 'institution-logos', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

CREATE POLICY institution_logos_storage_platform_admin_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

CREATE POLICY institution_logos_storage_platform_admin_update
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    )
    WITH CHECK (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

CREATE POLICY institution_logos_storage_platform_admin_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'institution-logos'
        AND public.auth_user_is_active_platform_admin()
    );

CREATE POLICY institution_logos_storage_authenticated_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'institution-logos');
