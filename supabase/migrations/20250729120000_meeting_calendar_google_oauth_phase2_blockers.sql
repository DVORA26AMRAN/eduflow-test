-- =============================================================================
-- EduFlow — Google OAuth Phase 2 blockers (architecture review)
-- =============================================================================
-- 1) OAuth state automatic cleanup + retention policy (documented below).
-- 2) Encryption key rotation readiness: encryption_key_id, key registry,
--    dual-key decrypt support via Edge secrets, re-encrypt claim RPCs.
--    Production key rotation is NOT executed by this migration.
-- DO NOT DEPLOY until review approval. No Phase 3 Meet provisioner work.
--
-- -----------------------------------------------------------------------------
-- RETENTION POLICY — google_oauth_states
-- -----------------------------------------------------------------------------
-- Purpose: minimize exposure of PKCE code_verifier and state metadata.
--
-- | Row class                         | Retention                         | Action   |
-- |-----------------------------------|-----------------------------------|----------|
-- | consumed (consumed_at IS NOT NULL)| 24 hours after consumed_at        | DELETE   |
-- | expired unconsumed                | immediately when expires_at < now |
-- |                                   | (cleanup grace: none)             | DELETE   |
-- | active unconsumed, not expired    | kept until consume or expiry      | keep     |
--
-- Cleanup entrypoints:
--   - meeting_calendar_cleanup_google_oauth_states() [service_role]
--   - Invoked opportunistically from OAuth Edge Functions after start/callback
--   - May also be scheduled later (same RPC); no pg_cron enabled here.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Encryption key registry (metadata only — raw keys NEVER stored in Postgres)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.google_token_encryption_keys (
    key_id          TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at      TIMESTAMPTZ,
    notes           TEXT,
    CONSTRAINT google_token_encryption_keys_status_valid CHECK (
        status IN ('active', 'decrypt_only', 'retired')
    ),
    CONSTRAINT google_token_encryption_keys_retired_paired CHECK (
        (status = 'retired' AND retired_at IS NOT NULL)
        OR (status <> 'retired' AND retired_at IS NULL)
    )
);

COMMENT ON TABLE public.google_token_encryption_keys IS
    'Metadata registry for AES-GCM key ids. Raw key material lives only in Edge secrets. Dual-key decrypt: active + decrypt_only.';

ALTER TABLE public.google_token_encryption_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_token_encryption_keys FROM PUBLIC;
REVOKE ALL ON TABLE public.google_token_encryption_keys FROM anon;
REVOKE ALL ON TABLE public.google_token_encryption_keys FROM authenticated;

INSERT INTO public.google_token_encryption_keys (key_id, status, notes)
VALUES (
    'v1',
    'active',
    'Initial Google refresh-token encryption key. Rotation: set previous to decrypt_only, insert new active, re-encrypt rows, then retire previous.'
)
ON CONFLICT (key_id) DO NOTHING;

