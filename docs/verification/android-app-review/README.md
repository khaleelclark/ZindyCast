# Android integration review — 2026-09-28

**Result: backend integration is feasible; direct Android installation is not yet evidenced.** This is an independent planning/baseline review, not approval of the concurrently assigned mobile implementation. Initial source inspection found no `apps/mobile/`, Android build configuration, or APK. During final verification, the engineer’s concurrent `apps/mobile/` scaffold appeared (package/config/entrypoint/client/weather files); it has not been reviewed as a finished implementation. Its inspected build script runs `expo export --platform android`, which does not by itself provide the required signed APK. No live API/provider requests, external accounts, deployment, or release actions were performed. Current Android/Expo platform documentation was not fetched under the no-live-requests constraint; SDK-specific packaging choices must be verified against the selected installed toolchain.

## Prioritized actions

| Priority | Finding and repository evidence | Required action / owner |
|---|---|---|
| P0 | Root `package.json` builds only Rsbuild web assets. There is no standalone Android artifact in the inspected tree. Web build success and Expo development preview cannot establish APK readiness. | Mobile engineer: implement native app/config and reproducible standalone APK build. Lead: integrate compatible pinned dependencies/lockfile; verify produced signed APK and install evidence. |
| P0 | `apps/api/src/server.ts` defaults to `127.0.0.1:4311`; `boundary.ts:9–13` validates Host and any supplied Origin. Operations docs describe private Tailscale HTTPS and use a deliberately invalid placeholder hostname. | Lead/mobile: configure the actual authorized HTTPS origin including port. Phone must have authorized tailnet connectivity. Reject placeholder/loopback endpoints in the distributable configuration; distinguish disconnected tailnet from an empty weather result. Do not widen API host/origin policy. |
| P1 | `apps/web/src/request.ts` intentionally rejects absolute protected URLs; native networking needs an absolute URL. `comparisons.ts:11–29` accepts absent Origin but requires `X-ZindyCast-Request: 1` on registration/mutations; cross-site metadata and noncanonical origins fail. | Mobile: implement an origin-validated client; construct only approved `/api/v1/` routes. Preserve timeout through body decode, cancellation, errors and schema validation. Prove actual native header/redirect behavior in the chosen runtime. Do not invent `Origin: null`, an `exp://` origin, or weaken server checks. |
| P1 | `contracts/src/notifications.ts` expects browser PushSubscription endpoint and encryption keys. API notification routes expose VAPID configuration, and web UI uses service workers. | Explicitly defer native background push for the first APK, or separately implement authenticated native-token registration and delivery. An Expo/FCM native token cannot substitute for the existing subscription object. Keep foreground official alerts usable. |
| P1 | The plan requires location identity, SI contracts, UTC instants, stale/missing states and independent failures. Web request/selection code already prevents old-city responses; web formatting and current-observation selection are separate from transport. | Mobile: validate response location and runtime schemas, cancel/ignore obsolete requests, retain source/time labels, and port behavior with focused tests. Do not copy DOM/MUI/service-worker components into React Native. |
| P1 | Original acceptance matrix targets PWAs, not native binaries. No physical Android native evidence exists in this review. | Lead: record native acceptance separately on Pixel 9, Galaxy S23 Ultra and Galaxy S23; actual OS versions are unknown. At minimum obtain a physical-phone installation/launch result before claiming direct installation works. |

## First APK flow acceptance

These are proposed minimum native acceptance criteria derived from F2–F5/M4 and the existing web flow, not permission to remove other roadmap scope.

