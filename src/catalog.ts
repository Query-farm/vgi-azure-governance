// The `azure` catalog descriptor + the azure_graph secret type. Reuses the exact
// app-only client-credentials secret shape frozen by vgi-azure-directory (the
// graph-core seam owner) so every vgi-azure-* worker shares one secret contract.

import { Schema, Field, Utf8 } from "@query-farm/apache-arrow";
import type { CatalogDescriptor, SecretTypeDescriptor, VgiFunction } from "@query-farm/vgi";

export const AZURE_GRAPH_SECRET: SecretTypeDescriptor = {
  name: "azure_graph",
  description: "Microsoft Entra app-only (client-credentials) credentials for Microsoft Graph",
  schema: new Schema([
    new Field("tenant_id", new Utf8(), true),
    new Field("client_id", new Utf8(), true),
    new Field("client_secret", new Utf8(), true, new Map([["redact", "true"]])),
  ]),
};

export function makeCatalog(functions: VgiFunction[]): CatalogDescriptor {
  return {
    name: "azure",
    defaultSchema: "main",
    comment:
      "Microsoft Entra governance posture (CA policies, role assignments, credential expiry) via Graph — vgi-azure-governance",
    sourceUrl: "https://query.farm",
    secretTypes: [AZURE_GRAPH_SECRET],
    schemas: [{ name: "main", functions }],
  };
}
