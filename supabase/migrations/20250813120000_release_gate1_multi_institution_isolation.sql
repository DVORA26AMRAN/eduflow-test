-- =============================================================================
-- Release Gate 1 — Multi-institution isolation hardening
-- =============================================================================
-- Proven defects addressed (minimal, fail-closed):
-- 1) request-attachments Storage: any active teacher could read/write the whole
--    private bucket (role-only policies; teacher SELECT never dropped).
-- 2) printing-files teacher insert/select: path institution prefix not bound to
--    the printing_request.institution_id (path spoof into foreign namespace).
-- 3) meeting_calendar_user_profile: returned institution/role/status for any
--    user id (cross-tenant profile probe).
-- 4) requests teacher INSERT: bind institution_id to caller's institution so
--    client-supplied institution_id cannot retag another tenant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Request attachments Storage — path + request authorization
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.institution_id_from_attachment_storage_path(p_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_part TEXT;
BEGIN
    v_part := split_part(p_path, '/', 1);
    IF v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN v_part::UUID;
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.institution_id_from_attachment_storage_path(TEXT) IS
    'Extracts institution UUID from request-attachments object path prefix.';

REVOKE ALL ON FUNCTION public.institution_id_from_attachment_storage_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.institution_id_from_attachment_storage_path(TEXT) TO authenticated;

DROP POLICY IF EXISTS request_attachments_storage_teacher_insert ON storage.objects;
DROP POLICY IF EXISTS request_attachments_storage_teacher_select ON storage.objects;
DROP POLICY IF EXISTS request_attachments_storage_secretary_select ON storage.objects;
DROP POLICY IF EXISTS request_attachments_storage_recipient_select ON storage.objects;

CREATE POLICY request_attachments_storage_teacher_insert
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'request-attachments'
        AND EXISTS (
            SELECT 1
            FROM public.requests AS r
            WHERE r.id = public.request_id_from_attachment_storage_path(name)
              AND r.created_by_user_id = auth.uid()
              AND r.institution_id = public.institution_id_from_attachment_storage_path(name)
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
        )
    );

CREATE POLICY request_attachments_storage_authorized_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'request-attachments'
        AND public.auth_user_can_read_institution_request(
            public.request_id_from_attachment_storage_path(name)
        )
        AND EXISTS (
            SELECT 1
            FROM public.requests AS r
            WHERE r.id = public.request_id_from_attachment_storage_path(name)
              AND r.institution_id = public.institution_id_from_attachment_storage_path(name)
        )
    );

-- -----------------------------------------------------------------------------
-- 2) Printing files — bind path institution to request institution
-- -----------------------------------------------------------------------------

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
              AND r.institution_id = public.printing_institution_id_from_storage_path(name)
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
              AND r.institution_id = public.printing_institution_id_from_storage_path(name)
              AND r.status IN ('submitted', 'needs_correction', 'in_progress')
              AND public.auth_user_is_active_teacher_for_institution(r.institution_id)
              AND (
                  r.assigned_secretary_user_id IS NULL
                  OR EXISTS (
                      SELECT 1
                      FROM public.print_items AS i
                      WHERE i.printing_request_id = r.id
                        AND i.id::text = split_part(name, '/', 3)
                        AND i.status = 'returned_for_correction'
                  )
              )
        )
    );

-- Staff select already uses path institution helpers; also require matching request row
-- so a foreign-prefix object without a matching tenant request is not readable.
DROP POLICY IF EXISTS printing_files_staff_select ON storage.objects;
CREATE POLICY printing_files_staff_select
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'printing-files'
        AND EXISTS (
            SELECT 1
            FROM public.printing_requests AS r
            WHERE r.id = public.printing_request_id_from_storage_path(name)
              AND r.institution_id = public.printing_institution_id_from_storage_path(name)
              AND (
                  public.auth_user_is_active_secretary_for_institution(r.institution_id)
                  OR public.auth_user_is_active_institution_manager_for_institution(r.institution_id)
              )
        )
    );

-- -----------------------------------------------------------------------------
-- 3) Meeting calendar profile lookup — same institution only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_user_profile(p_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    institution_id UUID,
    primary_role TEXT,
    status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.institution_id, u.primary_role, u.status
    FROM public.users AS u
    WHERE u.id = p_user_id
      AND (
          u.id = auth.uid()
          OR (
              u.institution_id IS NOT NULL
              AND u.institution_id = (
                  SELECT caller.institution_id
                  FROM public.users AS caller
                  WHERE caller.id = auth.uid()
              )
          )
      );
$$;

COMMENT ON FUNCTION public.meeting_calendar_user_profile(UUID) IS
    'Returns profile fields for self or same-institution users only (no cross-tenant probe).';

REVOKE ALL ON FUNCTION public.meeting_calendar_user_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_user_profile(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) Requests INSERT — derive institution from caller (fail closed)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_requests_teacher_insert_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_institution_id UUID;
BEGIN
    IF NOT public.auth_user_is_active_teacher() THEN
        RETURN NEW;
    END IF;

    IF NEW.created_by_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.institution_id
    INTO v_caller_institution_id
    FROM public.users AS u
    WHERE u.id = auth.uid()
      AND u.primary_role = 'teacher'
      AND u.status = 'active';

    IF v_caller_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.'
            USING ERRCODE = '42501';
    END IF;

    -- Never trust client-supplied institution_id for tenant inserts.
    NEW.institution_id := v_caller_institution_id;

    IF NEW.request_type = 'general_request' THEN
        IF NEW.recipient_role IS NULL
           OR NEW.recipient_role NOT IN ('secretary', 'institution_manager')
        THEN
            RAISE EXCEPTION 'general_request requires a valid recipient_role.'
                USING ERRCODE = '23514';
        END IF;

        IF BTRIM(NEW.description) = '' THEN
            RAISE EXCEPTION 'general_request requires a subject.'
                USING ERRCODE = '23514';
        END IF;

        IF BTRIM(COALESCE(NEW.request_payload ->> 'message', '')) = '' THEN
            RAISE EXCEPTION 'general_request requires a message.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.recipient_role IS NOT NULL THEN
        RAISE EXCEPTION 'recipient_role is only allowed for general_request.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_requests_teacher_insert_columns() IS
    'Teacher request INSERT guard: bind institution_id to caller and validate general_request fields.';
