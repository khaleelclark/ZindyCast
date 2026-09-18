# Foundation — September 10, 2026

The user explicitly authorized DEVELOP. Research source documents retain their historical status; implementation is now authorized. Purchases, accounts, external contacts and public exposure are not authorized.

Use npm workspaces and the installed Node 22.22.1/npm 9.2.0. Dependencies are exact-pinned from registry metadata and locked in package-lock.json. Initial compatibility is established by installation, TypeScript checking, production web build and focused tests, not registry existence alone.

Lead owns root configuration, contracts, route registration, storage and integration. Web owns apps/web/src and public. Providers owns packages/providers/src. Heat owns packages/heat/src and reference validation evidence. No overlapping edits; request contract/dependency changes through lead.

First contracts use SI units, UTC ISO instants, requested location identity, source coordinates, nullable measurements, provenance and explicit error/freshness states. GET /api/v1/locations?q= searches; GET /api/v1/forecast?latitude=&longitude=&name=&timezone= returns ForecastResponse. Optional admin1/admin2/country/id preserve location identity. Forecast remains one hourly series for all horizons. Contract types are derived from Zod. Browser must validate responses and cancel/ignore old-location results.

Provider exported interface: searchLocations(query: string, signal?: AbortSignal): Promise<Location[]>; getForecast(location: Location, signal?: AbortSignal): Promise<Forecast>. No browser imports from providers. Server implements error mapping/cache. Providers must validate upstream responses and use bounded timeouts.

Heat categories remain unavailable. Numerical code can now be validated, but cannot be labeled valid until independent reference checks pass. No automatic categorical notifications. First worker skeleton sends nothing.

The workspace was verified as local to the intended deployment host, so no SSH was needed for local work. Existing listeners and available resources were inspected before choosing the application ports. Host identity, absolute checkout path and resource inventory are omitted from this shareable record. Do not change unrelated services. Private HTTPS setup remained a later integration step at this revision.

References: https://rsbuild.dev/guide/basic/typescript ; https://rsbuild.dev/config/server/proxy ; https://fastify.dev/docs/latest/Reference/TypeScript/

## MUI revision — September 11, 2026

User explicitly requested MUI, a richer colorful dashboard with a Today map, and NWS Tulsa WBGT context. Installed exact @mui/material 9.4.0, @emotion/react 11.14.0, @emotion/styled 11.14.1 in the web workspace; React 19 peer compatibility verified via npm metadata and official https://mui.com/material-ui/getting-started/installation/ . Existing React/Rsbuild/REST retained. Supplied screenshot shows the old static-map shell with its update banner; release migration is being tested, not assumed successful from a fresh browser. Heat scales must distinguish ordinary wet bulb from WBGT and preserve the scientific-policy gates.

## MUI X Charts — September 11, 2026

User requested replacing the custom graphs with MUI X. Installed exact @mui/x-charts 9.13.0 Community (MIT); registry peers accept React19 and Material UI9. Official setup: https://mui.com/x/react-charts/quickstart/ . No Pro/Premium package, purchase or account. Root npm install required --include=dev because the environment otherwise omitted development tooling; restored tooling and typecheck passes. License distributed at /notices/mui-x-charts.txt. Chart integration/browser verification follows in the bounded chart task.
