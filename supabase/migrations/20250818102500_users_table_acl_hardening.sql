-- =============================================================================
-- EduFlow — public.users table ACL hardening
-- =============================================================================
-- Live inspection: anon and authenticated held table-level
-- SELECT/INSERT/UPDATE/DELETE, which authorizes every column including
-- national_id. PostgreSQL table-level SELECT is not removed by a column-level
-- REVOKE of national_id.
--
-- Target:
--   PUBLIC / anon: no direct users table privileges
--   authenticated: column SELECT only on the safe client set
--   service role privileges: left unchanged
--
-- Does not alter users RLS policies.
-- Does not add INSERT/UPDATE/DELETE policies.
-- Does not apply until architecture review.

-- 1) Remove table-level privileges from PUBLIC, anon, and authenticated.
REVOKE ALL ON TABLE public.users FROM PUBLIC;
REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.users FROM authenticated;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.users FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.users FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.users FROM authenticated;

-- 2) Remove leftover column-level grants on every current users column
--    for those same roles. Table REVOKE does not clear attacl.
DO $$
DECLARE
    col_list text;
BEGIN
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO col_list
    FROM pg_attribute AS a
    JOIN pg_class AS c ON c.oid = a.attrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'users'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF col_list IS NULL THEN
        RAISE EXCEPTION 'public.users has no columns to revoke.';
    END IF;

    EXECUTE format(
        'REVOKE ALL (%s) ON TABLE public.users FROM PUBLIC',
        col_list
    );
    EXECUTE format(
        'REVOKE ALL (%s) ON TABLE public.users FROM anon',
        col_list
    );
    EXECUTE format(
        'REVOKE ALL (%s) ON TABLE public.users FROM authenticated',
        col_list
    );
END
$$;

-- 3) Restore only the columns required by authenticated browser PostgREST.
GRANT SELECT (
    id,
    institution_id,
    primary_role,
    full_name,
    email,
    status
) ON public.users TO authenticated;

COMMENT ON TABLE public.users IS
    'ACL hardened: authenticated may SELECT id, institution_id, primary_role, full_name, email, status only. Sensitive profile fields remain RPC/SECURITY DEFINER only.';
