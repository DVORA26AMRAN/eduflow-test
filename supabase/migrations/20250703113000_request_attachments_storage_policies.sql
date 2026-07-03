-- =============================================================================
-- EduFlow Phase 1D.1C — Request Attachments Storage Policies
-- =============================================================================
-- RLS on storage.objects for the private request-attachments bucket.
-- Path-level validation is deferred; policies scope access by bucket and role.

CREATE OR REPLACE FUNCTION public.auth_user_is_active_secretary()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = auth.uid()
          AND u.primary_role = 'secretary'
          AND u.status = 'active'
    );
$$;

COMMENT ON FUNCTION public.auth_user_is_active_secretary() IS
    'Returns true when the authenticated user is an active secretary.';

REVOKE ALL ON FUNCTION public.auth_user_is_active_secretary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_is_active_secretary() TO authenticated;

CREATE POLICY request_attachments_storage_teacher_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'request-attachments'
        AND public.auth_user_is_active_teacher()
    );

CREATE POLICY request_attachments_storage_teacher_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'request-attachments'
        AND public.auth_user_is_active_teacher()
    );

CREATE POLICY request_attachments_storage_secretary_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'request-attachments'
        AND public.auth_user_is_active_secretary()
    );
