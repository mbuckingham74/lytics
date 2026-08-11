# Lytics

Lytics is deployed as one self-hosted application container with a persistent
SQLite volume and an operator-supplied GeoLite2 City database. This R1 setup
does not require Redis, queues, workers, or an external database.

## Prerequisites

- Docker Engine with the Docker Compose plugin
- A MaxMind GeoLite2 City `.mmdb` file stored on the Docker host
- An IANA time zone for reporting, such as `America/Los_Angeles`

Lytics does not download or include the GeoLite2 database. Keep the file on the
host and update it according to your MaxMind account and license terms.

## Configure and run

Copy the example environment file and edit all three values:

```sh
cp .env.example .env
```

`LYTICS_BIND_ADDRESS` must be one specific address on the Lytics host that
Nginx Proxy Manager (NPM) can reach:

- Use `127.0.0.1` only when NPM can reach the Lytics host's loopback interface.
  This is appropriate for a proxy running directly on the host, but a proxy in
  a container generally cannot use its own `127.0.0.1` to reach the host.
- Otherwise, use one private address assigned to the Lytics host that is
  reachable from NPM, whether NPM is co-located or on another private host.
  Restrict TCP port `3000` at the Lytics host firewall to NPM's source address.

Do not bind to `0.0.0.0` or a public interface unless that source-address
firewall restriction is in place. Port `3000` must not be broadly exposed.

`LYTICS_TIME_ZONE` must be a valid IANA name.
`LYTICS_GEOLITE2_CITY_HOST_PATH` must be the absolute host path to the GeoLite2
City file.

Build and start the application:

```sh
docker compose build
docker compose up -d
```

## Deploy from a local checkout

Production updates are deployed from a clean, fully pushed local checkout with
`deploy.sh`. Every SSH and rsync operation uses the fixed Tailscale target
`michael@100.120.233.4`; the script has no configurable or fallback SSH route.
Set the sole deployment variable locally:

- `LYTICS_DEPLOY_PATH`: the stable, existing absolute directory containing the
  production Compose deployment, for example `/opt/lytics`.

The remote directory must already exist and be writable by the SSH user. It
must contain its server-owned, readable `.env`, an existing `compose.yaml`, and
the GeoLite2 host file referenced by that `.env`. Docker Engine and the Docker
Compose plugin must be available to the SSH user. The script never transfers
or replaces `.env`. Routine deployment also requires the existing `lytics`
service container to be running with its Compose-managed `lytics-data` named
volume mounted at `/data`, and that volume must already contain a regular,
readable, writable `/data/lytics.sqlite`; this is not an initial-deploy tool.

The script owns one dedicated build context at
`$LYTICS_DEPLOY_PATH/.lytics-deploy-source`. It creates that directory with a
recognizable ownership marker when absent and refuses to use an existing
unmarked, symlinked, or ambiguous path. Rsync deletion is scoped only to this
validated, marker-owned stage, and the marker is protected. This makes removed
or renamed local source disappear from the next build context without making
the production root a deletion target.

The converged stage contains exactly `.dockerignore`, `Dockerfile`,
`package.json`, `package-lock.json`, `next.config.ts`, `next-env.d.ts`,
`tsconfig.json`, and the contents of `app/`, `lib/`, and `public/`. It excludes
every `.env` file, SQLite/database files and sidecars, `.mmdb` files, Git/Codex
and editor metadata, dependencies, build/test output, logs, and documentation.
The production-root `compose.yaml` is updated separately as one explicit file
without deletion. Server-owned `.env`, SQLite and named-volume data, GeoLite2,
and every other production-root runtime file are never rsync deletion targets.

Run the deployment from the repository checkout:

```sh
LYTICS_DEPLOY_PATH=/opt/lytics \
./deploy.sh
```

Deployment is local rsync followed by remote Docker Compose; it never runs
`git pull` or any other server-side Git command. The existing service stays up
while its replacement image builds. After the build, only the `lytics` service
is updated, without removing its persistent volume. The script records the
exact existing named-volume identity before transfer, revalidates it before
the build, and requires the updated container to mount that same volume before
health verification can succeed. An ephemeral Compose override builds only
from the converged staged context, while routine Compose execution remains in
the stable production-root project directory.

