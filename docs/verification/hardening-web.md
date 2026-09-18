# Web/map production hardening — September 11, 2026

Owned changes: `apps/web/src/interactive-map.tsx`, `maps.tsx`, `maps.test.ts`, `index.tsx`, `sw.test.ts`, `apps/web/public/sw.js`, and this record. Preserve existing MUI, heat, fill-height styles, and contracts. No dependency, API, service, root configuration or lead-owned `pwa.tsx` changes. No servers started. Production output goes only to `/tmp/zindycast-hardening-dist`; the lead must build the actual served release.

## Findings and fixes

- **Map source churn:** every pending/null/new overlay removed and recreated both `weather` and `footprint`. This exposes outstanding worker tasks to reused source IDs and is consistent with the reported `There is no tile manager with ID weather`. Sources now survive until `map.remove()`. Obsolete layers hide immediately on movement/loading; React owns cancellable image decoding, then `ImageSource.updateImage({image, coordinates})` updates the decoded image and matching geographic corners together. Footprints use `GeoJSONSource.setData`. MapLibre receives no asynchronous image URL load that can commit a previous frame after selection changes. Decode/renderer errors remain visible; a separate Restart map button handles renderer/startup failures.
- **Bounds:** revalidate after rounding to five decimals, rejecting zero-area requests introduced by quantization. Preserve Mercator response validation, nonwrapping longitude/latitude clamps, three-frame cache and 450ms viewport debounce.
- **Region return:** the original-region guard prevented fitting when switching back to the initial region. Track the previously applied region instead.
- **Current-view errors:** keep unsupported-view messages separate from renderer failures; clear only the bounds error after a valid view. Report a viewport after map load, including stationary initial cameras.
- **Material frame warnings and resize loop:** stale/partial/provider warnings moved outside Today’s collapsed source details. Browser testing then exposed a feedback loop: clearing these notices while loading resized the flexible Today map and requested another viewport. Retain clearly labeled last-frame notices through loading; obsolete imagery is still withheld by request key. Keep errors until recovery instead of removing/reinserting them on each movement. An idle Today browser check now asserts no extra frame requests across two consecutive two-second intervals.
- **Catalog refresh race:** revision changes could begin a frame request against the previous catalog before its clearing effect rendered. Gate frame loading on the completed catalog revision; wait for refreshed product/time metadata.
- **Accessibility:** explicit map select names; connect MUI tabs to the active panel, retaining a focusable main landmark for the skip link.
- **Lazy release assets:** the shell worker previously excluded `/static/js/async/` and `/static/css/async/`. Cache successfully requested, content-hashed lazy scripts/styles, with MIME/status checks and cross-release read fallback. Reject HTML/error responses and retain API/provider/map-tile exclusions. Cache version advanced to v3; no tile prefetch or offline weather added.

## Review of existing cleanup

Forecast and search use abort/version checks; city selection keys remount Maps/History/Alerts. Request helper removes its abort listener and body-inclusive timeout in `finally`. History export owns one retained URL, aborts on new load/offline/unmount, and revokes on replacement/unmount. Comparison export revokes on result replacement/unmount. Station/wildfire and comparison polling have generation/abort cleanup. No speculative changes to those flows were made.

Lead-owned `pwa.tsx` already preserves preferences before explicit activation, observes worker transitions, cleans event listeners, and bounds release checks to 15 seconds. Its in-flight release fetch is not aborted on unmount, though disposed guards prevent registration afterward and the timeout bounds it. This audit did not modify that component.

## Verification

Final commands: `npm run typecheck` passed; `npx tsx --test apps/web/src/*.test.ts` passed 56/56; `npm run build --workspace @zindycast/web -- --dist-path /tmp/zindycast-hardening-dist` passed. The existing MapLibre optional dynamic-import Critical dependency warning remains. The initial attempt to forward `--dist-path` through the root npm script failed argument parsing without building; direct workspace invocation above preserves the option correctly. Isolated output totals about 2392 kB / 668 kB gzip, including lazy map/worker assets.

Unit additions verify stable source identity across 20 image/footprint changes, hidden obsolete frames, rounded zero-area rejection, and lazy shell cache eligibility/error rejection. Existing body timeout, URL eviction, location/time/projection and service-worker install/release tests passed.

Real Chrome 152.0.7977.75, desktop 1280×1000 and mobile emulation 390×844: Today compact map and idle request stability; 12 previous/next changes; zoom; Hawaii then CONUS fit; corrupt PNG decode; 503 frame failure/retry; delayed old-city response after selecting Austin; offline map removal/reconnect; one map canvas; 390px document width; object-URL revocation after leaving Maps; no page errors or map rendering errors throughout ready checks. The settled screenshot was visually inspected: fixture weather raster and dashed footprint render over the city marker while the intentionally failed basemap has a visible independent warning. Early screenshots taken immediately after decode readiness preceded paint; the final audit waits for settling before capture.

The browser fixture harness was corrected during testing: native implicit label matching included select option text (explicit labels added), and a one-shot deferred request could be consumed by an aborted request (hold pending responses until city switch). These are retained distinctions from application failures. Browser fixtures are intercepted only inside a private Playwright context at `http://127.0.0.1:4311`, serving the isolated build from disk. External tile requests are answered with a synthetic 503; no external/provider request is sent. Recorded NOAA PNG/catalog and modeled forecast evidence are test inputs, not live weather. Reused fixture imagery cannot establish projection/geographic alignment.

## Remaining release gates

A stable-source regression test plus bounded Chrome exercise reduces the suspected race; it is not proof against every MapLibre/GPU/device failure. Real radar alignment, touch/physical devices, full accessibility and service-worker multi-tab release migration still require acceptance. Worker tests use a VM harness; the map browser test disables service workers deliberately to isolate application changes.

Visited lazy assets can survive a release; a chunk never previously requested cannot be recovered from browser cache. Deployment must retain prior hashed assets, or an old tab needs to update before its first lazy-map load. Cache pruning remains conservative while any windows are open. No claim that all release/cache growth/device gates are closed.

Final browser counters: 14 intercepted frame requests, 226 intercepted external basemap requests (all answered locally with 503), 12 object URLs created and all 12 revoked after leaving Maps; zero page errors. No provider calls escaped interception. Browser closed.

Artifacts: reproducible fixture browser script `ponderosa://artifact/import_798347c4d6db8ce926dcee80006397c7221e625ab1bad0e0`; visually inspected settled mobile screenshot `ponderosa://artifact/import_250cabd412ebd7e3b9f03a8c8d79e83038d88355a9ef6ceb`. Script expects the isolated build and existing research fixtures at the recorded workspace paths. Temporary artifact staging files were removed from app source. Test/build/run logs remain in `/tmp/zindycast-hardening-{tests,build,browser}.log` for this session.
