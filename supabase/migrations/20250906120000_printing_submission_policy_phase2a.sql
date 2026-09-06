-- =============================================================================
-- MPEX Printing Submission Policy — Phase 2A
-- =============================================================================
-- Forward-only. Exclusive policy modes: relative_notice XOR daily_cutoff.
-- Existing institutions remain on relative_notice with preserved notice minutes.
-- Does NOT rewrite printing_requests rows.
-- Does NOT implement settings UI / teacher UX (Phases 2B/2C).

-- -----------------------------------------------------------------------------
-- 1) Data model
-- -----------------------------------------------------------------------------

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS print_submission_policy_mode TEXT NOT NULL DEFAULT 'relative_notice';

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS print_daily_cutoff_local_time TIME NULL;

COMMENT ON COLUMN public.institutions.print_submission_policy_mode IS
  'Exclusive printing submission policy: relative_notice | daily_cutoff.';

COMMENT ON COLUMN public.institutions.print_daily_cutoff_local_time IS
  'Institution-local civil TIME for daily_cutoff mode only. NULL in relative_notice. Not UTC.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'institutions_print_submission_policy_mode_valid'
      AND conrelid = 'public.institutions'::regclass
  ) THEN
    ALTER TABLE public.institutions
      ADD CONSTRAINT institutions_print_submission_policy_mode_valid
      CHECK (print_submission_policy_mode IN ('relative_notice', 'daily_cutoff'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'institutions_print_submission_policy_consistency'
      AND conrelid = 'public.institutions'::regclass
  ) THEN
    ALTER TABLE public.institutions
      ADD CONSTRAINT institutions_print_submission_policy_consistency
      CHECK (
        (
          print_submission_policy_mode = 'relative_notice'
          AND print_daily_cutoff_local_time IS NULL
        )
        OR
        (
          print_submission_policy_mode = 'daily_cutoff'
          AND print_daily_cutoff_local_time IS NOT NULL
        )
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) Server enforcement — printing_validate_required_by
-- -----------------------------------------------------------------------------

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
    v_mode TEXT;
    v_cutoff TIME;
    v_now TIMESTAMPTZ := NOW();
    v_local_ts TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_req_local_date DATE;
BEGIN
    SELECT
        minimum_print_notice_minutes,
        timezone,
        print_submission_policy_mode,
        print_daily_cutoff_local_time
    INTO
        v_notice,
        v_timezone,
        v_mode,
        v_cutoff
    FROM public.institutions
    WHERE id = p_institution_id;

    IF NOT FOUND THEN
        RETURN 'PRINT_REQUEST_FORBIDDEN';
    END IF;

    IF v_mode = 'relative_notice' THEN
        -- Authoritative relative notice (minimum_print_notice_minutes).
        IF p_required_by < (v_now + make_interval(mins => v_notice)) THEN
            RETURN 'PRINT_REQUEST_TOO_LATE';
        END IF;
        RETURN NULL;
    END IF;

    IF v_mode = 'daily_cutoff' THEN
        IF v_cutoff IS NULL OR v_timezone IS NULL OR btrim(v_timezone) = '' THEN
            RETURN 'INVALID_PRINT_SETTINGS';
        END IF;

        -- Absolute past floor (notice minutes are NOT authoritative in daily mode).
        IF p_required_by < v_now THEN
            RETURN 'PRINT_REQUEST_TOO_LATE';
        END IF;

        -- Institution-local civil clock from authoritative server NOW() + institutions.timezone.
        v_local_ts := v_now AT TIME ZONE v_timezone;
        v_local_date := v_local_ts::date;
        v_local_time := v_local_ts::time;
        v_req_local_date := (p_required_by AT TIME ZONE v_timezone)::date;

        -- Exact cutoff accepted; strictly after cutoff closes same local calendar day.
        IF v_local_time > v_cutoff AND v_req_local_date = v_local_date THEN
            RETURN 'PRINT_REQUEST_SAME_DAY_CLOSED';
        END IF;

        RETURN NULL;
    END IF;

    RETURN 'INVALID_PRINT_SETTINGS';
END;
$$;

REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) Settings RPC — extend signature; drop legacy 3-arg overload
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.printing_update_institution_settings(
    p_minimum_print_notice_minutes INTEGER DEFAULT NULL,
    p_deadline_warning_minutes INTEGER DEFAULT NULL,
    p_file_retention_days INTEGER DEFAULT NULL,
    p_print_submission_policy_mode TEXT DEFAULT NULL,
    p_print_daily_cutoff_local_time TIME DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_institution_id UUID;
    v_existing_mode TEXT;
    v_existing_cutoff TIME;
    v_existing_notice INTEGER;
    v_new_mode TEXT;
    v_new_cutoff TIME;
    v_new_notice INTEGER;
BEGIN
    v_institution_id := public.printing_resolve_actor_institution();
    IF v_institution_id IS NULL THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF NOT public.auth_user_is_active_secretary_for_institution(v_institution_id)
       AND NOT public.auth_user_is_active_institution_manager_for_institution(v_institution_id)
    THEN
        RETURN public.printing_fail('SECRETARY_NOT_AUTHORIZED');
    END IF;

    SELECT
        print_submission_policy_mode,
        print_daily_cutoff_local_time,
        minimum_print_notice_minutes
    INTO
        v_existing_mode,
        v_existing_cutoff,
        v_existing_notice
    FROM public.institutions
    WHERE id = v_institution_id;

    IF NOT FOUND THEN
        RETURN public.printing_fail('PRINT_REQUEST_FORBIDDEN');
    END IF;

    IF p_minimum_print_notice_minutes IS NOT NULL
       AND (p_minimum_print_notice_minutes < 0 OR p_minimum_print_notice_minutes > 10080)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    IF p_deadline_warning_minutes IS NOT NULL
       AND (p_deadline_warning_minutes < 0 OR p_deadline_warning_minutes > 10080)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    IF p_file_retention_days IS NOT NULL
       AND (p_file_retention_days < 1 OR p_file_retention_days > 3650)
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    IF p_print_submission_policy_mode IS NOT NULL
       AND p_print_submission_policy_mode NOT IN ('relative_notice', 'daily_cutoff')
    THEN
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    v_new_mode := COALESCE(p_print_submission_policy_mode, v_existing_mode);
    v_new_notice := COALESCE(p_minimum_print_notice_minutes, v_existing_notice);

    IF v_new_mode = 'relative_notice' THEN
        -- relative_notice requires cutoff NULL; reject non-null cutoff payloads.
        IF p_print_daily_cutoff_local_time IS NOT NULL THEN
            RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
        END IF;
        v_new_cutoff := NULL;
    ELSIF v_new_mode = 'daily_cutoff' THEN
        v_new_cutoff := COALESCE(p_print_daily_cutoff_local_time, v_existing_cutoff);
        IF v_new_cutoff IS NULL THEN
            RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
        END IF;
    ELSE
        RETURN public.printing_fail('INVALID_PRINT_SETTINGS');
    END IF;

    UPDATE public.institutions
    SET
        minimum_print_notice_minutes = v_new_notice,
        deadline_warning_minutes = COALESCE(p_deadline_warning_minutes, deadline_warning_minutes),
        file_retention_days = COALESCE(p_file_retention_days, file_retention_days),
        print_submission_policy_mode = v_new_mode,
        print_daily_cutoff_local_time = v_new_cutoff
    WHERE id = v_institution_id;

    PERFORM public.printing_write_audit(
        NULL,
        NULL,
        v_institution_id,
        v_actor,
        'institution_settings_updated',
        NULL,
        NULL,
        NULL,
        jsonb_build_object(
            'minimum_print_notice_minutes', p_minimum_print_notice_minutes,
            'deadline_warning_minutes', p_deadline_warning_minutes,
            'file_retention_days', p_file_retention_days,
            'print_submission_policy_mode', p_print_submission_policy_mode,
            'print_daily_cutoff_local_time', p_print_daily_cutoff_local_time
        )
    );

    RETURN jsonb_build_object(
        'ok', true,
        'institution_id', v_institution_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER, TEXT, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER, TEXT, TIME) FROM anon;
REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER, TEXT, TIME) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER, TEXT, TIME) TO authenticated;
