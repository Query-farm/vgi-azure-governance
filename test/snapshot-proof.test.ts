// THE reason vgi-azure-governance exists: prove the SNAPSHOT archetype end to end —
// a full paginated pull, flattened per-credential rows with scan-time expiry math,
// the expiring_within_days filter, and the honest no-cursor contract. This test
// imports ONLY @vgi-azure/graph-core + the package's own pure driver + bun:test (NO
// @query-farm/* imports), so it runs without the SDK installed.

import { test, expect } from "bun:test";
import { paginate } from "@vgi-azure/graph-core";
import {
  collectPages,
  appCredentialsQueue,
  flattenCredentials,
  daysUntil,
  type AppCredentialRow,
} from "../src/governance.js";
import { makeFakeGraph } from "./fake-graph.js";

// A frozen scan wall-clock so the expiry math is deterministic (the worker uses
// Date.now(); the pure driver takes it as an argument for exactly this reason).
const NOW = Date.parse("2026-07-04T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (deltaDays: number) => new Date(NOW + deltaDays * DAY).toISOString();

// Two applications, each with a password + a key credential, split across two pages
// to force the snapshot pager to follow @odata.nextLink verbatim. One password is
// already expired; one key credential has NO endDateTime (never expires).
const applicationsPage1 = [
  {
    id: "app-1",
    appId: "aaa-client",
    displayName: "App One",
    passwordCredentials: [{ keyId: "pw-1", displayName: "secret", endDateTime: iso(10) }],
    keyCredentials: [{ keyId: "key-1", displayName: "cert", endDateTime: iso(40), usage: "Verify" }],
  },
];
const applicationsPage2 = [
  {
    id: "app-2",
    appId: "bbb-client",
    displayName: "App Two",
    passwordCredentials: [{ keyId: "pw-2", displayName: "old-secret", endDateTime: iso(-5) }],
    keyCredentials: [{ keyId: "key-2", displayName: "eternal", endDateTime: null }],
  },
];
const servicePrincipals = [
  {
    id: "sp-1",
    appId: "ccc-client",
    displayName: "SP One",
    passwordCredentials: [{ keyId: "sp-pw-1", endDateTime: iso(3) }],
    keyCredentials: [],
  },
];

function fake() {
  return makeFakeGraph({ applicationsPage1, applicationsPage2, servicePrincipals });
}
const byKey = (rows: AppCredentialRow[]) => Object.fromEntries(rows.map((r) => [r.credential_key_id, r]));

test("SNAPSHOT pager follows @odata.nextLink verbatim and carries NO delta/watermark cursor", async () => {
  const g = fake();
  const [apps, sps] = appCredentialsQueue();

  // Assert the pager never surfaces a cross-scan cursor: no page yields a deltaLink.
  let sawDelta = false;
  for await (const page of paginate(g.fetch, apps!.url)) if (page.deltaLink) sawDelta = true;
  expect(sawDelta).toBe(false);

  // Measure ONLY this drain (the deltaLink check above already drained once).
  const before = g.calls();
  const objs = await collectPages(g.fetch, apps!.url);
  expect(objs.map((o) => o.id)).toEqual(["app-1", "app-2"]); // both pages drained
  expect(g.calls() - before).toBe(2); // page 1 → nextLink → page 2 (terminal)

  // Snapshot state is a queue of plain {url, ownerKind} strings — fully serializable,
  // no socket / RecordBatch / Date. JSON round-trip is lossless (the §2 state rule).
  expect(JSON.parse(JSON.stringify(appCredentialsQueue()))).toEqual(appCredentialsQueue());
  expect(sps!.ownerKind).toBe("servicePrincipal");
});

test("flatten fan-out: 2 apps × (password + key) → 4 credential rows, correct owner_kind/credential_type", async () => {
  const g = fake();
  const objs = await collectPages(g.fetch, appCredentialsQueue()[0]!.url);
  const rows = flattenCredentials(objs, "application", NOW, null); // no filter → every credential

  expect(rows.length).toBe(4);
  expect(rows.every((r) => r.owner_kind === "application")).toBe(true);
  const m = byKey(rows);
  expect(m["pw-1"]!.credential_type).toBe("password");
  expect(m["key-1"]!.credential_type).toBe("key");
  expect(m["key-1"]!.usage).toBe("Verify");
  expect(m["pw-1"]!.owner_id).toBe("app-1");
  expect(m["pw-1"]!.app_id).toBe("aaa-client");
  expect(m["pw-2"]!.owner_id).toBe("app-2");
});

test("scan-time expiry math: days_until_expiry + is_expired computed against the scan clock", async () => {
  const g = fake();
  const objs = await collectPages(g.fetch, appCredentialsQueue()[0]!.url);
  const m = byKey(flattenCredentials(objs, "application", NOW, null));

  expect(m["pw-1"]!.days_until_expiry).toBe(10);
  expect(m["pw-1"]!.is_expired).toBe(false); // future
  expect(m["key-1"]!.days_until_expiry).toBe(40);
  expect(m["pw-2"]!.days_until_expiry).toBe(-5);
  expect(m["pw-2"]!.is_expired).toBe(true); // past
  // A credential with no endDateTime never expires → both columns are null (unknown), not false.
  expect(m["key-2"]!.days_until_expiry).toBeNull();
  expect(m["key-2"]!.is_expired).toBeNull();
  expect(daysUntil(null, NOW)).toBeNull();
});

test("expiring_within_days filters after flatten: keeps due+past, drops far-future and never-expiring", async () => {
  const g = fake();
  const objs = await collectPages(g.fetch, appCredentialsQueue()[0]!.url);
  const rows = flattenCredentials(objs, "application", NOW, 30); // within 30 days

  const keys = rows.map((r) => r.credential_key_id).sort();
  // pw-1 (10d) and pw-2 (-5d, already expired) are within/under 30; key-1 (40d) is out,
  // key-2 (no expiry) is excluded because "within N days" cannot include a never-expiring cred.
  expect(keys).toEqual(["pw-1", "pw-2"]);
  expect(rows.every((r) => r.days_until_expiry != null && r.days_until_expiry <= 30)).toBe(true);
});

test("apps AND service principals both flatten, each stamped with its owner_kind", async () => {
  const g = fake();
  const spObjs = await collectPages(g.fetch, appCredentialsQueue()[1]!.url);
  const spRows = flattenCredentials(spObjs, "servicePrincipal", NOW, null);

  expect(spRows.length).toBe(1);
  expect(spRows[0]!.owner_kind).toBe("servicePrincipal");
  expect(spRows[0]!.owner_id).toBe("sp-1");
  expect(spRows[0]!.days_until_expiry).toBe(3);
});

test("no cursor to advance: re-running the full pull yields an identical row set (staleness, never a torn snapshot)", async () => {
  const run = async () => {
    const g = fake();
    const objs = await collectPages(g.fetch, appCredentialsQueue()[0]!.url);
    return flattenCredentials(objs, "application", NOW, null);
  };
  expect(await run()).toEqual(await run()); // idempotent full replace — there is no token to corrupt
});
