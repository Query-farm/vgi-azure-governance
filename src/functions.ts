// The VGI table functions: conditional_access_policies, role_assignments,
// app_credentials. All three are SNAPSHOT walks over the governance driver — no
// cross-scan cursor, no marker row. State is a queue of collection start-URLs + the
// current @odata.nextLink, all plain strings/booleans (fully serializable, §2). The
// GraphClient is injected via a ClientFactory so the worker wires the real MSAL-backed
// client and the archetype test injects a fake.
//
// All three are TABLE functions so `name := value` works; app_credentials' one
// optional arg (expiring_within_days) lives in argDefaults so it is a NAMED arg.

import { defineTableFunction, secretsOfType, type OutputCollector } from "@query-farm/vgi";
import { Int64 } from "@query-farm/apache-arrow";
import {
  collectPages,
  caPoliciesStartUrl,
  toCaPolicyRow,
  roleAssignmentsQueue,
  toRoleAssignmentRow,
  appCredentialsQueue,
  flattenCredentials,
  type AssignmentKind,
  type OwnerKind,
} from "./governance.js";
import {
  CA_POLICIES_SCHEMA,
  buildCaPolicyBatch,
  ROLE_ASSIGNMENTS_SCHEMA,
  buildRoleAssignmentBatch,
  APP_CREDENTIALS_SCHEMA,
  buildAppCredentialBatch,
} from "./schema.js";
import type { GraphClient } from "@vgi-azure/graph-core";

export type ClientFactory = (secret: Record<string, unknown>) => GraphClient;

function requireClient(p: { secrets: unknown }, factory: ClientFactory, fn: string): GraphClient {
  const secret = secretsOfType(p.secrets as never, "azure_graph")[0];
  if (!secret) throw new Error(`${fn}: attach an 'azure_graph' secret (TYPE azure_graph)`);
  return factory(secret as Record<string, unknown>);
}

// --- conditional_access_policies() -----------------------------------------

interface SingleWalkState {
  done: boolean;
}

