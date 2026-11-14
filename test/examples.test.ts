// The composed example queries are defined once (src/examples.ts) and must surface both in
// the schema-level example list and within the first five examples of the function that
// drives each query (the vgi-lint agent simulator shows only those).

import { test, expect } from "bun:test";
import { makeFunctions } from "../src/functions.js";
import { makeCatalog } from "../src/catalog.js";
import {
  COMPOSED_EXAMPLES,
  CA_EXCLUDED_ROLE_HOLDERS,
  ROLES_WITHOUT_ROLE_TARGETED_CA,
  PRIVILEGED_SP_EXPIRING_CREDENTIALS,
  type ExampleQuery,
} from "../src/examples.js";

const functions = makeFunctions(() => {
  throw new Error("no client in this test");
});
const catalog = makeCatalog(functions);
const parse = (tag: string | undefined) => JSON.parse(tag ?? "[]") as ExampleQuery[];

test("every composed example is in the schema-level example_queries", () => {
  const schemaExamples = parse(catalog.schemas[0]!.tags!["vgi.example_queries"]);
  for (const ex of COMPOSED_EXAMPLES) expect(schemaExamples).toContainEqual(ex);
});

test("each composed example is within the first 5 examples of its driving function", () => {
  const drivers: [string, ExampleQuery][] = [
    ["conditional_access_policies", CA_EXCLUDED_ROLE_HOLDERS],
    ["role_assignments", ROLES_WITHOUT_ROLE_TARGETED_CA],
    ["app_credentials", PRIVILEGED_SP_EXPIRING_CREDENTIALS],
  ];
  for (const [name, ex] of drivers) {
    const fn = functions.find((f) => f.meta.name === name)!;
    const tagged = parse(fn.meta.tags?.["vgi.example_queries"]).slice(0, 5);
    expect(tagged).toContainEqual(ex);
    const native = (fn.meta.examples ?? []).slice(0, 5).map((e) => e.sql);
    expect(native).toContain(ex.sql);
  }
});
