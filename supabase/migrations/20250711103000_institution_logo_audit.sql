-- =============================================================================
-- EduFlow — Institution logo change audit logging
-- =============================================================================
-- Writes to audit_logs when logo_url changes. Uses SECURITY DEFINER because
-- regular users cannot insert audit rows directly.

CREATE OR REPLACE FUNCTION public.write_institution_logo_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_action TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.logo_url IS NOT DISTINCT FROM OLD.logo_url THEN
        RETURN NEW;
    END IF;

    IF OLD.logo_url IS NULL AND NEW.logo_url IS NOT NULL THEN
        v_action := 'institution_logo_uploaded';
    ELSIF OLD.logo_url IS NOT NULL AND NEW.logo_url IS NULL THEN
        v_action := 'institution_logo_removed';
    ELSE
        v_action := 'institution_logo_replaced';
    END IF;

    INSERT INTO public.audit_logs (
        institution_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
    )
    VALUES (
        NEW.id,
        auth.uid(),
        v_action,
        'institution',
        NEW.id,
        jsonb_build_object(
            'previous_logo_url', OLD.logo_url,
            'new_logo_url', NEW.logo_url
        ),
        NOW()
    );

    RETURN NEW;
EXCEPTION
    WHEN undefined_column OR undefined_table THEN
        RAISE WARNING 'institution logo audit skipped: audit_logs schema mismatch';
        RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.write_institution_logo_audit_log() IS
    'Audit trail for institution logo upload, replacement, and removal.';

DROP TRIGGER IF EXISTS institution_logo_audit_trigger ON public.institutions;

CREATE TRIGGER institution_logo_audit_trigger
    AFTER UPDATE OF logo_url ON public.institutions
    FOR EACH ROW
    EXECUTE FUNCTION public.write_institution_logo_audit_log();
