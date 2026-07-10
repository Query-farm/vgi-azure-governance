// The `azure` catalog descriptor + the azure_graph secret type. Reuses the exact
// app-only client-credentials secret shape frozen by vgi-azure-directory (the
// graph-core seam owner) so every vgi-azure-* worker shares one secret contract.
//
// This file also carries the catalog- and schema-level vgi.* documentation/discovery
// tags that vgi-lint grades. Tag shapes follow vgi-lint's TAGS.md: JSON-valued tags
// (keywords/categories/executable_examples/agent_test_tasks/example_queries) are JSON
// strings; every example SQL is catalog-qualified (azure.main.<fn>) so it binds when the
// catalog is attached. The governance functions require an `azure_graph` secret to RUN,
// so the executable examples are credential-free `LIMIT 0` bind probes and the agent-test
// tasks are graded by success_criteria (they execute once an azure_graph secret is attached).

import { Schema, Field, Utf8 } from "@query-farm/apache-arrow";
import type { CatalogDescriptor, SecretTypeDescriptor, VgiFunction } from "@query-farm/vgi";

const REPO = "https://github.com/Query-farm/vgi-azure-governance";
const ISSUES = `${REPO}/issues`;

export const AZURE_GRAPH_SECRET: SecretTypeDescriptor = {
  name: "azure_graph",
  description: "Microsoft Entra app-only (client-credentials) credentials for Microsoft Graph",
  schema: new Schema([
    new Field("tenant_id", new Utf8(), true),
    new Field("client_id", new Utf8(), true),
    new Field("client_secret", new Utf8(), true, new Map([["redact", "true"]])),
  ]),
};

