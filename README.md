# ZindyCast — Weather beyond temperature

A self-hosted weather PWA built with React, TypeScript, Rsbuild and Fastify. It combines current conditions, forecasts, weather maps, historical browsing and city comparisons, with feels-like temperature and estimated outdoor WBGT alongside ordinary temperature.

## Quick start with Docker

Install Docker Engine with the Compose plugin, then run:

```sh
cp .env.example .env
docker compose up --build -d
```

Open **http://localhost:4311**. Compose builds the web app, starts the API and worker, waits for the API health check, and stores all SQLite data in the `zindycast-data` volume. Follow startup logs with `docker compose logs -f`; stop the app with `docker compose down`.

Updates keep the data volume:

```sh
git pull
docker compose up --build -d
```

`docker compose down -v` permanently deletes ZindyCast's databases and should only be used when you intend to reset the installation. The published port listens on `127.0.0.1` by default. Set `ZINDYCAST_PUBLIC_ORIGIN` and use an HTTPS reverse proxy for access from other devices; see [Access from other devices](#access-from-other-devices).

## Local setup with Node.js

Install **Node.js 22.22.1 or newer within the Node 22 release line** and npm 9.2.0. Run these commands from the repository root:

```sh
npm ci --include=dev
cp .env.example .env
npm run build
npm start
```

Open **http://localhost:4311**. In a second terminal, from the same directory, start the background worker:

```sh
npm run start:worker
```

Both processes load `.env` automatically; existing environment variables take precedence. Defaults work locally without provider accounts. The worker is needed for comparison jobs and enabled background features. Stop each process with Ctrl+C. Runtime databases are created under `var/` and excluded from Git.

The initial build needs internet access for dependency installation; weather requests also require internet access. No sample weather is substituted when a provider is unavailable.

## Features

- Current conditions from eligible nearby US weather stations, with a clearly identified model fallback; station report time is distinct from the last refresh check.
- Hourly and 7/10/14-day forecasts, feels-like temperature, ordinary wet-bulb and estimated WBGT, with sourced activity guidance.
- Radar, satellite and weather layers with source attribution and independent availability.
- History, seasonal context and comparisons for two to five cities, with daily/hourly detail and CSV exports.
- Saved places, US/metric units and preferences stored independently per browser installation.
- Installable PWA, optional Web Push notifications and optional forecast verification.

Coverage and availability depend on the source and location. Forecasts and estimated heat metrics are not measurements at your exact address. WBGT and ordinary wet-bulb are different quantities. Guidance does not promise a universal safe exposure time.

## Configuration

See [.env.example](.env.example) for the server and worker settings. Keep real credentials in ignored local environment files or your service manager's protected environment. Never prefix a server secret with `PUBLIC_`.

| Setting | Default / purpose |
| --- | --- |
| `API_HOST`, `API_PORT` | `127.0.0.1`, `4311` |
| `ZINDYCAST_PUBLIC_ORIGIN` | Your exact HTTPS origin when accessed through a reverse proxy; no trailing slash |
| `ZINDYCAST_*_PATH` | Shared SQLite files under `var/`; API and worker must use the same paths |
| `ZINDYCAST_VAPID_PUBLIC_KEY`, `ZINDYCAST_VAPID_PRIVATE_KEY`, `ZINDYCAST_VAPID_SUBJECT` | Optional matching Web Push configuration; leave all unset to disable delivery |
| `ZINDYCAST_BIND_ADDRESS`, `ZINDYCAST_PORT` | Docker host binding; defaults to loopback port `4311` |
| `PUBLIC_MAPBOX_ACCESS_TOKEN` | Optional public Mapbox token embedded when Docker builds the web app |
| `ZINDYCAST_WET_BULB_TRACKER` and `ZINDYCAST_WET_BULB_*` | Optional private 30-minute modeled WBGT log; copy the placeholders from `.env.example` and set the location |

### Private wet-bulb tracker

Set `ZINDYCAST_WET_BULB_TRACKER=1` and the tracker location variables in the private `.env`, then run both the API and worker. Open `/wet-bulb-tracker` to see estimated outdoor WBGT with the NWS Tulsa reference band, ordinary wet bulb and its supporting weather values. The table retains 90 days and downloads the selected range as CSV. Collection begins at startup and runs every 30 minutes; it does not create historical values. Open-Meteo supplies hourly modeled fields, so two consecutive samples can share a source-valid hour.

An optional Mapbox public token can be placed in `apps/web/.env.local` using [its example](apps/web/.env.example), then rebuilt. Restrict browser tokens to your application origin. The default basemap does not require this token.

### Access from other devices

Use an HTTPS reverse proxy to the loopback API port, set `ZINDYCAST_PUBLIC_ORIGIN` to the exact browser-facing origin, and run the API and worker continuously. The proxy must preserve the browser-facing `Host` header. The app rejects unconfigured hosts and origins. HTTPS is required for remote PWA installation, geolocation and push; localhost is suitable for development.

[Deployment templates](deploy/) and [operations documentation](docs/operations/README.md) cover service supervision and recovery. Adapt templates to your installation. Keep the API bound to loopback unless your network design explicitly requires otherwise. The app has installation credentials but no user-login access gate; use a private network or access-controlled proxy for a private deployment. Public multi-user hosting needs a separate access, abuse, capacity and provider-licensing review.

## Development

```sh
npm run dev:api
npm run dev:web
npm run dev:worker
```

Run each in its own terminal. Open http://localhost:4310. The web development server proxies `/api` to port 4311; if you change the API port, also adjust the development proxy in `apps/web/rsbuild.config.ts`.

```sh
npm run typecheck
npm run build
npm test
```

Build before running the complete test suite because some tests inspect generated web assets. Browser and live-provider evidence under `docs/verification/` describes the checks actually performed; physical-device behavior is not guaranteed by browser emulation.

## Data, backups and updates

Back up the SQLite databases together while the API and worker are stopped, or use a consistent SQLite backup procedure. They contain installation credentials, preferences, job state and provider coordination. Do not commit or distribute `var/`. Clearing coordination storage also resets persisted provider budgets, so it is not a routine cache-clear operation.

For a Node.js update, stop the processes, back up data, install dependencies with `npm ci --include=dev`, run the checks and build, then restart the API and worker. For Docker, back up the `zindycast-data` volume and recreate the services with `docker compose up --build -d`. Installed clients may need **Update and reload**. The offline shell does not make weather data current.

## Repository layout

- `apps/web`: React PWA
- `apps/api`: REST API
- `apps/worker`: persistent jobs and background processing
- `packages`: shared schemas, providers, calculations and storage
- `docs/research` and `docs/decisions`: sources and design decisions
- `docs/verification`: historical test evidence, not a promise that every provider remains available

## Providers and licensing

The application uses external weather and map providers, including Open-Meteo, NOAA/NWS and OpenStreetMap. Their attribution, usage limits and terms still apply to your deployment; this repository does not grant unlimited or commercial API access. Source-specific notices are retained in the app and research documentation.

ZindyCast’s original code is licensed under the [MIT License](LICENSE). Third-party code, research material and datasets retain their own terms; third-party licenses and the Argonne WBGT reference notice must remain intact.
