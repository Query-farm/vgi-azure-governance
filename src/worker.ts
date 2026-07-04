// vgi-azure-governance stdio worker entry. DuckDB spawns this and ATTACHes it:
//   ATTACH 'gov' AS gov (TYPE vgi, LOCATION '/path/to/worker.ts');
//   CREATE SECRET g (TYPE azure_graph, TENANT_ID '…', CLIENT_ID '…', CLIENT_SECRET '…');
//   SELECT * FROM gov.conditional_access_policies();
//   SELECT * FROM gov.role_assignments();
//   SELECT * FROM gov.app_credentials(expiring_within_days := 30);
//
// SNAPSHOT worker: every scan is a full pull, no cursor persisted. The caller owns
// atomicity via a full-replace transaction (CREATE OR REPLACE TABLE … AS SELECT …).
//
// Required Graph application permissions (admin-consented):
//   Policy.Read.All              — conditional_access_policies
//   Application.Read.All         — app_credentials (metadata only; no secret material)
//   RoleManagement.Read.Directory — role_assignments (covers BOTH active roleAssignments
//                                    AND roleEligibilityScheduleInstances). The previously
//                                    listed RoleManagement.Read.All is DROPPED as a redundant
//                                    superset (frozen least-privilege rule G).

import { Worker, ReadOnlyCatalogInterface, FunctionRegistry } from "@query-farm/vgi";
import { TokenCache, makeGraphClient, type Fetch } from "@vgi-azure/graph-core";
import { makeMsalMinter } from "@vgi-azure/node-auth";
import { makeFunctions } from "./functions.js";
import { makeCatalog } from "./catalog.js";

const cache = new TokenCache(makeMsalMinter());

const clientFactory = (secret: Record<string, unknown>) =>
  makeGraphClient({
    fetch: globalThis.fetch as unknown as Fetch,
    cache,
    cred: {
      tenantId: String(secret.tenant_id ?? ""),
      clientId: String(secret.client_id ?? ""),
      clientSecret: secret.client_secret != null ? String(secret.client_secret) : undefined,
    },
    audience: "graph", // this worker reads Microsoft Graph only.
  });

const functions = makeFunctions(clientFactory);

const registry = new FunctionRegistry();
for (const f of functions) registry.register(f);

const catalogInterface = new ReadOnlyCatalogInterface(makeCatalog(functions), registry);

new Worker({ functions, catalogInterface }).run();
