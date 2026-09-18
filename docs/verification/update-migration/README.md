# Installed-shell migration audit

September 11, 2026. Run `node tests/browser/update-migration-audit.mjs` after building the web app. Results and screenshot are in this directory.

Actual headless Google Chrome, disposable browser context and ephemeral loopback HTTP test server. The server snapshots actual `apps/web/dist` HTML and service-worker bytes and serves production static assets. A clearly marked synthetic legacy HTML/JS/service-worker release establishes the older cache-first installed-shell state; historical production bundles are not retained in Git, so this does not replay the user's exact old build. No persistent user preferences/service-worker registrations are touched. No live weather or basemap requests: local API fixtures reuse prior evidence with query-adjusted test metadata, external requests are blocked. Screenshot weather/basemap content is test context only and is not live evidence or alignment acceptance.

Verified:

- Online ordinary reload remains on the synthetic installed old HTML even with current HTML on the network. This is expected cache-first navigation behavior, not a network outage.
- With current worker waiting, the synthetic old update button activates it, the actual current React app loads, and metric units, strenuous activity and a saved city all remain identical in localStorage.
- Maps reaches the actual MapLibre canvas and `/vendor/maplibre-6.9.0/maplibre-gl-worker.mjs`, and a fixture Mercator overlay reaches `data-weather-ready=true`.
- Actual current PwaStatus detects changed network HTML on focus. A harmless added marker script simulates a new release identity; existing map remains intact until Update and reload is clicked. The actual current button/controllerchange flow loads the new identity and preserves preferences.
- Installed current HTML reloads offline with those preferences. Cache Storage has no API entries.

Conditional migration risk: synthetic legacy JS registers only its own `/static/js/mock-old.js` build identity. After the server switches to current strict-signature sw.js, `registration.update()` does not create a waiting worker because the requested signature differs from network HTML. Explicitly registering the discovered current signature enables migration. This does **not** establish that the user's exact old JS has this behavior. Lead should compare a retained affected bundle if available; an old page without network release discovery may need a cache-bypassing navigation (query-bearing root URL) to bootstrap the corrected PWA without deleting localStorage. Do not instruct users to clear all site data.

Read-only localhost static-header inspection before testing: `/` and `/sw.js` HTTP200, `Cache-Control: no-cache`, correct HTML/JavaScript Content-Type; both Last-Modified September 11 01:31:52 GMT. Thus ordinary HTTP freshness headers do not themselves bypass active service-worker cached HTML. Physical iOS/Android installation, private HTTPS reachability, exact screenshot build and real map visual accuracy remain separate acceptance gates.

No web/API/shared/services changes, installs, production database access, real preference clearing, or live provider calls were made. Owned deliverables only: new browser test and this verification directory.

Additional browser recovery verification: a second independent synthetic legacy profile navigated to `/?update-recovery=1`, loaded actual current React PwaStatus, clicked its actual Update and reload button, and subsequently loaded the current app at bare `/`. Preferences remained identical. This validates a non-destructive recovery path for workers with the tested query-exclusion behavior; exact old worker compatibility still requires retained-build or affected-device confirmation.

Final checks: browser audit passed after a fresh production build; `npm run typecheck` passed; `npm run build` passed (existing MapLibre dynamic-dependency warning). The test script is a direct Playwright lifecycle audit, not a node:test unit suite. Browser version and all assertions/request paths are retained in results.json. Zero new live provider GETs.
