// The governance snapshot driver — pure logic over graph-core, no SDK / no network.
//
// Unlike vgi-azure-directory's delta driver, there is NO cross-scan cursor here: every
// scan is a full pull and the only state that exists is in-scan pagination (an opaque
// @odata.nextLink string, plus a queue of collection start-URLs). This module owns the
// three governance shapes — CA policies, role assignments (active ∪ eligible), and the
// flattened app/SP credential-expiry inventory — as pure row mappers plus a snapshot
// pager, so the archetype-proof test can exercise it without the SDK or a socket.

import { paginate, isoToMs, type FetchJson } from "@vgi-azure/graph-core";

const GRAPH = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------------------
// Snapshot pager: drain every page of a start URL, following @odata.nextLink
// verbatim. Returns the flat list of raw Graph objects. There is NO deltaLink /
// watermark to persist — that is the snapshot contract made literal (§2).
// ---------------------------------------------------------------------------

export async function collectPages(fetchJson: FetchJson, startUrl: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for await (const page of paginate<Record<string, unknown>>(fetchJson, startUrl)) {
    for (const obj of page.value) rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// conditional_access_policies — single-collection walk (no queue).
// ---------------------------------------------------------------------------

export function caPoliciesStartUrl(): string {
  return `${GRAPH}/identity/conditionalAccess/policies`;
}

export interface CaPolicyRow {
  id: string;
  display_name: string | null;
  state: string | null;
  created_date_time: string | null;
  modified_date_time: string | null;
  included_users_json: string | null;
  excluded_users_json: string | null;
  included_apps_json: string | null;
  grant_controls_json: string | null;
  session_controls_json: string | null;
  client_app_types_json: string | null;
  raw_json: string;
}

function jsonOrNull(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function toCaPolicyRow(obj: Record<string, unknown>): CaPolicyRow {
  const conditions = (obj.conditions ?? {}) as Record<string, unknown>;
  const users = (conditions.users ?? {}) as Record<string, unknown>;
  const apps = (conditions.applications ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? ""),
    display_name: str(obj.displayName),
    state: str(obj.state),
    created_date_time: str(obj.createdDateTime),
    modified_date_time: str(obj.modifiedDateTime),
    included_users_json: jsonOrNull(users.includeUsers),
    excluded_users_json: jsonOrNull(users.excludeUsers),
    included_apps_json: jsonOrNull(apps.includeApplications),
    grant_controls_json: jsonOrNull(obj.grantControls),
    session_controls_json: jsonOrNull(obj.sessionControls),
    client_app_types_json: jsonOrNull(conditions.clientAppTypes),
    raw_json: JSON.stringify(obj),
  };
}

// ---------------------------------------------------------------------------
// role_assignments — two endpoints UNION'd with an assignment_kind discriminator.
// The queue carries {url, kind}; the page loop follows nextLink within each.
// ---------------------------------------------------------------------------

export type AssignmentKind = "active" | "eligible";

export interface RoleQueueEntry {
  url: string;
  kind: AssignmentKind;
}

export function roleAssignmentsQueue(): RoleQueueEntry[] {
  return [
    { url: `${GRAPH}/roleManagement/directory/roleAssignments`, kind: "active" },
    { url: `${GRAPH}/roleManagement/directory/roleEligibilityScheduleInstances`, kind: "eligible" },
  ];
}

export interface RoleAssignmentRow {
  assignment_kind: AssignmentKind;
  id: string;
  principal_id: string;
  principal_type: string | null;
  role_definition_id: string;
  role_display_name: string | null;
  directory_scope_id: string | null;
  start_date_time: string | null;
  end_date_time: string | null;
  member_type: string | null;
  status: string | null;
  raw_json: string;
}

/** Derive principalType from an @odata.type / principal object, if present. */
function principalTypeOf(obj: Record<string, unknown>): string | null {
  const p = obj.principal as Record<string, unknown> | undefined;
  const t = (p?.["@odata.type"] ?? obj["principalOdataType"]) as string | undefined;
  if (!t) return null;
  if (t.includes("user")) return "user";
  if (t.includes("group")) return "group";
  if (t.includes("servicePrincipal")) return "servicePrincipal";
  return t;
}

export function toRoleAssignmentRow(obj: Record<string, unknown>, kind: AssignmentKind): RoleAssignmentRow {
  return {
    assignment_kind: kind,
    id: String(obj.id ?? ""),
    principal_id: String(obj.principalId ?? ""),
    principal_type: principalTypeOf(obj),
    role_definition_id: String(obj.roleDefinitionId ?? ""),
    role_display_name: str((obj.roleDefinition as Record<string, unknown> | undefined)?.displayName),
    directory_scope_id: str(obj.directoryScopeId),
    // Schedule bounds exist only on eligible instances; active assignments leave them null.
    start_date_time: str(obj.startDateTime),
    end_date_time: str(obj.endDateTime),
    member_type: str(obj.memberType),
    status: str(obj.status),
    raw_json: JSON.stringify(obj),
  };
}

// ---------------------------------------------------------------------------
// app_credentials — flatten passwordCredentials[] + keyCredentials[] across
// /applications and /servicePrincipals into one row per credential, with the
// SCAN-TIME expiry snapshot (days_until_expiry / is_expired) computed against a
// caller-supplied wall-clock so the popular WHERE-days query is a one-liner.
// ---------------------------------------------------------------------------

export type OwnerKind = "application" | "servicePrincipal";
export type CredentialType = "password" | "key";

export interface CredQueueEntry {
  url: string;
  ownerKind: OwnerKind;
}

export function appCredentialsQueue(): CredQueueEntry[] {
  const select = "id,appId,displayName,passwordCredentials,keyCredentials";
  return [
    { url: `${GRAPH}/applications?$select=${select}`, ownerKind: "application" },
    { url: `${GRAPH}/servicePrincipals?$select=${select}`, ownerKind: "servicePrincipal" },
  ];
}

export interface AppCredentialRow {
  owner_kind: OwnerKind;
  owner_id: string;
  app_id: string | null;
  owner_display_name: string | null;
  credential_type: CredentialType;
  credential_key_id: string | null;
  display_name: string | null;
  start_date_time: string | null;
  end_date_time: string | null;
  days_until_expiry: number | null;
  is_expired: boolean | null;
  usage: string | null;
  raw_json: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `nowMs` to the ISO `endDateTime`; null when there is no expiry. */
export function daysUntil(endIso: string | null | undefined, nowMs: number): number | null {
  if (endIso == null) return null;
  return Math.floor((isoToMs(endIso) - nowMs) / MS_PER_DAY);
}

interface RawCred {
  keyId?: unknown;
  displayName?: unknown;
  startDateTime?: unknown;
  endDateTime?: unknown;
  usage?: unknown;
}

function credRow(
  owner: Record<string, unknown>,
  ownerKind: OwnerKind,
  credType: CredentialType,
  cred: RawCred,
  nowMs: number,
): AppCredentialRow {
  const endIso = str(cred.endDateTime);
  const days = daysUntil(endIso, nowMs);
  return {
    owner_kind: ownerKind,
    owner_id: String(owner.id ?? ""),
    app_id: str(owner.appId),
    owner_display_name: str(owner.displayName),
    credential_type: credType,
    credential_key_id: str(cred.keyId),
    display_name: str(cred.displayName),
    start_date_time: str(cred.startDateTime),
    end_date_time: endIso,
    days_until_expiry: days,
    // A cred with no endDateTime never expires → is_expired is null (unknown), not false.
    is_expired: days == null ? null : days < 0,
    usage: str(cred.usage),
    raw_json: JSON.stringify({ owner_id: owner.id, credential_type: credType, ...cred }),
  };
}

/**
 * Flatten one page of app/SP objects into per-credential rows. When
 * `expiringWithinDays` is a number, keep only credentials whose
 * `days_until_expiry <= N` (past-due rows have negative days and stay in);
 * credentials with no expiry (null days) are always dropped by a filter, since
 * "expiring within N days" cannot include a credential that never expires.
 * `null`/`undefined` filter → emit every credential.
 */
export function flattenCredentials(
  owners: Record<string, unknown>[],
  ownerKind: OwnerKind,
  nowMs: number,
  expiringWithinDays: number | null | undefined,
): AppCredentialRow[] {
  const rows: AppCredentialRow[] = [];
  for (const owner of owners) {
    const passwords = (Array.isArray(owner.passwordCredentials) ? owner.passwordCredentials : []) as RawCred[];
    const keys = (Array.isArray(owner.keyCredentials) ? owner.keyCredentials : []) as RawCred[];
    for (const c of passwords) rows.push(credRow(owner, ownerKind, "password", c, nowMs));
    for (const c of keys) rows.push(credRow(owner, ownerKind, "key", c, nowMs));
  }
  if (expiringWithinDays == null) return rows;
  return rows.filter((r) => r.days_until_expiry != null && r.days_until_expiry <= expiringWithinDays);
}
