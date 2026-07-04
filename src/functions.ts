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
