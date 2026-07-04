// A tiny canned fake of Microsoft Graph for the governance SNAPSHOT worker — enough
// to prove the flatten + expiry math + filter + union + no-cursor archetype. No
// network, no SDK: it implements graph-core's FetchJson by matching URL prefixes and
// returning canned pages (with @odata.nextLink for the multi-page apps fixture).

import type { FetchJson } from "@vgi-azure/graph-core";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Route table: first entry whose URL prefix matches wins. Pages chain via nextLink. */
export interface FakeGraph {
  fetch: FetchJson;
  /** Count of fetchJson calls, to assert page-following. */
  calls: () => number;
}

export function makeFakeGraph(fixtures: {
  caPolicies?: Record<string, unknown>[];
  roleActive?: Record<string, unknown>[];
  roleEligible?: Record<string, unknown>[];
  /** applications page 1 → chains to page 2 (terminal). */
  applicationsPage1?: Record<string, unknown>[];
  applicationsPage2?: Record<string, unknown>[];
  servicePrincipals?: Record<string, unknown>[];
}): FakeGraph {
  let calls = 0;
  const APPS_P2 = `${GRAPH}/applications?$skiptoken=PAGE2`;

  const fetch: FetchJson = async (url) => {
    calls++;
    if (url.startsWith(`${GRAPH}/identity/conditionalAccess/policies`)) {
      return { value: fixtures.caPolicies ?? [] };
    }
    if (url.startsWith(`${GRAPH}/roleManagement/directory/roleAssignments`)) {
      return { value: fixtures.roleActive ?? [] };
    }
    if (url.startsWith(`${GRAPH}/roleManagement/directory/roleEligibilityScheduleInstances`)) {
      return { value: fixtures.roleEligible ?? [] };
    }
    if (url === APPS_P2) {
      return { value: fixtures.applicationsPage2 ?? [] };
    }
    if (url.startsWith(`${GRAPH}/applications`)) {
      // Page 1 → nextLink to page 2 (proves the snapshot pager follows nextLink verbatim).
      return { value: fixtures.applicationsPage1 ?? [], "@odata.nextLink": APPS_P2 };
    }
    if (url.startsWith(`${GRAPH}/servicePrincipals`)) {
      return { value: fixtures.servicePrincipals ?? [] };
    }
    throw new Error(`FakeGraph: no fixture for ${url}`);
  };

  return { fetch, calls: () => calls };
}
