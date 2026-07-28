-- =============================================================================
-- EduFlow — Meeting Calendar: Google OAuth Phase 2
-- =============================================================================
-- OAuth connection for Managers/Secretaries only.
-- Encrypt refresh tokens before storage (Edge Function AES-GCM → BYTEA columns).
-- Cryptographic OAuth state: user + institution binding, expiry, one-time use.
-- DO NOT DEPLOY until architecture review. No Meet provisioner / Calendar events.

-- -----------------------------------------------------------------------------
-- Connection authorization status (REAUTHORIZATION_REQUIRED)
-- -----------------------------------------------------------------------------

ALTER TABLE public.user_google_connections
    ADD COLUMN IF NOT EXISTS authorization_status TEXT;

UPDATE public.user_google_connections
SET authorization_status = CASE
    WHEN revoked_at IS NOT NULL THEN 'revoked'
    WHEN refresh_token_ciphertext IS NULL THEN 'reauthorization_required'
    ELSE 'active'
END
WHERE authorization_status IS NULL;

ALTER TABLE public.user_google_connections
    ALTER COLUMN authorization_status SET DEFAULT 'active';

ALTER TABLE public.user_google_connections
    ALTER COLUMN authorization_status SET NOT NULL;

ALTER TABLE public.user_google_connections
    DROP CONSTRAINT IF EXISTS user_google_connections_authorization_status_valid;

ALTER TABLE public.user_google_connections
    ADD CONSTRAINT user_google_connections_authorization_status_valid CHECK (
        authorization_status IN ('active', 'reauthorization_required', 'revoked')
    );

COMMENT ON COLUMN public.user_google_connections.authorization_status IS
    'active = usable refresh token; reauthorization_required = user must reconnect; revoked = disconnected.';

-- -----------------------------------------------------------------------------
-- OAuth state ledger (one-time, bound, expiring)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.google_oauth_states (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_token_hash    TEXT NOT NULL,
    user_id             UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    institution_id      UUID NOT NULL REFERENCES public.institutions (id) ON DELETE RESTRICT,
    code_verifier       TEXT NOT NULL,
    redirect_uri        TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT google_oauth_states_state_token_hash_unique UNIQUE (state_token_hash),
    CONSTRAINT google_oauth_states_redirect_uri_not_blank CHECK (btrim(redirect_uri) <> ''),
    CONSTRAINT google_oauth_states_code_verifier_not_blank CHECK (btrim(code_verifier) <> '')
);

COMMENT ON TABLE public.google_oauth_states IS
    'One-time OAuth states bound to user + institution. Secrets never returned to clients.';

CREATE INDEX IF NOT EXISTS google_oauth_states_user_idx
    ON public.google_oauth_states (user_id);