1. **First launch and endpoint:** launch independently of Metro/Expo Go; show actionable missing/invalid endpoint state. Reach authorized private HTTPS API with Tailscale connected; show retry/help when disconnected or TLS/DNS fails. Never bypass certificate validation.
2. **Choose place:** city search (2–100 characters), distinguish county/state/country, select and persist full coordinates, ID and IANA timezone. Optional foreground location request must have manual-search fallback for denial, timeout and resolver failure. Do not infer a city's timezone from the phone or request background location.
3. **Today and forecast:** current/model distinction, feels-like, hourly detail (48 hours), daily 7/10/14 horizons over the same series, precipitation/wind and available detail. US defaults; metric conversion; null is unavailable, never zero. Label any first-APK reduction explicitly. If station observations are omitted, label modeled current honestly.
4. **Heat:** distinguish ordinary wet bulb from estimated outdoor WBGT and preserve available calculation validity/source metadata. Do not invent categorical safety cutoffs, individualized safe exposure times, or enable categorical heat notifications to fill a native UI gap.
5. **Official alerts:** independent request and error state, source/validity times, readable official description/instructions. An alert-provider failure is not “no alerts.” Stale cached alerts must not appear current.
6. **Persistence and recovery:** selected/saved cities, units and activity survive force-stop/relaunch and an in-place update. Native storage is independent of browser localStorage. Corrupt/unavailable storage should produce a usable default with clear persistence failure. Activity selection must not silently change notification settings.
7. **Refresh and failure:** loading/empty/error/retry, bounded refresh on foreground resume, no parallel refresh storms, old-city response suppression, correct local day/DST rollover. Failed refresh may retain visibly stale data; app resume must re-evaluate age. No fixture values as live weather.
8. **Phone interaction:** safe areas, scrolling, Android back, touch targets, large fonts and screen-reader labels. An unavailable optional Maps/History/Compare feature must be clearly deferred; a browser link should be identified as opening the existing web experience.

## Endpoint and contract map

All paths below are relative to the configured origin. Initial read-only weather does **not** require installation registration or a login; current protection is the private network/host boundary. Installation credentials protect owned features, not all weather reads.

| Flow | API / contract | Native integration detail |
|---|---|---|
| Connectivity | `GET /api/v1/health` | Process health is not proof of provider health. |
| Search | `GET /api/v1/locations?q=` / `SearchResponseSchema` | Encode query, cancel obsolete searches; persist complete `LocationSchema`. |
| Device location | `GET /api/v1/location?latitude=&longitude=` / `ResolvedLocationResponseSchema` | Returns location/timezone; server can return `not_configured`. |
| Forecast | `GET /api/v1/forecast` / `ForecastResponseSchema` | Required latitude, longitude, name, timezone; preserve id/country/admin1/admin2. Optional `refresh=1`. Success contains `freshness` and `data`, not a bare hourly array. |
| Official alerts | `GET /api/v1/alerts?latitude=&longitude=` / `AlertsResponseSchema` | Validate returned coordinates; preserve independent freshness/error state. |
| Station observations | `GET /api/v1/observations?latitude=&longitude=` | Optional `refresh=1`; contract lives in `packages/contracts/src/observations.ts`. Existing `use-observations.ts` / `observed-current.ts` implement selection semantics. |
| Owned jobs | `POST /api/v1/installations`, then `/api/v1/comparisons` and `/:id`, `/:id/cancel` | Registration returns credential with one-year expiry; registration limit is 10/hour per API process. Poll/cancel only own jobs; request header plus bearer where required. Register lazily, not on every launch/retry. |
| Optional maps/history | `GET /api/v1/maps`, `/maps/frame`; `/api/v1/history` | Maps retain observed/forecast distinctions, frame time and attribution; history preserves dates, missingness and CSV metadata. Native maps/export are separate UI work. |

`packages/contracts/package.json` exports TypeScript source. Prove Metro resolves/transpiles workspace contracts and the selected Zod version; TypeScript success alone does not test native bundling. Root `tsconfig.json` currently includes DOM and all apps, so a native-specific type check must not accidentally rely on browser globals. Provider/storage/API packages remain server-only.

