# Governance notebooks

[01 · Which credential metadata belongs in the expiry review queue?](01_credential_expiry_review.ipynb) reads a full synthetic credential inventory through the real VGI functions, checks scan-time expiry calculations, and builds an exact UTC audit deadline. Missing expiry dates remain a separate category. The experiment widens the horizon from 30 to 60 days.

## Run without an Azure account

Requirements: [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/), Git and internet access for public source/dependency downloads. Keep this entire directory together; no worker checkout is required.

```sh
cd notebooks
uv sync --locked
uv run --locked python execute.py
```

Haybarn 2.0.0rc11 and Jupyter/plotting dependencies are locked in `uv.lock`. For an optional editor kernel:

```sh
uv run --locked python -m ipykernel install --user --name vgi-azure-governance-notebooks --display-name "Python (vgi-azure-governance notebooks)"
```

Use this directory as the working directory and Restart Kernel → Run All. The headless runner creates a temporary kernel registration; failed execution leaves the last successful default intact.

## Separate experiment

```sh
uv run --locked python execute.py --parameters '{"HORIZON_DAYS": 60}' --output-dir artifacts/horizon-60
```

Overrides require a separate destination. The executed copy includes branding, docs, environment, runner and fixture companions. Keep the explicit audit instant fixed at `2026-11-14T00:00:00Z` for this comparison; restore horizon 30 for defaults. Logs, experiment copies, extracted charts and virtual environments are ignored.

## Two portable connections

Native `github-auto://Query-farm/vgi-azure-governance@v0.4.0` verifies credential-free schema binding. The second visible command is `bun run governance_fixture.ts Query-farm/vgi-azure-governance 118c35d99680fb6c4807c9169e4c2097dec7f999 fixture.json`. It fetches the same release's immutable source SHA, checks Git HEAD, installs frozen Bun dependencies and caches by repo/SHA/Bun version under `$XDG_CACHE_HOME/vgi-notebook-workers` or `~/.cache`. Setup output goes to stderr, preserving Arrow stdout. Upgrade both pins together and re-execute both runs.

The companion imports the original function/catalog factories and injects the shipped `makeFakeGraph` through the existing ClientFactory seam. Production paging, flattening, schema construction and scan-time day calculations run unchanged. Only the declared application/service-principal fixture endpoints are supported; runtime network fetch and POST are disabled. The dummy secret is not a credential and is ignored by the fake client. No MSAL authentication or tenant data is used. Fixture request tracing is a temporary local file removed during cleanup.

`fixture.json` contains all synthetic metadata. There are no secret values. Dates are deliberately fixed around the audit instant, including a 30.5-day boundary case and missing expiry fields. The worker keeps its actual wall-clock; the notebook records the scan interval and checks its whole-day counters against that interval. SQL then uses absolute expiry timestamps for the explicit audit instant and exact elapsed-day horizon. Full-pull inventory refreshes replace a snapshot rather than appending rows; separate API reads are not an atomic live-directory snapshot.

## Live access is separate

Actual `app_credentials` reads need an `azure_graph` secret and Microsoft Graph `Application.Read.All` application permission, provisioned outside saved notebook cells/outputs. Follow the [worker's credential documentation](https://github.com/Query-farm/vgi-azure-governance#credentials). No live tenant was queried for this notebook. The fixture demonstrates metadata classification, not effective access, privilege, credential use or a production rotation decision.