-- At most one active key (enforced by partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS google_token_encryption_keys_one_active
    ON public.google_token_encryption_keys (status)
    WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- Connection rows carry encryption_key_id for dual-key decrypt / re-encrypt
-- -----------------------------------------------------------------------------

ALTER TABLE public.user_google_connections
    ADD COLUMN IF NOT EXISTS encryption_key_id TEXT;

UPDATE public.user_google_connections
SET encryption_key_id = 'v1'
WHERE encryption_key_id IS NULL
  AND refresh_token_ciphertext IS NOT NULL;

UPDATE public.user_google_connections
SET encryption_key_id = NULL
WHERE refresh_token_ciphertext IS NULL
  AND encryption_key_id IS NOT NULL;

ALTER TABLE public.user_google_connections
    DROP CONSTRAINT IF EXISTS user_google_connections_encryption_key_id_fk;

-- Nullable when no ciphertext; when ciphertext present, key_id required (CHECK).
ALTER TABLE public.user_google_connections
    DROP CONSTRAINT IF EXISTS user_google_connections_encryption_key_paired;

ALTER TABLE public.user_google_connections
    ADD CONSTRAINT user_google_connections_encryption_key_paired CHECK (
        (refresh_token_ciphertext IS NULL AND refresh_token_nonce IS NULL)
        OR (
            refresh_token_ciphertext IS NOT NULL
            AND refresh_token_nonce IS NOT NULL
            AND encryption_key_id IS NOT NULL
        )
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_google_connections_encryption_key_id_fk'
    ) THEN
        ALTER TABLE public.user_google_connections
            ADD CONSTRAINT user_google_connections_encryption_key_id_fk
            FOREIGN KEY (encryption_key_id)
            REFERENCES public.google_token_encryption_keys (key_id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

COMMENT ON COLUMN public.user_google_connections.encryption_key_id IS
    'AES-GCM key id used for refresh_token_ciphertext. Dual-key decrypt uses active + decrypt_only registry statuses.';

CREATE INDEX IF NOT EXISTS user_google_connections_reencrypt_idx
    ON public.user_google_connections (encryption_key_id)
    WHERE refresh_token_ciphertext IS NOT NULL
      AND revoked_at IS NULL
      AND authorization_status = 'active';

-- -----------------------------------------------------------------------------
-- OAuth state cleanup (automatic)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_cleanup_google_oauth_states(
    p_now TIMESTAMPTZ DEFAULT NOW(),
    p_consumed_retention INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ;
    v_deleted_consumed INTEGER := 0;
    v_deleted_expired INTEGER := 0;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    v_now := COALESCE(p_now, NOW());

    -- Expired unconsumed: delete as soon as expires_at has passed.
    WITH deleted AS (
        DELETE FROM public.google_oauth_states
        WHERE consumed_at IS NULL
          AND expires_at < v_now
        RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO v_deleted_expired FROM deleted;

    -- Consumed: retain 24h for incident triage, then delete.
    WITH deleted AS (
        DELETE FROM public.google_oauth_states
        WHERE consumed_at IS NOT NULL
          AND consumed_at < (v_now - COALESCE(p_consumed_retention, INTERVAL '24 hours'))
        RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO v_deleted_consumed FROM deleted;

    RETURN jsonb_build_object(
        'ok', true,
        'deleted_expired_unconsumed', v_deleted_expired,
        'deleted_consumed', v_deleted_consumed,
        'consumed_retention', COALESCE(p_consumed_retention, INTERVAL '24 hours')::TEXT,
        'policy', 'expired_unconsumed:delete_at_expiry; consumed:delete_after_24h'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_cleanup_google_oauth_states(TIMESTAMPTZ, INTERVAL) IS
    'Retention: delete expired unconsumed immediately; delete consumed after 24h. service_role only. No pg_cron in this migration.';

-- -----------------------------------------------------------------------------
-- Upsert: persist encryption_key_id with ciphertext
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.meeting_calendar_service_upsert_google_connection(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT[], BOOLEAN
);

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

    RETURN jsonb_build_object(
        'ok', true,
        'user_id', p_user_id,
        'connected', true,
        'preserved_refresh_token', NOT COALESCE(p_has_new_refresh_token, TRUE),
        'encryption_key_id', v_key_id
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

-- Revoke clears key id with ciphertext
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
        encryption_key_id = NULL,
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
        encryption_key_id = NULL,
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
        'encryption_key_id', v_row.encryption_key_id,
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

-- -----------------------------------------------------------------------------
-- Background re-encryption helpers (schema ready; production rotation NOT run)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(
    p_target_key_id TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER;
    v_rows JSONB := '[]'::JSONB;
    v_row RECORD;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF NOT EXISTS (
        SELECT 1
        FROM public.google_token_encryption_keys
        WHERE key_id = p_target_key_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Target encryption key must be active.' USING ERRCODE = 'P0001';
    END IF;

    v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));

    FOR v_row IN
        SELECT
            c.user_id,
            c.institution_id,
            c.encryption_key_id,
            encode(c.refresh_token_ciphertext, 'base64') AS refresh_token_ciphertext,
            encode(c.refresh_token_nonce, 'base64') AS refresh_token_nonce
        FROM public.user_google_connections AS c
        WHERE c.refresh_token_ciphertext IS NOT NULL
          AND c.revoked_at IS NULL
          AND c.authorization_status = 'active'
          AND c.encryption_key_id IS DISTINCT FROM p_target_key_id
        ORDER BY c.updated_at ASC
        LIMIT v_limit
    LOOP
        v_rows := v_rows || jsonb_build_array(
            jsonb_build_object(
                'user_id', v_row.user_id,
                'institution_id', v_row.institution_id,
                'encryption_key_id', v_row.encryption_key_id,
                'refresh_token_ciphertext', v_row.refresh_token_ciphertext,
                'refresh_token_nonce', v_row.refresh_token_nonce
            )
        );
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'target_key_id', p_target_key_id,
        'count', jsonb_array_length(v_rows),
        'connections', v_rows
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(
    p_user_id UUID,
    p_from_key_id TEXT,
    p_to_key_id TEXT,
    p_refresh_token_ciphertext_b64 TEXT,
    p_refresh_token_nonce_b64 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    PERFORM public.meeting_calendar_require_service_role_jwt();

    IF NOT EXISTS (
        SELECT 1 FROM public.google_token_encryption_keys
        WHERE key_id = p_to_key_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Target encryption key must be active.' USING ERRCODE = 'P0001';
    END IF;

    IF NULLIF(btrim(COALESCE(p_refresh_token_ciphertext_b64, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_refresh_token_nonce_b64, '')), '') IS NULL
    THEN
        RAISE EXCEPTION 'Encrypted refresh token is required.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.user_google_connections
    SET
        refresh_token_ciphertext = decode(btrim(p_refresh_token_ciphertext_b64), 'base64'),
        refresh_token_nonce = decode(btrim(p_refresh_token_nonce_b64), 'base64'),
        encryption_key_id = p_to_key_id,
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND encryption_key_id = p_from_key_id
      AND refresh_token_ciphertext IS NOT NULL
      AND revoked_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN jsonb_build_object(
        'ok', true,
        'updated', v_updated > 0,
        'user_id', p_user_id,
        'encryption_key_id', p_to_key_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(
    UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(
    UUID, TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(
    UUID, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(
    UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.meeting_calendar_service_list_connections_needing_reencrypt(TEXT, INTEGER) IS
    'Rotation prep: list active connections not yet on target active key_id. Do not schedule in production until rotation runbook is approved.';

COMMENT ON FUNCTION public.meeting_calendar_service_update_reencrypted_refresh_token(UUID, TEXT, TEXT, TEXT, TEXT) IS
    'Rotation prep: write ciphertext after dual-key decrypt + re-encrypt in Edge. Optimistic lock on from_key_id.';