Forecast units are encoded in field names: °C, m/s, mm, hPa, meters; do not apply conversions twice. Hourly precipitation/probability represent the preceding hour; local-day totals must respect interval boundaries (see `apps/web/src/weather.ts:28–46`). Preserve source issue time separately from retrieval time. Do not calculate hourly WBGT using unrelated current/station inputs.

## Security and configuration requirements

- Bundle only public application configuration. APK/Expo public environment values are not secret storage; never include provider keys, VAPID private keys, signing credentials or server environment files.
- If owned features are implemented, retain installation bearer in native protected credential storage, bind it to the configured origin, and clear/separate credentials on endpoint change. Never put credentials in URLs, logs, shared exports, WebViews or arbitrary external links. Validate redirect handling before authenticated native calls; the web helper's `redirect: 'error'` is not evidence for native behavior.
- Handle expired/revoked credentials explicitly without registration loops; do not submit automatic duplicate jobs after an ambiguous timeout. Existing job POSTs do not establish client idempotency.
- Use trusted HTTPS in distribution. Keep local debug networking separate, and do not ship broad cleartext permissions, TLS bypasses or general-purpose WebView bridges as a connectivity workaround.
- Request only permissions needed by shipped flows. Network access and optional foreground location must work in the generated Android manifest; microphone/camera/background-location permissions have no reviewed requirement. Preserve source/provider notices in a reachable native About/Notices flow when applicable; bundled dependencies require their notices too.

## Build, signing, distribution and phone gates

No build/release action is authorized by this review. Before describing a handoff as installable, supply:

- A pinned, compatible Expo/React Native/React/native-module set and one documented reproducible command, including required JDK/Android SDK/build tools. Choose local build unless an already-authorized hosted-build workflow exists; do not create an EAS account or enable paid service implicitly.
- Stable Android application ID, version name and monotonically increasing version code; reviewed min/target SDK and CPU architecture coverage for target phones. Verify generated native manifest permissions and release configuration.
- A **signed standalone APK** with the JavaScript bundle/assets included, not only an AAB, QR code, Expo Go project or development client dependent on Metro. Confirm signing with Android tooling; keep the signing key and passwords outside repository and preserve the key for updates.
- Artifact path, size, SHA-256 checksum, package/version and signing-certificate verification evidence. Deliver through an authorized file channel; do not publish externally as part of development.
- User installation instructions: download/copy APK, allow installation for the chosen installer if Android requests it, install and launch. ADB installation is an optional controlled test path, not a prerequisite for family use. Record precise installation errors rather than assuming success.
- Physical-phone fresh install and force-stop/cold-start with Metro stopped; tailnet on/off, manual location and denied location, saved settings, source/error labels, and a second same-key/version-increased APK installed over the first preserving settings. Different package IDs or signing keys do not prove the update path. Emulator results must be identified separately.

## Verification performed

Read `AGENTS.md`, the implementation plan, foundation decisions, relevant API/contracts/web code and operations instructions. Only this review directory is authored by the reviewer.

| Local check | Result |
|---|---|
| `npm run typecheck` | Passed (exit 0), existing repository baseline before the concurrent mobile scaffold appeared; not a check of the final native implementation. |
| `npm run build` | Passed (exit 0); web bundle/compression only. MapLibre emitted a dynamic dependency warning. This command regenerates ignored web build output; no web source was edited. |
| `node --import tsx --test apps/api/src/boundary.test.ts apps/api/src/security.test.ts apps/api/src/notification-routes.test.ts apps/web/src/request.test.ts` | Passed, 16/16; in-process/fixture tests, no live provider calls. |
| `rg --files -g '*.apk' -g '*gradle*' -g 'eas.json' -g 'app.json' -g 'app.config.*' -g 'AGENTS.md'` | Only root AGENTS.md found at baseline inspection. |
| Native build, APK signature, native transport, physical device, installation/update | Not performed; no APK available in inspected baseline. |

Changed file: `docs/verification/android-app-review/README.md`. Lead must reconcile this snapshot with the mobile engineer's subsequent implementation before treating any finding as resolved.
