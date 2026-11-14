// Composed example queries — each combines two of this worker's governance surfaces in
// one realistic audit query. Defined once here and referenced from both the schema-level
// `vgi.example_queries` (src/catalog.ts) and the example list of the function that drives
// the query (src/functions.ts), so the SQL is never copy-pasted.

export interface ExampleQuery {
  description: string;
  sql: string;
}

/** conditional_access_policies × role_assignments: privileged principals carved out of enforced policies. */
export const CA_EXCLUDED_ROLE_HOLDERS: ExampleQuery = {
  description:
    "Directory-role holders (active or PIM-eligible) that an enabled Conditional Access policy explicitly excludes by user id — the break-glass / exclusion audit",
  sql:
    "WITH excluded AS (SELECT ca.display_name AS policy_name, x.principal_id " +
    "FROM azure.main.conditional_access_policies() AS ca, " +
    "unnest(from_json(ca.excluded_users_json, '[\"VARCHAR\"]')) AS x(principal_id) " +
    "WHERE ca.state = 'enabled') " +
    "SELECT e.policy_name, r.role_display_name, r.principal_id, r.assignment_kind " +
    "FROM excluded AS e JOIN azure.main.role_assignments() AS r ON r.principal_id = e.principal_id " +
    "ORDER BY e.policy_name, r.role_display_name, r.principal_id, r.assignment_kind",
};

/** role_assignments × conditional_access_policies: held roles no enforced policy targets by role. */
export const ROLES_WITHOUT_ROLE_TARGETED_CA: ExampleQuery = {
  description:
    "Held directory roles that no enabled Conditional Access policy targets by role (conditions.users.includeRoles), with the number of distinct holders; policies scoped to all users are not counted",
  sql:
    "WITH targeted AS (SELECT DISTINCT t.role_id " +
    "FROM azure.main.conditional_access_policies() AS ca, " +
    "unnest(from_json(json_extract(ca.raw_json, '$.conditions.users.includeRoles'), '[\"VARCHAR\"]')) AS t(role_id) " +
    "WHERE ca.state = 'enabled') " +
    "SELECT r.role_display_name, count(DISTINCT r.principal_id) AS holders " +
    "FROM azure.main.role_assignments() AS r " +
    "WHERE r.role_definition_id NOT IN (SELECT role_id FROM targeted) " +
    "GROUP BY r.role_display_name ORDER BY holders DESC, r.role_display_name",
};

/** app_credentials × role_assignments: expiring secrets/certs on privileged service principals. */
export const PRIVILEGED_SP_EXPIRING_CREDENTIALS: ExampleQuery = {
  description:
    "Credentials held directly on a service principal that also holds a directory role, expiring within 30 days or already expired (soonest first), with the roles it holds",
  sql:
    "WITH privileged AS (SELECT principal_id, string_agg(DISTINCT role_display_name, ', ' ORDER BY role_display_name) AS roles " +
    "FROM azure.main.role_assignments() GROUP BY principal_id) " +
    "SELECT c.owner_display_name, p.roles, c.credential_type, c.end_date_time, c.days_until_expiry " +
    "FROM azure.main.app_credentials(expiring_within_days := 30) AS c " +
    "JOIN privileged AS p ON p.principal_id = c.owner_id " +
    "WHERE c.owner_kind = 'servicePrincipal' " +
    "ORDER BY c.days_until_expiry, c.owner_display_name, c.credential_type",
};

export const COMPOSED_EXAMPLES: ExampleQuery[] = [
  CA_EXCLUDED_ROLE_HOLDERS,
  ROLES_WITHOUT_ROLE_TARGETED_CA,
  PRIVILEGED_SP_EXPIRING_CREDENTIALS,
];