Success prints `docker compose ps lytics` and an explicit `SUCCESS` message,
but only after bounded checks confirm the container is running, `GET /`
succeeds, the configured time zone is valid, SQLite is accessible at
`/data/lytics.sqlite`, and the read-only GeoLite2 mount is readable. A startup
or health-check failure exits nonzero with a phase-specific error and the last
150 lines of `lytics` logs. Earlier validation or transfer failures also exit
nonzero with a clear phase, before the service is changed.

Follow logs or stop the deployment without deleting analytics data:

```sh
docker compose logs -f lytics
docker compose down
```

The dashboard listens on port `3000` of the selected host address. Compose
stores the SQLite database at `/data/lytics.sqlite` in the named `lytics-data`
volume. `docker compose down` keeps this volume; `docker compose down -v`
permanently deletes it.

## First site and tracker

Through the authenticated settings page, register the exact hostname of every
website that will send analytics. Add the tracker to each site's pages using
the production Lytics origin:

```html
<script defer src="https://lytics.forkstech.com/tracker.js"></script>
```

The script sends pageviews to `/api/pageviews` on the same Lytics origin. Each
registered website hostname must match that page's `Origin` hostname.

## Production routing for `lytics.forkstech.com`

Keep the existing direct, unproxied DNS A record for
`lytics.forkstech.com`. It must resolve to the public address of the host where
NPM accepts connections, without a CDN or DNS-provider HTTP proxy in the
request path.

Create an NPM proxy host for `lytics.forkstech.com` with these settings:

- Forward scheme: `http`.
- Forward hostname/IP: the exact Lytics host address selected in
  `LYTICS_BIND_ADDRESS`.
- Forward port: `3000`.
- Enable TLS for `lytics.forkstech.com` and redirect public HTTP to HTTPS.
- Overwrite `X-Real-IP` with the address of the client directly connected to
  NPM. Do not append to or preserve an inbound `X-Real-IP` value.

Set the header in NPM's advanced proxy configuration so assignment replaces
any client-supplied value:

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

Configure these ordered Authelia authorization rules before the existing
policy that protects `lytics.forkstech.com`:

1. Bypass authentication only for `GET` and `HEAD` when the path is exactly
   `/tracker.js`.
2. Bypass authentication only for `POST` and `OPTIONS` when the path is exactly
   `/api/pageviews`.
3. Retain the existing Authelia policy for every other method and route,
   including `/settings` and all dashboard routes.

The first two entries under `access_control.rules` therefore have this shape;
keep the existing Lytics rule immediately after them:

```yaml
- domain: lytics.forkstech.com
  resources:
    - '^/tracker\.js$'
  methods:
    - GET
    - HEAD
  policy: bypass
- domain: lytics.forkstech.com
  resources:
    - '^/api/pageviews$'
  methods:
    - POST
    - OPTIONS
  policy: bypass
```

Use exact-path matchers (for example, anchored regular expressions
`^/tracker\.js$` and `^/api/pageviews$`). Do not use prefix or wildcard
matchers: paths beneath or alongside these endpoints must continue to use the
existing authenticated policy.

The selected Lytics host address and its firewall must ensure that only the
intended NPM path can reach port `3000`. Lytics uses the trusted NPM-provided
`X-Real-IP` value for geolocation.

## Production verification

After NPM and Authelia are configured, verify all of the following through
`https://lytics.forkstech.com`:

1. An unauthenticated request to a dashboard route is challenged or denied,
   while an authenticated user can open the dashboard and settings page.
2. An anonymous `GET /tracker.js` succeeds, and `HEAD /tracker.js` is not sent
   to authentication. A different method or a path such as
   `/tracker.js/anything` retains the existing Authelia policy.
3. From each registered website origin, an anonymous CORS preflight
   (`OPTIONS /api/pageviews`) and ingestion request (`POST /api/pageviews`)
   reach Lytics successfully. Unregistered origins must not be treated as
   registered sites.
4. A different method or a path such as `/api/pageviews/anything` retains the
   existing Authelia policy.
5. Record a pageview, recreate the application container with
   `docker compose up -d --force-recreate`, and confirm the dashboard still
   shows the previously stored data from the `lytics-data` volume.