/** Catalog-level tags: docs, discovery, provenance, and the agent-test suite. */
const CATALOG_TAGS: Record<string, string> = {
  "vgi.title": "Microsoft Entra Governance",
  "vgi.doc_llm":
    "Microsoft Entra ID (Azure AD) security-governance posture as SQL table functions over Microsoft " +
    "Graph. Reach for it to audit a tenant's Conditional Access policies, privileged directory role " +
    "assignments (active plus PIM-eligible), and application / service-principal credential expiry. " +
    "Every function is a SNAPSHOT — a full pull with no cursor and no marker row, so each scan is the " +
    "complete current state and the caller owns atomicity via a full-replace transaction. Requires an " +
    "app-only (client-credentials) 'azure_graph' secret (tenant_id, client_id, client_secret) with " +
    "admin-consented Graph read permission (Policy.Read.All, RoleManagement.Read.Directory, " +
    "Application.Read.All). Answers questions like: which CA policies are enabled, who holds a given " +
    "directory role, and which app credentials are expired or expiring soon.",
  "vgi.doc_md":
    "## Microsoft Entra Governance\n\n" +
    "Security-governance snapshots of a Microsoft Entra ID (Azure AD) tenant via Microsoft Graph, " +
    "exposed as three DuckDB table functions.\n\n" +
    "- **`conditional_access_policies`** — Conditional Access policies (state, targets, grant/session controls).\n" +
    "- **`role_assignments`** — directory role assignments, active plus PIM-eligible, with an `assignment_kind` discriminator.\n" +
    "- **`app_credentials`** — flattened app & service-principal password/key credentials with scan-time expiry.\n\n" +
    "Each function is a full-pull snapshot (no delta cursor, no marker row): every scan returns the " +
    "complete current state, so refresh by replacing the target table wholesale. An app-only `azure_graph` secret (Microsoft Entra client credentials) is required.",
  "vgi.keywords": JSON.stringify([
    "azure",
    "entra id",
    "azure ad",
    "microsoft graph",
    "governance",
    "security",
    "conditional access",
    "role assignments",
    "pim",
    "credentials",
    "secret expiry",
    "compliance",
    "iam",
  ]),
  "vgi.author": "Query Farm LLC",
  "vgi.copyright": "Copyright 2026 Query Farm LLC",
  "vgi.license": "MIT",
  "vgi.support_contact": ISSUES,
  "vgi.support_policy_url": ISSUES,
  // Guaranteed-runnable, catalog-qualified examples (VGI509/VGI906). A LIVE snapshot needs
  // an attached azure_graph secret and a network call to Microsoft Graph, so these are
  // credential-free `LIMIT 0` schema/bind probes: they verify each function binds and
  // expose its exact result columns without fetching (and without credentials). Drop the
  // `LIMIT 0` and attach an azure_graph secret to pull real rows — the fuller, data-
  // returning queries live in each function's `examples` and the schema `example_queries`.
  "vgi.executable_examples": JSON.stringify([
    {
      name: "conditional_access_policies_bind_probe",
      description:
        "Bind conditional_access_policies and expose its result columns (credential-free; drop LIMIT 0 and attach an azure_graph secret to pull real policies)",
      sql: "SELECT id, display_name, state FROM azure.main.conditional_access_policies() LIMIT 0",
    },
    {
      name: "role_assignments_bind_probe",
      description:
        "Bind role_assignments and expose its result columns (credential-free; attach an azure_graph secret to pull real assignments)",
      sql: "SELECT assignment_kind, principal_id, role_display_name FROM azure.main.role_assignments() LIMIT 0",
    },
    {
      name: "app_credentials_bind_probe",
      description:
        "Bind app_credentials and expose its result columns (credential-free; attach an azure_graph secret to pull real credentials)",
      sql: "SELECT owner_display_name, credential_type, end_date_time, days_until_expiry, is_expired FROM azure.main.app_credentials() LIMIT 0",
    },
  ]),
  // The agent-suitability suite (VGI152), catalog only. Governance scans require an
  // azure_graph secret and return tenant-specific, non-deterministic data, so these
  // tasks are graded by success_criteria (LLM judge) rather than a reference_sql /
  // check_sql oracle (which would need live credentials and stable ground truth).
  "vgi.agent_test_tasks": JSON.stringify([
    {
      name: "enabled_ca_policies",
      prompt: "List the enabled Conditional Access policies in the Entra ID tenant with their display names.",
      // reference_sql / success_criteria are GRADER-ONLY (never shown to the analyst). It
      // declares per-object test coverage (VGI520) by calling the table function; it cannot
      // actually execute without an attached azure_graph secret, so live agent-simulation
      // (VGI920) is credential-blocked — grading falls to success_criteria when creds exist.
      reference_sql:
        "SELECT display_name FROM azure.main.conditional_access_policies() WHERE state = 'enabled' ORDER BY display_name",
      success_criteria:
        "The answer queries azure.main.conditional_access_policies(), filters to state = 'enabled', and returns display_name.",
    },
    {
      name: "global_admins",
      prompt: "Who holds the Global Administrator directory role, and are those assignments active or PIM-eligible?",
      reference_sql:
        "SELECT principal_id, assignment_kind FROM azure.main.role_assignments() WHERE role_display_name = 'Global Administrator' ORDER BY principal_id, assignment_kind",
      success_criteria:
        "The answer queries azure.main.role_assignments(), filters role_display_name to the Global Administrator role, and returns principal_id together with the assignment_kind ('active' vs 'eligible') discriminator.",
    },
    {
      name: "credentials_expiring_soon",
      prompt: "Which application or service-principal credentials expire within the next 30 days?",
      reference_sql:
        "SELECT owner_display_name, credential_type, days_until_expiry FROM azure.main.app_credentials(expiring_within_days := 30) ORDER BY days_until_expiry, owner_display_name",
      success_criteria:
        "The answer queries azure.main.app_credentials(), restricts to credentials expiring within 30 days (via the expiring_within_days := 30 argument or a WHERE days_until_expiry <= 30 filter), and returns the owner and expiry information.",
    },
  ]),
};

