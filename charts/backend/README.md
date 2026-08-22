# backend

Helm chart for the Imp List backend API (Go/Echo/Postgres — offline-first
shopping list sync server).

Deploys, as its own OCI artifact, independently of the backend Docker image:
own semver, own git tag namespace (`backend-chart-v*`), own release
workflow (`.github/workflows/backend-chart-release.yml`). The chart's
default `image.tag` in `values.yaml` is kept current automatically by
Renovate's built-in `helm-values` manager, and a custom regex manager keeps
`Chart.yaml`'s checked-in `appVersion` in step with it (see
`renovate.json5`) — chart version and image version otherwise move
independently. The published OCI chart's `appVersion` is also always
explicitly set to the correct value at package time
(`backend-chart-release.yml`'s `helm package --app-version`), regardless of
what's committed in git.

## Install

```console
helm install my-backend oci://registry-1.docker.io/powerofcreation/imp-list-charts/backend \
  --set secret.existingSecret=my-backend-credentials
```

## Credentials

The backend requires `DATABASE_URL`, `KEYCLOAK_ISSUER`, and
`KEYCLOAK_CLIENT_ID` at boot (it fails to start without the latter two).
Provide them one of two ways:

- **`secret.existingSecret`** (recommended): the name of a Secret you create
  and manage out-of-band, with the keys named per `secret.existingSecretKeys`
  (defaults: `DATABASE_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`). Real
  credentials never need to touch `values.yaml` or git this way.
- **`secret.databaseUrl` / `secret.keycloakIssuer` / `secret.keycloakClientId`**
  inline values — only intended for local dev/testing via `--set`, not for a
  values file committed to git.

Keycloak is a single shared hosted instance
(`sso.ops.light-dev-solutions.de`) used for both dev and prod — it is never
deployed by this chart.

## Migrations

DB migrations run automatically in-process on every pod boot, serialized via
a Postgres advisory lock — no Helm hook or init container is needed or
provided for this.

## Known limitations

- **One static probe for both liveness and readiness.** The backend exposes
  a single `GET /healthz` (no separate readiness endpoint) that only checks
  DB migrations + Keycloak OIDC discovery once, at boot — it's a legitimate
  signal that startup succeeded, but it never re-checks Postgres/Keycloak
  connectivity afterward, so a pod that loses its DB connection post-boot
  will keep reporting 200 on both probes.
- **No graceful shutdown.** `cmd/api/main.go` has no SIGTERM handling or
  `http.Server.Shutdown` — it exits immediately on SIGTERM, so rolling
  updates or scale-downs can cut in-flight requests and the
  `/api/v1/sync/ws` websocket abruptly. `preStopSleepSeconds` (0 = disabled
  by default, requires Kubernetes 1.29+) delays the SIGTERM via K8s' native
  preStop `sleep` action to give endpoint removal time to propagate first —
  it narrows the window but doesn't make this a real graceful shutdown.
- **`serviceMonitor` is a no-op today.** The backend has no `/metrics`
  endpoint yet; the template exists (guarded on the prometheus-operator CRD
  being present) as scaffolding for when it does.
- **`service.targetPort` must stay `8080`.** The backend doesn't read a
  `PORT` env var.

## Values

See [`values.yaml`](./values.yaml) for the full set of configurable values
and inline comments.
