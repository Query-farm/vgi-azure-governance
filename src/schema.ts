// Arrow output schemas + row→batch mapping for the three governance collections.
//
// This is a SNAPSHOT worker: NO cursor column, NO marker row. Every row is a
// business row (_row_kind is absent from the schema entirely, per graph-core §D:
// snapshot workers carry no cursor and therefore no marker). Timestamps are emitted
// as ISO-8601 Utf8 strings (graph-core's currency) so state and rows stay trivially
// serializable and the edge build needs no timezone-aware Arrow plumbing.

import { Schema, Field, Utf8, Bool, Int64 } from "@query-farm/apache-arrow";
import { batchFromColumns } from "@query-farm/vgi";
import type { CaPolicyRow, RoleAssignmentRow, AppCredentialRow } from "./governance.js";

// --- conditional_access_policies -------------------------------------------

export const CA_POLICIES_SCHEMA = new Schema([
  new Field("id", new Utf8(), false),
  new Field("display_name", new Utf8(), true),
  new Field("state", new Utf8(), true),
  new Field("created_date_time", new Utf8(), true),
  new Field("modified_date_time", new Utf8(), true),
  new Field("included_users_json", new Utf8(), true),
  new Field("excluded_users_json", new Utf8(), true),
  new Field("included_apps_json", new Utf8(), true),
  new Field("grant_controls_json", new Utf8(), true),
  new Field("session_controls_json", new Utf8(), true),
  new Field("client_app_types_json", new Utf8(), true),
  new Field("raw_json", new Utf8(), true),
]);

export function buildCaPolicyBatch(rows: CaPolicyRow[]) {
  const cols: Record<string, unknown[]> = {};
  for (const f of CA_POLICIES_SCHEMA.fields) cols[f.name] = [];
  for (const r of rows) {
    cols.id!.push(r.id);
    cols.display_name!.push(r.display_name);
    cols.state!.push(r.state);
    cols.created_date_time!.push(r.created_date_time);
    cols.modified_date_time!.push(r.modified_date_time);
    cols.included_users_json!.push(r.included_users_json);
    cols.excluded_users_json!.push(r.excluded_users_json);
    cols.included_apps_json!.push(r.included_apps_json);
    cols.grant_controls_json!.push(r.grant_controls_json);
    cols.session_controls_json!.push(r.session_controls_json);
    cols.client_app_types_json!.push(r.client_app_types_json);
    cols.raw_json!.push(r.raw_json);
  }
  return batchFromColumns(cols, CA_POLICIES_SCHEMA);
}

// --- role_assignments (active ∪ eligible union schema) ----------------------

export const ROLE_ASSIGNMENTS_SCHEMA = new Schema([
  new Field("assignment_kind", new Utf8(), false), // 'active' | 'eligible' discriminator
  new Field("id", new Utf8(), false),
  new Field("principal_id", new Utf8(), false),
  new Field("principal_type", new Utf8(), true),
  new Field("role_definition_id", new Utf8(), false),
  new Field("role_display_name", new Utf8(), true),
  new Field("directory_scope_id", new Utf8(), true),
  new Field("start_date_time", new Utf8(), true), // eligible: schedule start; active: null
  new Field("end_date_time", new Utf8(), true), // null = permanent
  new Field("member_type", new Utf8(), true),
  new Field("status", new Utf8(), true), // eligible: Provisioned/…; active: null
  new Field("raw_json", new Utf8(), true),
]);

export function buildRoleAssignmentBatch(rows: RoleAssignmentRow[]) {
  const cols: Record<string, unknown[]> = {};
  for (const f of ROLE_ASSIGNMENTS_SCHEMA.fields) cols[f.name] = [];
  for (const r of rows) {
    cols.assignment_kind!.push(r.assignment_kind);
    cols.id!.push(r.id);
    cols.principal_id!.push(r.principal_id);
    cols.principal_type!.push(r.principal_type);
    cols.role_definition_id!.push(r.role_definition_id);
    cols.role_display_name!.push(r.role_display_name);
    cols.directory_scope_id!.push(r.directory_scope_id);
    cols.start_date_time!.push(r.start_date_time);
    cols.end_date_time!.push(r.end_date_time);
    cols.member_type!.push(r.member_type);
    cols.status!.push(r.status);
    cols.raw_json!.push(r.raw_json);
  }
  return batchFromColumns(cols, ROLE_ASSIGNMENTS_SCHEMA);
}

// --- app_credentials (flattened credential-expiry inventory) ----------------

export const APP_CREDENTIALS_SCHEMA = new Schema([
  new Field("owner_kind", new Utf8(), false), // application | servicePrincipal
  new Field("owner_id", new Utf8(), false),
  new Field("app_id", new Utf8(), true),
  new Field("owner_display_name", new Utf8(), true),
  new Field("credential_type", new Utf8(), false), // password | key
  new Field("credential_key_id", new Utf8(), true),
  new Field("display_name", new Utf8(), true),
  new Field("start_date_time", new Utf8(), true),
  new Field("end_date_time", new Utf8(), true),
  new Field("days_until_expiry", new Int64(), true), // scan-time snapshot — recompute downstream
  new Field("is_expired", new Bool(), true), // scan-time snapshot — recompute downstream
  new Field("usage", new Utf8(), true), // key creds: Verify | Sign
  new Field("raw_json", new Utf8(), true),
]);

export function buildAppCredentialBatch(rows: AppCredentialRow[]) {
  const cols: Record<string, unknown[]> = {};
  for (const f of APP_CREDENTIALS_SCHEMA.fields) cols[f.name] = [];
  for (const r of rows) {
    cols.owner_kind!.push(r.owner_kind);
    cols.owner_id!.push(r.owner_id);
    cols.app_id!.push(r.app_id);
    cols.owner_display_name!.push(r.owner_display_name);
    cols.credential_type!.push(r.credential_type);
    cols.credential_key_id!.push(r.credential_key_id);
    cols.display_name!.push(r.display_name);
    cols.start_date_time!.push(r.start_date_time);
    cols.end_date_time!.push(r.end_date_time);
    // Int64 column → BigInt (or null). days_until_expiry is a small integer count of days.
    cols.days_until_expiry!.push(r.days_until_expiry == null ? null : BigInt(r.days_until_expiry));
    cols.is_expired!.push(r.is_expired);
    cols.usage!.push(r.usage);
    cols.raw_json!.push(r.raw_json);
  }
  return batchFromColumns(cols, APP_CREDENTIALS_SCHEMA);
}