/** Schema-level tags: docs, discovery, the category registry, and shown examples. */
const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Entra Governance",
  "vgi.doc_llm":
    "The Microsoft Entra ID governance-posture functions. Each function is a full-pull SNAPSHOT of one " +
    "governance surface — Conditional Access policies, directory role assignments (active plus " +
    "PIM-eligible unioned via assignment_kind), or flattened app/service-principal credential expiry. " +
    "There is no delta cursor and no marker row: every scan returns the complete current state, so " +
    "consumers replace the target table wholesale on refresh. app_credentials computes scan-time " +
    "days_until_expiry / is_expired and accepts an optional expiring_within_days filter.",
  "vgi.doc_md":
    "## Entra governance snapshot functions\n\n" +
    "| Function | Surface | Returns |\n" +
    "| --- | --- | --- |\n" +
    "| `conditional_access_policies` | Conditional Access | one row per CA policy |\n" +
    "| `role_assignments` | Directory roles | active ∪ PIM-eligible assignments |\n" +
    "| `app_credentials` | Credential hygiene | one row per app/SP password or key credential |\n\n" +
    "All three are full-pull snapshots (no `_row_kind` marker, no delta cursor): every scan is the " +
    "complete current state. Refresh by replacing the target table. Each requires an app-only " +
    "`azure_graph` secret.",
  "vgi.keywords": JSON.stringify([
    "entra id",
    "azure ad",
    "governance",
    "security",
    "conditional access",
    "role assignments",
    "pim",
    "credential expiry",
    "compliance",
  ]),
  domain: "security",
  // Ordered navigation registry; each `name` is referenced by a function's vgi.category.
  "vgi.categories": JSON.stringify([
    {
      name: "conditional-access",
      title: "Conditional Access",
      description:
        "Microsoft Entra Conditional Access policies — their state, targeted users/apps, and grant/session controls.",
    },
    {
      name: "role-assignments",
      title: "Directory Role Assignments",
      description:
        "Privileged directory role assignments — active assignments unioned with PIM-eligible schedules via an assignment_kind discriminator.",
    },
    {
      name: "credential-hygiene",
      title: "Credential Hygiene",
      description:
        "Application and service-principal password/key credential inventory with scan-time expiry (days_until_expiry / is_expired).",
    },
  ]),
  "vgi.example_queries": JSON.stringify([
    {
      description: "Enabled Conditional Access policies",
      sql: "SELECT id, display_name, state FROM azure.main.conditional_access_policies() WHERE state = 'enabled'",
    },
    {
      description: "PIM-eligible directory role assignments",
      sql: "SELECT role_display_name, principal_id, status FROM azure.main.role_assignments() WHERE assignment_kind = 'eligible'",
    },
    {
      description: "Credentials expiring within 30 days",
      sql: "SELECT owner_display_name, credential_type, end_date_time, days_until_expiry FROM azure.main.app_credentials(expiring_within_days := 30) ORDER BY days_until_expiry",
    },
    {
      description: "Already-expired app & service-principal credentials",
      sql: "SELECT owner_kind, owner_display_name, credential_type, end_date_time FROM azure.main.app_credentials() WHERE is_expired",
    },
  ]),
};

// conditional_access_policies and role_assignments take no arguments — a
// parameterless table function always returns the same rows, so each is ALSO
// exposed as a regular table that scans the function (VGI311). The function-call
// form (`conditional_access_policies()`) stays available; the table form
// (`SELECT * FROM azure.main.conditional_access_policies`) is the ergonomic
// alias. Column comments + table tags document the table surface.

