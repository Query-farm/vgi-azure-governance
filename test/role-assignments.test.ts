// role_assignments must expand roleDefinition: Graph's roleAssignments and
// roleEligibilityScheduleInstances return only roleDefinitionId unless the navigation
// property is expanded, so without `$expand=roleDefinition` role_display_name is always
// NULL and every "who holds Global Administrator" query returns nothing.

import { test, expect } from "bun:test";
import { collectPages, roleAssignmentsQueue, toRoleAssignmentRow } from "../src/governance.js";
import type { FetchJson } from "@vgi-azure/graph-core";

const GA = "62e90394-69f5-4237-9190-012177145e10";

/** Mimics Graph: the roleDefinition object is present only when it was $expand-ed. */
const graph: FetchJson = async (url) => {
  const expanded = new URL(url).searchParams.get("$expand")?.split(",").includes("roleDefinition") ?? false;
  const base = { id: "a-1", principalId: "u-1", roleDefinitionId: GA, directoryScopeId: "/" };
  return { value: [expanded ? { ...base, roleDefinition: { id: GA, displayName: "Global Administrator" } } : base] };
};

test("both role endpoints expand roleDefinition so role_display_name is populated", async () => {
  const queue = roleAssignmentsQueue();
  expect(queue.map((e) => e.kind)).toEqual(["active", "eligible"]);
  for (const entry of queue) {
    const rows = (await collectPages(graph, entry.url)).map((o) => toRoleAssignmentRow(o, entry.kind));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role_display_name).toBe("Global Administrator");
    expect(rows[0]!.role_definition_id).toBe(GA);
  }
});
