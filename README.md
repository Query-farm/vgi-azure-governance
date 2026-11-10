# vgi-azure-governance

A [VGI](https://query.farm) worker (**Microsoft Entra Governance**) for DuckDB. Security-governance snapshots of a Microsoft Entra ID (Azure AD) tenant via Microsoft Graph, as three DuckDB table functions: `conditional_access_policies` (state, targets, grant/session controls), `role_assignments` (directory role assignments, active plus PIM-eligible, with an `assignment_kind` discriminator) and `app_credentials` (app and service-principal password/key credentials with scan-time expiry). Each function is a full-pull snapshot with no cursor or marker row, so refresh by replacing the target table wholesale.

## Quick start

Every [GitHub release](https://github.com/Query-farm/vgi-azure-governance/releases) ships a prebuilt worker binary. The `vgi` extension downloads the one for your platform, checks its SHA-256 and caches it, so there is nothing to install besides DuckDB:

```sql
INSTALL vgi FROM community;
LOAD vgi;

ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-azure-governance@v0.3.0');

-- Bind conditional_access_policies and expose its result columns (credential-free; drop
-- LIMIT 0 and attach an azure_graph secret to pull real policies)
SELECT id, display_name, state FROM azure.main.conditional_access_policies() LIMIT 0;

-- Bind role_assignments and expose its result columns (credential-free; attach an
-- azure_graph secret to pull real assignments)
SELECT assignment_kind, principal_id, role_display_name FROM azure.main.role_assignments() LIMIT 0;
```

The examples are credential-free `LIMIT 0` bind probes: they check that each function binds and show its result columns without calling Azure. To pull real rows, create an `azure_graph` secret (see [Credentials](#credentials)) and drop the `LIMIT 0`.

All the Query Farm Azure workers use the catalog name `azure`. To attach more than one in the same session, give each its own alias (for example `ATTACH 'azure' AS azure_governance (...)`) and qualify queries with that alias instead of `azure`.

Prebuilt binaries cover macOS (Apple silicon), Linux (x86-64 and arm64). `github-auto://` needs an explicit release tag; change `@v0.3.0` to move to a newer release.

### Other ways to run it

- **Docker** (the image bundles the worker; needs a container runtime):

  ```sql
  ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'docker://ghcr.io/query-farm/vgi-azure-governance:0.3.0');
  ```

- **Manual download.** Download the archive for your platform from the [releases page](https://github.com/Query-farm/vgi-azure-governance/releases), verify it against its `.sha256` file (a cosign `.cosign.bundle` is published alongside), unpack it, and set `LOCATION` to the path of the extracted worker executable.

### Build from source

To build and test the worker yourself, see [Development](#development).

## Credentials

Live queries authenticate with an `azure_graph` secret holding app-only Microsoft Entra client credentials for a service principal: `TENANT_ID`, `CLIENT_ID` and `CLIENT_SECRET` (the client secret is redacted when secrets are listed). The worker registers the `azure_graph` secret type when it is attached, so create the secret after the `ATTACH`:

```sql
ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-azure-governance@v0.3.0');
CREATE SECRET azure_sp (TYPE azure_graph, TENANT_ID '<tenant-guid>', CLIENT_ID '<app-guid>', CLIENT_SECRET '<secret>');
```

For this worker the service principal needs the admin-consented Microsoft Graph application permissions `Policy.Read.All`, `RoleManagement.Read.Directory` and `Application.Read.All`.

## Development

Requires [Bun](https://bun.sh). `bun install` also fetches the shared `@vgi-azure/graph-core` package from GitHub.

```bash
bun install && bun test
bun run typecheck
```

To attach a local checkout, point `LOCATION` at the launch wrapper:

```sql
ATTACH 'azure' AS azure (TYPE vgi, LOCATION '/path/to/vgi-azure-governance/bin/vgi-azure-governance-worker');
```

## License

MIT. See [LICENSE](LICENSE).