const CA_COLUMN_COMMENTS: Record<string, string> = {
  id: "Conditional Access policy id (GUID).",
  display_name: "Policy display name.",
  state: "Policy state: `enabled`, `disabled`, or `enabledForReportingButNotEnforced`.",
  created_date_time: "ISO-8601 (UTC) timestamp the policy was created; NULL if unknown.",
  modified_date_time: "ISO-8601 (UTC) timestamp the policy was last modified; NULL if never modified.",
  included_users_json: "JSON array of targeted user/role/group ids (conditions.users.includeUsers).",
  excluded_users_json: "JSON array of excluded user/role/group ids.",
  included_apps_json: "JSON array of targeted application ids (conditions.applications.includeApplications).",
  grant_controls_json: "JSON object of grant controls (e.g. MFA, compliant device, terms of use).",
  session_controls_json: "JSON object of session controls (e.g. sign-in frequency, app-enforced restrictions).",
  client_app_types_json: "JSON array of client app types the policy applies to.",
  raw_json: "The full Graph policy object as JSON.",
};

const ROLE_COLUMN_COMMENTS: Record<string, string> = {
  assignment_kind: "`active` (a live roleAssignment) or `eligible` (a PIM roleEligibilityScheduleInstance).",
  id: "The assignment / eligibility instance id.",
  principal_id: "Object id of the assigned principal (user, group, or service principal).",
  principal_type: "Principal kind: `user`, `group`, or `servicePrincipal`; NULL if not resolvable.",
  role_definition_id: "The directory role definition (template) id.",
  role_display_name: "Human-readable role name (e.g. Global Administrator); NULL if not expanded.",
  directory_scope_id: "Scope of the assignment (e.g. `/` for tenant-wide).",
  start_date_time: "Eligibility schedule start (ISO-8601 UTC); NULL for active assignments.",
  end_date_time: "Assignment/eligibility end (ISO-8601 UTC); NULL means permanent.",
  member_type: "How the assignment was granted (e.g. Direct, Group, Inherited).",
  status: "Eligibility status (e.g. Provisioned); NULL for active assignments.",
  raw_json: "The full Graph assignment object as JSON.",
};

const CA_TABLE_TAGS: Record<string, string> = {
  "vgi.title": "Entra Conditional Access Policies",
  "vgi.category": "conditional-access",
  domain: "security",
  "vgi.keywords": JSON.stringify([
    "conditional access",
    "ca policy",
    "entra id",
    "azure ad",
    "security",
    "mfa",
    "grant controls",
    "governance",
  ]),
  "vgi.doc_llm":
    "Snapshot table of every Microsoft Entra Conditional Access policy in the tenant via Microsoft " +
    "Graph v1.0. One row per policy with its state (enabled / disabled / enabledForReportingButNotEnforced), " +
    "timestamps, and the targeted users, apps, grant controls, and session controls as JSON columns. " +
    "Full pull — every scan returns the complete current set. Requires an azure_graph secret with " +
    "Policy.Read.All.",
  "vgi.doc_md":
    "## conditional_access_policies\n\n" +
    "Every Conditional Access policy in the Microsoft Entra tenant, one row each, backed by Microsoft " +
    "Graph's identity/conditionalAccess/policies endpoint. Targeting and controls are surfaced as JSON " +
    "columns so nested policy conditions stay queryable. Query it as a table (no parentheses) or as the " +
    "conditional_access_policies() function.",
  "vgi.example_queries": JSON.stringify([
    {
      description: "All Conditional Access policies with their state",
      sql: "SELECT id, display_name, state FROM azure.main.conditional_access_policies",
    },
    {
      description: "Only the enabled (enforced) policies",
      sql: "SELECT display_name FROM azure.main.conditional_access_policies WHERE state = 'enabled'",
    },
    {
      description: "Grant controls for each enabled policy",
      sql: "SELECT display_name, grant_controls_json FROM azure.main.conditional_access_policies WHERE state = 'enabled'",
    },
  ]),
};

