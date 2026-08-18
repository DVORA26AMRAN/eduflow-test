-- =============================================================================
-- MPEX D1 — Deputy enum value only
-- =============================================================================
-- Forward-only. Does not edit applied migrations.
-- PostgreSQL: a new enum value added in a transaction cannot be used by other
-- SQL in that same transaction. This migration ONLY adds the value.
-- Functions that reference 'deputy' belong in 20250818101000 (next committed txn).
-- Does NOT add a one-deputy-per-institution unique constraint.
-- Does NOT broaden auth_user_is_active_institution_manager_for_institution.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'deputy';
