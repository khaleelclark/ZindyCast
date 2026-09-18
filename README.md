# ZindyCast — Weather beyond temperature

A self-hosted weather PWA built with React, TypeScript, Rsbuild and Fastify. It combines current conditions, forecasts, weather maps, historical browsing and city comparisons, with feels-like temperature and estimated outdoor WBGT alongside ordinary temperature.

## Quick start

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

For an update, stop the processes, back up data, install dependencies with `npm ci --include=dev`, run the checks and build, then restart the API and worker. Installed clients may need **Update and reload**. The offline shell does not make weather data current.

## Repository layout

- `apps/web`: React PWA
- `apps/api`: REST API
- `apps/worker`: persistent jobs and background processing
- `packages`: shared schemas, providers, calculations and storage
- `docs/research` and `docs/decisions`: sources and design decisions
- `docs/verification`: historical test evidence, not a promise that every provider remains available

## Providers and licensing

The application uses external weather and map providers, including Open-Meteo, NOAA/NWS and OpenStreetMap. Their attribution, usage limits and terms still apply to your deployment; this repository does not grant unlimited or commercial API access. Source-specific notices are retained in the app and research documentation.

Third-party licenses and the Argonne WBGT reference notice must remain intact. A license for the project's original code has not yet been selected; availability of the source alone does not grant an open-source license.