const ROLE_TABLE_TAGS: Record<string, string> = {
  "vgi.title": "Entra Directory Role Assignments",
  "vgi.category": "role-assignments",
  domain: "security",
  "vgi.keywords": JSON.stringify([
    "role assignments",
    "directory roles",
    "pim",
    "eligible",
    "active",
    "entra id",
    "azure ad",
    "governance",
    "security",
  ]),
  "vgi.doc_llm":
    "Snapshot table of Microsoft Entra directory role assignments via Microsoft Graph v1.0. Unions the " +
    "active assignments with the PIM-eligible schedule instances into one table, distinguished by the " +
    "assignment_kind column ('active' vs 'eligible'). One row per assignment with the principal, role, " +
    "scope, and (for eligible rows) schedule bounds and status. Full pull. Requires an azure_graph " +
    "secret with RoleManagement.Read.Directory.",
  "vgi.doc_md":
    "## role_assignments\n\n" +
    "Directory role assignments in the Microsoft Entra tenant, unioning active assignments with " +
    "PIM-eligible schedule instances. The assignment_kind discriminator tells the two apart; " +
    "start_date_time / end_date_time / status are populated only on eligible rows. Query it as a table " +
    "(no parentheses) or as the role_assignments() function.",
  "vgi.example_queries": JSON.stringify([
    {
      description: "All directory role assignments (active and PIM-eligible)",
      sql: "SELECT assignment_kind, role_display_name, principal_id FROM azure.main.role_assignments",
    },
    {
      description: "Only PIM-eligible (not yet activated) assignments",
      sql: "SELECT role_display_name, principal_id, status FROM azure.main.role_assignments WHERE assignment_kind = 'eligible'",
    },
    {
      description: "Active assignment count per directory role",
      sql: "SELECT role_display_name, count(*) FROM azure.main.role_assignments WHERE assignment_kind = 'active' GROUP BY role_display_name ORDER BY count(*) DESC",
    },
  ]),
};

export function makeCatalog(functions: VgiFunction[]): CatalogDescriptor {
  const byName = new Map(functions.map((f) => [f.meta.name, f] as const));
  const caFn = byName.get("conditional_access_policies");
  const roleFn = byName.get("role_assignments");
  if (!caFn || !roleFn) throw new Error("makeCatalog: expected conditional_access_policies and role_assignments functions");
  return {
    name: "azure",
    defaultSchema: "main",
    comment:
      "Microsoft Entra governance posture (CA policies, role assignments, credential expiry) via Graph — vgi-azure-governance",
    sourceUrl: REPO,
    tags: CATALOG_TAGS,
    secretTypes: [AZURE_GRAPH_SECRET],
    schemas: [
      {
        name: "main",
        comment:
          "Microsoft Entra ID governance snapshots (Conditional Access, directory role assignments, app credential expiry) via Microsoft Graph.",
        tags: SCHEMA_TAGS,
        // The two parameterless snapshot functions are also exposed as regular
        // tables that scan them (VGI311), so `SELECT * FROM azure.main.<name>`
        // works without parentheses. The functions stay callable too.
        tables: [
          {
            name: "conditional_access_policies",
            function: caFn,
            comment: "Microsoft Entra Conditional Access policies (snapshot) via Microsoft Graph v1.0.",
            tags: CA_TABLE_TAGS,
            columnComments: CA_COLUMN_COMMENTS,
            // Mirrors the non-nullable fields of CA_POLICIES_SCHEMA.
            notNull: ["id"],
            // Each policy id is a unique GUID — the natural key of this snapshot.
            primaryKey: [["id"]],
          },
          {
            name: "role_assignments",
            function: roleFn,
            comment:
              "Microsoft Entra directory role assignments — active ∪ PIM-eligible (snapshot) via Microsoft Graph v1.0.",
            tags: ROLE_TABLE_TAGS,
            columnComments: ROLE_COLUMN_COMMENTS,
            // Mirrors the non-nullable fields of ROLE_ASSIGNMENTS_SCHEMA.
            notNull: ["assignment_kind", "id", "principal_id", "role_definition_id"],
            // The union carries two id spaces (active roleAssignments and eligible
            // schedule instances); (assignment_kind, id) is the unique natural key.
            primaryKey: [["assignment_kind", "id"]],
          },
        ],
        functions,
      },
    ],
  };
}
