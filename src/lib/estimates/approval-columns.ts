/**
 * The columns the approval servers select from the rule, approval and review cycle tables.
 * Each list stays a string literal, so the typed Supabase client still parses the selection.
 */
export const ESTIMATE_RULE_COLUMNS =
  "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active";

export const ESTIMATE_APPROVAL_COLUMNS =
  "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at";

export const ESTIMATE_REVIEW_CYCLE_COLUMNS =
  "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, submission_message, assigned_reviewer_id, decided_by, decision, decided_at, carried_over_from_cycle_id, requested_content_revision, superseded_at, superseded_by, superseded_by_cycle_id";
