-- =============================================================================
-- EduFlow Phase 1B.4B — Automatic Request Status History Writing
-- =============================================================================
-- Records every authenticated status change on public.requests into
-- public.request_status_history. Writes run via SECURITY DEFINER so no INSERT
-- policy is required for authenticated users.

CREATE OR REPLACE FUNCTION public.write_request_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required to record request status history.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.request_status_history (
        request_id,
        institution_id,
        changed_by_user_id,
        previous_status,
        new_status,
        created_at
    ) VALUES (
        NEW.id,
        NEW.institution_id,
        auth.uid(),
        OLD.status,
        NEW.status,
        NOW()
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.write_request_status_history() IS
    'AFTER UPDATE trigger function: append a status history row when requests.status changes.';

CREATE TRIGGER requests_write_status_history
    AFTER UPDATE OF status ON public.requests
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE PROCEDURE public.write_request_status_history();

COMMENT ON TRIGGER requests_write_status_history ON public.requests IS
    'Automatically writes request_status_history when status changes (Phase 1B.4B).';
