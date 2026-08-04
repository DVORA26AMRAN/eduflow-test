-- After a successful Google reconnect, clear stale meeting-level Meet provision
-- failure state so the UI can offer "Create Google Meet" without auto-enqueueing.
--
-- Valid meet_provision_status values remain:
--   not_applicable | google_not_connected | pending | ready | failed
-- There is no not_requested status; google_not_connected + active connection is
-- the retryable "ready to create" meeting state.

CREATE OR REPLACE FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(
    p_calendar_owner_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER := 0;
BEGIN
    IF p_calendar_owner_id IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.meetings
    SET
        meet_provision_status = 'google_not_connected',
        meet_provision_error = NULL,
        updated_at = NOW()
    WHERE calendar_owner_id = p_calendar_owner_id
      AND meeting_format = 'online'
      AND current_state = 'CONFIRMED'
      AND NULLIF(btrim(COALESCE(meet_url, '')), '') IS NULL
      AND meet_provision_status IN ('google_not_connected', 'failed')
      AND meet_provision_error IN ('REAUTHORIZATION_REQUIRED', 'GOOGLE_NOT_CONNECTED');

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(UUID) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_clear_stale_meet_reauth_state(UUID) IS
    'Clears stale Meet reauth meeting rows after Google reconnect. Does not enqueue provisioning.';

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_upsert_google_connection(
    p_user_id UUID,
    p_institution_id UUID,
    p_google_account_email TEXT,
    p_refresh_token_ciphertext_b64 TEXT,
    p_refresh_token_nonce_b64 TEXT,
    p_token_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_has_new_refresh_token BOOLEAN DEFAULT TRUE,
    p_encryption_key_id TEXT DEFAULT 'v1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.user_google_connections%ROWTYPE;
    v_cipher BYTEA;
    v_nonce BYTEA;
    v_key_id TEXT;
    v_user public.users%ROWTYPE;
    v_key_status TEXT;
    v_cleared_meetings INTEGER := 0;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
    IF NOT FOUND
       OR v_user.status IS DISTINCT FROM 'active'
       OR v_user.primary_role NOT IN ('institution_manager', 'secretary')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_user.institution_id IS DISTINCT FROM p_institution_id THEN
        RAISE EXCEPTION 'Institution mismatch.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing
    FROM public.user_google_connections
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF COALESCE(p_has_new_refresh_token, TRUE) THEN
        IF NULLIF(btrim(COALESCE(p_refresh_token_ciphertext_b64, '')), '') IS NULL
           OR NULLIF(btrim(COALESCE(p_refresh_token_nonce_b64, '')), '') IS NULL
        THEN
            RAISE EXCEPTION 'Encrypted refresh token is required.' USING ERRCODE = 'P0001';
        END IF;
        v_cipher := decode(btrim(p_refresh_token_ciphertext_b64), 'base64');
        v_nonce := decode(btrim(p_refresh_token_nonce_b64), 'base64');
        v_key_id := NULLIF(btrim(COALESCE(p_encryption_key_id, '')), '');
        IF v_key_id IS NULL THEN
            RAISE EXCEPTION 'encryption_key_id is required for new refresh tokens.' USING ERRCODE = 'P0001';
        END IF;
        SELECT status INTO v_key_status
        FROM public.google_token_encryption_keys
        WHERE key_id = v_key_id;
        IF NOT FOUND OR v_key_status IS DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'encryption_key_id must reference the active encryption key.' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        IF NOT FOUND
           OR v_existing.refresh_token_ciphertext IS NULL
           OR v_existing.refresh_token_nonce IS NULL
        THEN
            RAISE EXCEPTION 'Refresh token missing and no prior token to preserve.' USING ERRCODE = 'P0001';
        END IF;
        v_cipher := v_existing.refresh_token_ciphertext;
        v_nonce := v_existing.refresh_token_nonce;
        v_key_id := v_existing.encryption_key_id;
    END IF;

    INSERT INTO public.user_google_connections (
        user_id,
        institution_id,
        google_account_email,
        refresh_token_ciphertext,
        refresh_token_nonce,
        token_scopes,
        authorization_status,
        encryption_key_id,
        connected_at,
        revoked_at
    ) VALUES (
        p_user_id,
        p_institution_id,
        NULLIF(btrim(COALESCE(p_google_account_email, '')), ''),
        v_cipher,
        v_nonce,
        COALESCE(p_token_scopes, ARRAY[]::TEXT[]),
        'active',
        v_key_id,
        NOW(),
        NULL
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        institution_id = EXCLUDED.institution_id,
        google_account_email = COALESCE(
            EXCLUDED.google_account_email,
            public.user_google_connections.google_account_email
        ),
        refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        refresh_token_nonce = EXCLUDED.refresh_token_nonce,
        encryption_key_id = EXCLUDED.encryption_key_id,
        token_scopes = CASE
            WHEN cardinality(EXCLUDED.token_scopes) > 0 THEN EXCLUDED.token_scopes
            ELSE public.user_google_connections.token_scopes
        END,
        authorization_status = 'active',
        connected_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW();

    -- Clear stale meeting reauth rows only. Never enqueue Meet provisioning here.
    v_cleared_meetings := public.meeting_calendar_clear_stale_meet_reauth_state(p_user_id);

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', p_user_id,
        'connected', true,
        'preserved_refresh_token', NOT COALESCE(p_has_new_refresh_token, TRUE),
        'encryption_key_id', v_key_id,
        'cleared_stale_meet_reauth_count', v_cleared_meetings
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, TEXT
) TO service_role;

-- One-time backfill for owners already reconnected while meetings still carry
-- stale REAUTHORIZATION_REQUIRED / GOOGLE_NOT_CONNECTED provision errors.
UPDATE public.meetings AS m
SET
    meet_provision_status = 'google_not_connected',
    meet_provision_error = NULL,
    updated_at = NOW()
FROM public.user_google_connections AS c
WHERE c.user_id = m.calendar_owner_id
  AND c.authorization_status = 'active'
  AND c.revoked_at IS NULL
  AND c.refresh_token_ciphertext IS NOT NULL
  AND c.refresh_token_nonce IS NOT NULL
  AND m.meeting_format = 'online'
  AND m.current_state = 'CONFIRMED'
  AND NULLIF(btrim(COALESCE(m.meet_url, '')), '') IS NULL
  AND m.meet_provision_status IN ('google_not_connected', 'failed')
  AND m.meet_provision_error IN ('REAUTHORIZATION_REQUIRED', 'GOOGLE_NOT_CONNECTED');