export function makeConditionalAccessPolicies(clientFactory: ClientFactory) {
  return defineTableFunction<Record<string, never>, SingleWalkState>({
    name: "conditional_access_policies",
    description:
      "Microsoft Entra Conditional Access policies via Graph v1.0 (snapshot — full pull, no cursor).",
    examples: [
      {
        sql: "SELECT id, display_name, state FROM azure.main.conditional_access_policies()",
        description: "All Conditional Access policies with their state",
      },
      {
        sql: "SELECT display_name FROM azure.main.conditional_access_policies() WHERE state = 'enabled'",
        description: "Only the enabled (enforced) policies",
      },
      {
        sql: "SELECT display_name, grant_controls_json FROM azure.main.conditional_access_policies() WHERE state = 'enabled'",
        description: "Grant controls (e.g. MFA / compliant device) for each enabled policy",
      },
    ],
    tags: {
      "vgi.category": "conditional-access",
      "vgi.title": "Conditional Access Policies",
      // VGI515: the native duckdb_functions().examples carrier drops per-example
      // descriptions, so mirror `examples` here as a described JSON tag.
      "vgi.example_queries": JSON.stringify([
        {
          description: "All Conditional Access policies with their state",
          sql: "SELECT id, display_name, state FROM azure.main.conditional_access_policies()",
        },
        {
          description: "Only the enabled (enforced) policies",
          sql: "SELECT display_name FROM azure.main.conditional_access_policies() WHERE state = 'enabled'",
        },
        {
          description: "Grant controls (e.g. MFA / compliant device) for each enabled policy",
          sql: "SELECT display_name, grant_controls_json FROM azure.main.conditional_access_policies() WHERE state = 'enabled'",
        },
      ]),
      "vgi.keywords": JSON.stringify([
        "conditional access",
        "ca policy",
        "entra id",
        "azure ad",
        "security",
        "mfa",
        "grant controls",
        "session controls",
        "governance",
      ]),
      "vgi.doc_llm":
        "Snapshot of every Microsoft Entra Conditional Access policy in the tenant via Microsoft Graph " +
        "v1.0 (identity/conditionalAccess/policies). One row per policy with its state " +
        "(enabled / disabled / enabledForReportingButNotEnforced), timestamps, and the targeted users, " +
        "apps, grant controls, and session controls as JSON columns. Full pull, no cursor — every scan " +
        "returns the complete current set. Requires an azure_graph secret with Policy.Read.All.",
      "vgi.doc_md":
        "## conditional_access_policies\n\n" +
        "Every Conditional Access policy in the Microsoft Entra tenant, one row each, backed by " +
        "Microsoft Graph's `identity/conditionalAccess/policies` endpoint. Targeting and controls are " +
        "surfaced as JSON columns (`included_users_json`, `grant_controls_json`, …) so nested policy " +
        "conditions stay queryable.\n\n" +
        "Filter on `state` (`enabled` / `disabled` / `enabledForReportingButNotEnforced`) to focus on " +
        "the enforced policies, and read `grant_controls_json` for the MFA / compliant-device " +
        "requirements each policy imposes. Runnable, copy-pasteable queries live in this function's " +
        "example queries.",
      // Static result schema (VGI307/321-324) — mirrors CA_POLICIES_SCHEMA and the
      // backing conditional_access_policies table's column comments.
      "vgi.result_columns_schema": JSON.stringify([
        { name: "id", type: "VARCHAR", description: "Conditional Access policy id (GUID)." },
        { name: "display_name", type: "VARCHAR", description: "Policy display name." },
        { name: "state", type: "VARCHAR", description: "Policy state: enabled, disabled, or enabledForReportingButNotEnforced." },
        { name: "created_date_time", type: "VARCHAR", description: "ISO-8601 timestamp the policy was created; NULL if unknown." },
        { name: "modified_date_time", type: "VARCHAR", description: "ISO-8601 timestamp the policy was last modified; NULL if never modified." },
        { name: "included_users_json", type: "VARCHAR", description: "JSON array of targeted user/role/group ids (conditions.users.includeUsers)." },
        { name: "excluded_users_json", type: "VARCHAR", description: "JSON array of excluded user/role/group ids." },
        { name: "included_apps_json", type: "VARCHAR", description: "JSON array of targeted application ids (conditions.applications.includeApplications)." },
        { name: "grant_controls_json", type: "VARCHAR", description: "JSON object of grant controls (e.g. MFA, compliant device, terms of use)." },
        { name: "session_controls_json", type: "VARCHAR", description: "JSON object of session controls (e.g. sign-in frequency, app-enforced restrictions)." },
        { name: "client_app_types_json", type: "VARCHAR", description: "JSON array of client app types the policy applies to." },
        { name: "raw_json", type: "VARCHAR", description: "The full Graph policy object as JSON." },
      ]),
    },
    onBind: () => ({ outputSchema: CA_POLICIES_SCHEMA }),
    initialState: () => ({ done: false }),
    process: async (p, state: SingleWalkState, out: OutputCollector) => {
      if (state.done) {
        out.finish();
        return;
      }
      const client = requireClient(p, clientFactory, "conditional_access_policies");
      const objs = await collectPages(client.fetchJson, caPoliciesStartUrl());
      out.emit(buildCaPolicyBatch(objs.map(toCaPolicyRow)));
      state.done = true; // next tick finishes: snapshot has no cursor to hand back.
    },
  });
}

// --- role_assignments() (active ∪ eligible) --------------------------------

interface RoleWalkState {
  queue: { url: string; kind: AssignmentKind }[];
  done: boolean;
}

