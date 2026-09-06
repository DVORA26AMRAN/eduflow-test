-- =============================================================================
-- MPEX Printing — RPC EXECUTE grant hardening
-- =============================================================================
-- Forward-only. Function bodies unchanged.
--
-- Defect (Phase 1 live validation, project kkafmsvntwqweudallty):
--   Every public.printing_* function had EXECUTE for anon (and typically
--   authenticated + service_role) even after PUBLIC was revoked.
--
-- Target ACL:
--   A) Application RPCs: authenticated only (REVOKE PUBLIC, anon, service_role)
--   B) Worker RPCs: service_role only (REVOKE PUBLIC, anon, authenticated)
--   C) Internal helpers: no client EXECUTE (REVOKE PUBLIC, anon, authenticated,
--      service_role). Exception: storage-path helpers used in RLS policies keep
--      authenticated EXECUTE.
--
-- Signatures match live pg_get_function_identity_arguments (2026-09-02).

-- -----------------------------------------------------------------------------
-- A) Authenticated application RPCs
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.printing_resolve_actor_institution() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_resolve_actor_institution() FROM anon;
REVOKE ALL ON FUNCTION public.printing_resolve_actor_institution() FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_resolve_actor_institution() TO authenticated;

REVOKE ALL ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_create_request(TIMESTAMPTZ, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_update_request(UUID, TIMESTAMPTZ, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_cancel_request(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_cancel_request(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_cancel_request(UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_cancel_request(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_claim_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_claim_request(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_claim_request(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_claim_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_release_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_release_request(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_release_request(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_release_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_transfer_request(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_transfer_request(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_transfer_request(UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_transfer_request(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_return_item_for_correction(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_resubmit_item(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_resubmit_item(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_resubmit_item(UUID, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_resubmit_item(UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_reject_item(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_reject_item(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_reject_item(UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_reject_item(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_mark_item_printed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_mark_item_printed(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_mark_item_printed(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_mark_item_printed(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_update_institution_settings(INTEGER, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_validate_required_by(UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_derive_parent_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_derive_parent_status(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_derive_parent_status(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_derive_parent_status(UUID) TO authenticated;

-- Storage RLS helpers (policies call these as the table-accessing role).
REVOKE ALL ON FUNCTION public.printing_institution_id_from_storage_path(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_institution_id_from_storage_path(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_institution_id_from_storage_path(TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_institution_id_from_storage_path(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.printing_request_id_from_storage_path(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_request_id_from_storage_path(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_request_id_from_storage_path(TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.printing_request_id_from_storage_path(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- B) service_role worker / retention RPCs
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.printing_dispatch_overdue_notifications(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.printing_list_retention_purge_candidates(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.printing_mark_item_file_purged(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_mark_item_file_purged(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_mark_item_file_purged(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.printing_mark_item_file_purged(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- C) Internal helpers — no client EXECUTE
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.printing_allocate_request_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_allocate_request_number(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_allocate_request_number(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_allocate_request_number(UUID) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_write_audit(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_write_audit(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_write_audit(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_write_audit(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_sync_parent_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_sync_parent_status(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.printing_sync_parent_status(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_sync_parent_status(UUID) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_emit_notification(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_returned(printing_requests, print_items, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_returned(printing_requests, print_items, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_returned(printing_requests, print_items, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_returned(printing_requests, print_items, TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_rejected(printing_requests, print_items, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_rejected(printing_requests, print_items, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_rejected(printing_requests, print_items, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_item_rejected(printing_requests, print_items, TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_notify_teacher_request_completed(printing_requests) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_request_completed(printing_requests) FROM anon;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_request_completed(printing_requests) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_notify_teacher_request_completed(printing_requests) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_require_assigned_processor(printing_requests) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_require_assigned_processor(printing_requests) FROM anon;
REVOKE ALL ON FUNCTION public.printing_require_assigned_processor(printing_requests) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_require_assigned_processor(printing_requests) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_fail(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_fail(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_fail(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_fail(TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_validate_item_payload(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_validate_item_payload(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.printing_validate_item_payload(JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_validate_item_payload(JSONB) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_allowed_file_types() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_allowed_file_types() FROM anon;
REVOKE ALL ON FUNCTION public.printing_allowed_file_types() FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_allowed_file_types() FROM service_role;

REVOKE ALL ON FUNCTION public.printing_is_allowed_file_type(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_is_allowed_file_type(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_is_allowed_file_type(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_is_allowed_file_type(TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_is_valid_page_selection(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_is_valid_page_selection(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_is_valid_page_selection(TEXT, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_is_valid_page_selection(TEXT, TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_item_transition_allowed(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_item_transition_allowed(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.printing_item_transition_allowed(TEXT, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_item_transition_allowed(TEXT, TEXT) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_is_overdue(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_is_overdue(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.printing_is_overdue(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_is_overdue(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM service_role;

REVOKE ALL ON FUNCTION public.printing_audit_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.printing_audit_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.printing_audit_reject_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.printing_audit_reject_mutation() FROM service_role;
