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

Copy the example environment file and edit both values:

```sh
cp .env.example .env
```

`LYTICS_TIME_ZONE` must be a valid IANA name.
`LYTICS_GEOLITE2_CITY_HOST_PATH` must be the absolute host path to the GeoLite2
City file.

Build and start the application:

```sh
docker compose build
docker compose up -d
```

Follow logs or stop the deployment without deleting analytics data:

```sh
docker compose logs -f lytics
docker compose down
```

The dashboard listens on host port 3000. Compose stores the SQLite database at
`/data/lytics.sqlite` in the named `lytics-data` volume. `docker compose down`
keeps this volume; `docker compose down -v` permanently deletes it.

## First site and tracker

Open `http://127.0.0.1:3000/settings` and register the exact domain that will
send analytics. Add the tracker to that site's pages using the public HTTPS
origin through which Lytics is served:

```html
<script defer src="https://analytics.example.com/tracker.js"></script>
```

The script sends pageviews to `/api/pageviews` on the same Lytics origin. The
registered site domain must match the page's `Origin` hostname.

## Reverse-proxy boundary

For an internet-reachable deployment, place Nginx Proxy Manager in front of
Lytics for TLS and route protection, with Authelia protecting dashboard routes.
Allow the public tracker asset and `/api/pageviews` ingestion endpoint to reach
Lytics without dashboard authentication so registered sites can report.

The trusted reverse proxy must overwrite, not append or preserve, the
`X-Real-IP` request header with the connecting visitor's address. Lytics uses
only that header for geolocation. Do not expose host port 3000 directly to the
public internet; restrict it with the host firewall or private networking so
only the intended reverse-proxy path can reach it.