export function makeRoleAssignments(clientFactory: ClientFactory) {
  return defineTableFunction<Record<string, never>, RoleWalkState>({
    name: "role_assignments",
    description:
      "Entra directory role assignments — active ∪ PIM-eligible unioned with an assignment_kind discriminator (snapshot).",
    examples: [
      {
        sql: "SELECT assignment_kind, role_display_name, principal_id FROM azure.main.role_assignments()",
        description: "All directory role assignments (active and PIM-eligible)",
      },
      {
        sql: "SELECT role_display_name, principal_id, status FROM azure.main.role_assignments() WHERE assignment_kind = 'eligible'",
        description: "Only PIM-eligible (not yet activated) assignments",
      },
      {
        sql: "SELECT role_display_name, count(*) FROM azure.main.role_assignments() WHERE assignment_kind = 'active' GROUP BY role_display_name ORDER BY count(*) DESC",
        description: "Active assignment count per directory role",
      },
    ],
    tags: {
      "vgi.category": "role-assignments",
      "vgi.title": "Directory Role Assignments",
      // VGI515: mirror `examples` as a described JSON tag (the native examples
      // carrier drops descriptions).
      "vgi.example_queries": JSON.stringify([
        {
          description: "All directory role assignments (active and PIM-eligible)",
          sql: "SELECT assignment_kind, role_display_name, principal_id FROM azure.main.role_assignments()",
        },
        {
          description: "Only PIM-eligible (not yet activated) assignments",
          sql: "SELECT role_display_name, principal_id, status FROM azure.main.role_assignments() WHERE assignment_kind = 'eligible'",
        },
        {
          description: "Active assignment count per directory role",
          sql: "SELECT role_display_name, count(*) FROM azure.main.role_assignments() WHERE assignment_kind = 'active' GROUP BY role_display_name ORDER BY count(*) DESC",
        },
      ]),
      "vgi.keywords": JSON.stringify([
        "role assignments",
        "directory roles",
        "pim",
        "privileged identity management",
        "eligible",
        "active",
        "entra id",
        "azure ad",
        "governance",
        "security",
      ]),
      "vgi.doc_llm":
        "Snapshot of Microsoft Entra directory role assignments via Microsoft Graph v1.0. Unions the " +
        "active assignments (roleManagement/directory/roleAssignments) with the PIM-eligible schedule " +
        "instances (roleEligibilityScheduleInstances) into one table, distinguished by the " +
        "assignment_kind column ('active' vs 'eligible'). One row per assignment with the principal, " +
        "role, scope, and (for eligible rows) schedule bounds and status. Full pull, no cursor. " +
        "Requires an azure_graph secret with RoleManagement.Read.Directory.",
      "vgi.doc_md":
        "## role_assignments\n\n" +
        "Directory role assignments in the Microsoft Entra tenant, unioning **active** assignments with " +
        "**PIM-eligible** schedule instances. The `assignment_kind` discriminator tells the two apart; " +
        "`start_date_time` / `end_date_time` / `status` are populated only on eligible rows.\n\n" +
        "Filter `assignment_kind = 'eligible'` to list the PIM-eligible (not-yet-activated) grants, or " +
        "`'active'` for the live assignments; `role_display_name` carries the human role name (e.g. " +
        "Global Administrator). Runnable, copy-pasteable queries live in this function's example queries.",
      // Static result schema (VGI307/321-324) — mirrors ROLE_ASSIGNMENTS_SCHEMA and the
      // backing role_assignments table's column comments.
      "vgi.result_columns_schema": JSON.stringify([
        { name: "assignment_kind", type: "VARCHAR", description: "active (a live roleAssignment) or eligible (a PIM roleEligibilityScheduleInstance)." },
        { name: "id", type: "VARCHAR", description: "The assignment / eligibility instance id." },
        { name: "principal_id", type: "VARCHAR", description: "Object id of the assigned principal (user, group, or service principal)." },
        { name: "principal_type", type: "VARCHAR", description: "Principal kind: user, group, or servicePrincipal; NULL if not resolvable." },
        { name: "role_definition_id", type: "VARCHAR", description: "The directory role definition (template) id." },
        { name: "role_display_name", type: "VARCHAR", description: "Human-readable role name (e.g. Global Administrator); NULL if not expanded." },
        { name: "directory_scope_id", type: "VARCHAR", description: "Scope of the assignment (e.g. / for tenant-wide)." },
        { name: "start_date_time", type: "VARCHAR", description: "Eligibility schedule start (ISO-8601); NULL for active assignments." },
        { name: "end_date_time", type: "VARCHAR", description: "Assignment/eligibility end (ISO-8601); NULL means permanent." },
        { name: "member_type", type: "VARCHAR", description: "How the assignment was granted (e.g. Direct, Group, Inherited)." },
        { name: "status", type: "VARCHAR", description: "Eligibility status (e.g. Provisioned); NULL for active assignments." },
        { name: "raw_json", type: "VARCHAR", description: "The full Graph assignment object as JSON." },
      ]),
    },
    onBind: () => ({ outputSchema: ROLE_ASSIGNMENTS_SCHEMA }),
    initialState: () => ({ queue: roleAssignmentsQueue(), done: false }),
    process: async (p, state: RoleWalkState, out: OutputCollector) => {
      const entry = state.queue.shift();
      if (!entry) {
        out.finish();
        return;
      }
      const client = requireClient(p, clientFactory, "role_assignments");
      const objs = await collectPages(client.fetchJson, entry.url);
      out.emit(buildRoleAssignmentBatch(objs.map((o) => toRoleAssignmentRow(o, entry.kind))));
      // No queue left → next tick hits the empty branch and finishes.
    },
  });
}