CREATE INDEX IF NOT EXISTS google_oauth_states_expires_idx
    ON public.google_oauth_states (expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_oauth_states FROM PUBLIC;
REVOKE ALL ON TABLE public.google_oauth_states FROM anon;
REVOKE ALL ON TABLE public.google_oauth_states FROM authenticated;
-- No authenticated policies: deny-by-default. service_role bypasses RLS.

-- -----------------------------------------------------------------------------
-- Connected = active encrypted refresh token present
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_owner_has_google_connection(
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_google_connections AS c
        WHERE c.user_id = p_user_id
          AND c.revoked_at IS NULL
          AND c.authorization_status = 'active'
          AND c.refresh_token_ciphertext IS NOT NULL
          AND c.refresh_token_nonce IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_owner_has_google_connection(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Actor gate for OAuth start (authenticated)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_oauth_actor()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_institution_id UUID;
    v_role TEXT;
    v_status TEXT;
    v_email TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT id, institution_id, primary_role, status, email
    INTO v_id, v_institution_id, v_role, v_status, v_email
    FROM public.users
    WHERE id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_role NOT IN ('institution_manager', 'secretary') THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_institution_id IS NULL THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_id,
        'institution_id', v_institution_id,
        'primary_role', v_role,
        'email', v_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_google_oauth_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_google_oauth_actor() TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_get_google_oauth_actor() IS
    'Returns active manager/secretary actor for OAuth start. Teachers and inactive users are denied.';

-- -----------------------------------------------------------------------------
-- Status RPC: connected state + email only (never tokens)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_get_google_connection_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.user_google_connections%ROWTYPE;
    v_connection_status TEXT;
BEGIN
    PERFORM public.meeting_calendar_assert_google_integration_role();

    SELECT * INTO v_row
    FROM public.user_google_connections
    WHERE user_id = auth.uid();

    IF NOT FOUND OR v_row.revoked_at IS NOT NULL OR v_row.authorization_status = 'revoked' THEN
        RETURN jsonb_build_object(
            'ok', true,
            'connected', false,
            'connection_status', 'not_connected',
            'email', NULL
        );
    END IF;

    IF v_row.authorization_status = 'reauthorization_required'
       OR v_row.refresh_token_ciphertext IS NULL
       OR v_row.refresh_token_nonce IS NULL
    THEN
        v_connection_status := 'reauthorization_required';
        RETURN jsonb_build_object(
            'ok', true,
            'connected', false,
            'connection_status', v_connection_status,
            'email', v_row.google_account_email
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'connected', true,
        'connection_status', 'connected',
        'email', v_row.google_account_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_get_google_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_get_google_connection_status() TO authenticated;

COMMENT ON FUNCTION public.meeting_calendar_get_google_connection_status() IS
    'Manager/secretary only. Returns connected/reauthorization_required/not_connected + email. Never tokens.';

-- -----------------------------------------------------------------------------
-- Service-role: create / consume OAuth state
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_create_oauth_state(
    p_state_token_hash TEXT,
    p_user_id UUID,
    p_institution_id UUID,
    p_code_verifier TEXT,
    p_redirect_uri TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_id UUID;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF NULLIF(btrim(COALESCE(p_state_token_hash, '')), '') IS NULL THEN
        RAISE EXCEPTION 'OAuth state hash is required.' USING ERRCODE = 'P0001';
    END IF;

    IF NULLIF(btrim(COALESCE(p_code_verifier, '')), '') IS NULL THEN
        RAISE EXCEPTION 'PKCE code_verifier is required.' USING ERRCODE = 'P0001';
    END IF;

    IF NULLIF(btrim(COALESCE(p_redirect_uri, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Redirect URI is required.' USING ERRCODE = 'P0001';
    END IF;

    IF p_expires_at IS NULL OR p_expires_at <= NOW() THEN
        RAISE EXCEPTION 'OAuth state expiration must be in the future.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    IF v_user.status IS DISTINCT FROM 'active'
       OR v_user.primary_role NOT IN ('institution_manager', 'secretary')
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    -- Cross-institution manipulation rejected: bound institution must match user.
    IF v_user.institution_id IS DISTINCT FROM p_institution_id THEN
        RAISE EXCEPTION 'Institution mismatch.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.google_oauth_states (
        state_token_hash,
        user_id,
        institution_id,
        code_verifier,
        redirect_uri,
        expires_at
    ) VALUES (
        btrim(p_state_token_hash),
        p_user_id,
        p_institution_id,
        btrim(p_code_verifier),
        btrim(p_redirect_uri),
        p_expires_at
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_create_oauth_state(
    TEXT, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_create_oauth_state(
    TEXT, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_create_oauth_state(
    TEXT, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_create_oauth_state(
    TEXT, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_consume_oauth_state(
    p_state_token_hash TEXT,
    p_expected_redirect_uri TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_state public.google_oauth_states%ROWTYPE;
    v_user public.users%ROWTYPE;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF NULLIF(btrim(COALESCE(p_state_token_hash, '')), '') IS NULL THEN
        RAISE EXCEPTION 'OAuth state is required.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_state
    FROM public.google_oauth_states
    WHERE state_token_hash = btrim(p_state_token_hash)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid OAuth state.' USING ERRCODE = 'P0001';
    END IF;

    IF v_state.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'OAuth state already used.' USING ERRCODE = 'P0001';
    END IF;

    IF v_state.expires_at <= NOW() THEN
        RAISE EXCEPTION 'OAuth state expired.' USING ERRCODE = 'P0001';
    END IF;

    -- Exact redirect URI validation (must match the URI registered at start).
    IF v_state.redirect_uri IS DISTINCT FROM btrim(COALESCE(p_expected_redirect_uri, '')) THEN
        RAISE EXCEPTION 'Redirect URI mismatch.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_user FROM public.users WHERE id = v_state.user_id;
    IF NOT FOUND
       OR v_user.status IS DISTINCT FROM 'active'
       OR v_user.primary_role NOT IN ('institution_manager', 'secretary')
       OR v_user.institution_id IS DISTINCT FROM v_state.institution_id
    THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.google_oauth_states
    SET consumed_at = NOW()
    WHERE id = v_state.id
      AND consumed_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'OAuth state already used.' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', v_state.user_id,
        'institution_id', v_state.institution_id,
        'code_verifier', v_state.code_verifier,
        'redirect_uri', v_state.redirect_uri
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_service_consume_oauth_state(TEXT, TEXT) IS
    'Atomically consumes one-time OAuth state. Rejects missing/invalid/expired/reused state and redirect URI mismatch.';

-- -----------------------------------------------------------------------------
-- Upsert connection: preserve prior refresh token when Google omits a new one
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[]
);
DROP FUNCTION IF EXISTS public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, BYTEA, BYTEA, TEXT[], BOOLEAN
);

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_upsert_google_connection(
    p_user_id UUID,
    p_institution_id UUID,
    p_google_account_email TEXT,
    p_refresh_token_ciphertext_b64 TEXT,
    p_refresh_token_nonce_b64 TEXT,
    p_token_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_has_new_refresh_token BOOLEAN DEFAULT TRUE
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
    v_user public.users%ROWTYPE;
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
    ELSE
        -- Reconnection without a new refresh_token: keep previous credentials.
        IF NOT FOUND
           OR v_existing.refresh_token_ciphertext IS NULL
           OR v_existing.refresh_token_nonce IS NULL
        THEN
            RAISE EXCEPTION 'Refresh token missing and no prior token to preserve.' USING ERRCODE = 'P0001';
        END IF;
        v_cipher := v_existing.refresh_token_ciphertext;
        v_nonce := v_existing.refresh_token_nonce;
    END IF;

    INSERT INTO public.user_google_connections (
        user_id,
        institution_id,
        google_account_email,
        refresh_token_ciphertext,
        refresh_token_nonce,
        token_scopes,
        authorization_status,
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
        token_scopes = CASE
            WHEN cardinality(EXCLUDED.token_scopes) > 0 THEN EXCLUDED.token_scopes
            ELSE public.user_google_connections.token_scopes
        END,
        authorization_status = 'active',
        connected_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', p_user_id,
        'connected', true,
        'preserved_refresh_token', NOT COALESCE(p_has_new_refresh_token, TRUE)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
) IS
    'Service-role only. Accepts base64 ciphertext/nonce. When p_has_new_refresh_token=false, preserves prior token.';

-- -----------------------------------------------------------------------------
-- Revoke / reauthorization
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_revoke_google_connection(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    UPDATE public.user_google_connections
    SET
        refresh_token_ciphertext = NULL,
        refresh_token_nonce = NULL,
        authorization_status = 'revoked',
        revoked_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'connected', false);
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_revoke_google_connection(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_mark_google_reauthorization_required(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    UPDATE public.user_google_connections
    SET
        refresh_token_ciphertext = NULL,
        refresh_token_nonce = NULL,
        authorization_status = 'reauthorization_required',
        revoked_at = NULL,
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND revoked_at IS NULL;

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', p_user_id,
        'connection_status', 'reauthorization_required'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_mark_google_reauthorization_required(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_mark_google_reauthorization_required(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_mark_google_reauthorization_required(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_mark_google_reauthorization_required(UUID) TO service_role;

-- Read encrypted material for revoke/provisioner (service_role only; never for clients).
CREATE OR REPLACE FUNCTION public.meeting_calendar_service_get_google_refresh_secret(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.user_google_connections%ROWTYPE;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    SELECT * INTO v_row
    FROM public.user_google_connections
    WHERE user_id = p_user_id
      AND revoked_at IS NULL
      AND authorization_status = 'active'
      AND refresh_token_ciphertext IS NOT NULL
      AND refresh_token_nonce IS NOT NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'found', false);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'found', true,
        'user_id', v_row.user_id,
        'institution_id', v_row.institution_id,
        'refresh_token_ciphertext', encode(v_row.refresh_token_ciphertext, 'base64'),
        'refresh_token_nonce', encode(v_row.refresh_token_nonce, 'base64'),
        'google_account_email', v_row.google_account_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_service_get_google_refresh_secret(UUID) IS
    'Service-role only. Returns base64 ciphertext/nonce for Edge Function decrypt. Never grant to authenticated.';