// --- app_credentials(expiring_within_days? int) ----------------------------

interface AppCredArgs {
  expiring_within_days: number | null;
}
interface CredWalkState {
  queue: { url: string; ownerKind: OwnerKind }[];
  done: boolean;
}

export function makeAppCredentials(clientFactory: ClientFactory) {
  return defineTableFunction<AppCredArgs, CredWalkState>({
    name: "app_credentials",
    description:
      "Flattened app & service-principal password/key credentials with scan-time days_until_expiry / is_expired (snapshot). expiring_within_days filters after flatten.",
    args: { expiring_within_days: new Int64() },
    argDefaults: { expiring_within_days: null }, // null ⇒ no filter (named arg)
    argDocs: {
      expiring_within_days:
        "Optional expiry-window filter. When set, keep only credentials whose `days_until_expiry <= N` (already-expired credentials have negative days and stay in); credentials with no expiry are dropped. Leave unset (the default) to apply no filter and return every credential.",
    },
    examples: [
      {
        sql: "SELECT owner_display_name, credential_type, end_date_time, days_until_expiry FROM azure.main.app_credentials()",
        description: "Full credential inventory across apps and service principals",
      },
      {
        sql: "SELECT owner_display_name, credential_type, days_until_expiry FROM azure.main.app_credentials(expiring_within_days := 30) ORDER BY days_until_expiry",
        description: "Credentials expiring within the next 30 days (soonest first)",
      },
      {
        sql: "SELECT owner_kind, owner_display_name, credential_type, end_date_time FROM azure.main.app_credentials() WHERE is_expired",
        description: "Credentials that are already expired",
      },
    ],
    tags: {
      "vgi.category": "credential-hygiene",
      "vgi.title": "App & Service Principal Credentials",
      // VGI515: mirror `examples` as a described JSON tag (the native examples
      // carrier drops descriptions).
      "vgi.example_queries": JSON.stringify([
        {
          description: "Full credential inventory across apps and service principals",
          sql: "SELECT owner_display_name, credential_type, end_date_time, days_until_expiry FROM azure.main.app_credentials()",
        },
        {
          description: "Credentials expiring within the next 30 days (soonest first)",
          sql: "SELECT owner_display_name, credential_type, days_until_expiry FROM azure.main.app_credentials(expiring_within_days := 30) ORDER BY days_until_expiry",
        },
        {
          description: "Credentials that are already expired",
          sql: "SELECT owner_kind, owner_display_name, credential_type, end_date_time FROM azure.main.app_credentials() WHERE is_expired",
        },
      ]),
      "vgi.keywords": JSON.stringify([
        "app credentials",
        "service principal",
        "client secret",
        "certificate",
        "key credential",
        "password credential",
        "expiry",
        "expiring secrets",
        "entra id",
        "azure ad",
        "security",
        "governance",
      ]),
      "vgi.doc_llm":
        "Snapshot inventory of Microsoft Entra application and service-principal credentials via " +
        "Microsoft Graph v1.0, flattened to one row per password (client secret) or key (certificate) " +
        "credential across /applications and /servicePrincipals. Each row carries scan-time " +
        "days_until_expiry and is_expired computed against the scan wall-clock. The optional " +
        "expiring_within_days argument filters to credentials expiring within N days after the flatten. " +
        "Full pull, no cursor. Requires an azure_graph secret with Application.Read.All (credential " +
        "metadata only — no secret material is returned).",
      "vgi.doc_md":
        "## app_credentials\n\n" +
        "Flattened inventory of every password (client secret) and key (certificate) credential on the " +
        "tenant's applications and service principals, with a scan-time expiry snapshot " +
        "(`days_until_expiry`, `is_expired`). No secret material is returned — metadata only.\n\n" +
        "Pass `expiring_within_days := 30` to keep only credentials expiring within the next 30 days " +
        "(already-expired credentials have a negative `days_until_expiry` and stay in), or omit the " +
        "argument for the full inventory. Order by `days_until_expiry` to surface the most urgent " +
        "rotations first. Runnable, copy-pasteable queries live in this function's example queries.",
      // Static result schema (VGI307/321-324) — mirrors APP_CREDENTIALS_SCHEMA. This
      // function has no backing table (it takes an argument), so declaring the schema
      // here is what satisfies VGI307.
      "vgi.result_columns_schema": JSON.stringify([
        { name: "owner_kind", type: "VARCHAR", description: "application or servicePrincipal — which directory object owns the credential." },
        { name: "owner_id", type: "VARCHAR", description: "Object id of the owning application or service principal." },
        { name: "app_id", type: "VARCHAR", description: "The owner's appId (client id); NULL if absent." },
        { name: "owner_display_name", type: "VARCHAR", description: "Display name of the owning app / service principal." },
        { name: "credential_type", type: "VARCHAR", description: "password (client secret) or key (certificate)." },
        { name: "credential_key_id", type: "VARCHAR", description: "The credential's keyId (GUID); NULL if absent." },
        { name: "display_name", type: "VARCHAR", description: "The credential's own display name / description." },
        { name: "start_date_time", type: "VARCHAR", description: "ISO-8601 credential validity start." },
        { name: "end_date_time", type: "VARCHAR", description: "ISO-8601 credential expiry; NULL if the credential has no expiry." },
        { name: "days_until_expiry", type: "BIGINT", description: "Whole days from scan time to end_date_time (negative if already expired); NULL if no expiry. Scan-time snapshot — recompute downstream." },
        { name: "is_expired", type: "BOOLEAN", description: "Whether the credential was expired at scan time; NULL if it has no expiry. Scan-time snapshot." },
        { name: "usage", type: "VARCHAR", description: "For key credentials, Verify or Sign; NULL for password credentials." },
        { name: "raw_json", type: "VARCHAR", description: "The credential fields plus owner id as JSON." },
      ]),
    },
    onBind: () => ({ outputSchema: APP_CREDENTIALS_SCHEMA }),
    initialState: () => ({ queue: appCredentialsQueue(), done: false }),
    process: async (p, state: CredWalkState, out: OutputCollector) => {
      const entry = state.queue.shift();
      if (!entry) {
        out.finish();
        return;
      }
      const client = requireClient(p, clientFactory, "app_credentials");
      const objs = await collectPages(client.fetchJson, entry.url);
      // Scan wall-clock: one Date.now() per page-set stamps this snapshot (recompute downstream).
      const filter = p.args.expiring_within_days == null ? null : Number(p.args.expiring_within_days);
      const rows = flattenCredentials(objs, entry.ownerKind, Date.now(), filter);
      out.emit(buildAppCredentialBatch(rows));
    },
  });
}

export function makeFunctions(clientFactory: ClientFactory) {
  return [
    makeConditionalAccessPolicies(clientFactory),
    makeRoleAssignments(clientFactory),
    makeAppCredentials(clientFactory),
  ];
}
