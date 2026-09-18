# API cache and comparison hardening — September 11, 2026

Scope: `apps/api/src/comparisons.ts`, `cache.ts`, new `security.test.ts`, and this document. Local synthetic/in-memory tests only. No provider GETs, service changes, production database access, dependencies, shared contract/storage edits or delegation.

## Findings and fixes

- **Medium reliability: retained cache deadlines overrode current policy.** A persisted stale row was returned after provider failure or lease contention even with caller `stale=0`. A previously longer TTL could also return old data as fresh after policy tightening. Reads now cap expiry at both stored expiry and retrieval plus current TTL, and cap stale retention at both stored stale deadline and effective expiry plus current stale allowance. Invalid lifetimes fail before refresh. This prevents relaxed old policy surviving a deployment; routes should still version identities for semantic changes.
- **Medium reliability: coalesced results bypassed caller validation.** A same-key in-flight promise was cast to the next caller's schema without runtime checks. Waiting callers now reread through their own schema/refinements and policy, rejecting incompatible results without duplicate provider requests. Keys still must include provider/dataset/query/calculation identity; this cannot correct an incorrectly constructed key whose callers use indistinguishable schemas.
- **Low defense-in-depth: mutation origin parser accepted non-origin URLs.** Host-only URL parsing accepted paths, credentials and non-web schemes. The mutation guard now requires a canonical serialized HTTP(S) origin and rejects cross-site/same-site/unknown Fetch Metadata. Custom application header remains mandatory. Raw forwarded headers grant no authority. Missing Origin remains allowed for native/local clients with the custom header. Header presence is CSRF friction, not authentication; comparison reads/writes still require an independently authenticated bearer.
- **Low reliability: registration throttle lacked retry guidance.** Its existing ten registrations/hour/process bound now returns a bounded positive Retry-After. Simultaneous requests cannot exceed that process's allowance.

## Verified safeguards

Seven new adversarial tests cover rejected origins/forwarded spoofing; registration races; concurrent job admission (three accepted, four denied); another installation, public installation ID, cookies and malformed bearer failing both reads and cancellation; revocation; running-job cancellation fencing late completion; stale-zero/reduced-policy rejection on error and contention; coalesced exact-query schema rejection; malformed-cache quota denial/no fetch; oversized-cache rejection; expired lease takeover retaining the newer result and charging both actual refresh attempts.

Existing tests also retain allowed stale labels, quota-before-network, exact geographic cache identities, map projections, fresh-only station/wildfire responses, bounded geometry/bytes and route deadlines.

Checks:

- `npx tsx --test apps/api/src/security.test.ts`: **7/7 passed**.
- `npx tsx --test apps/api/src/*.test.ts packages/maps/src/route.test.ts packages/stations/src/route.test.ts packages/providers/src/wildfire.test.ts`: **39/39 passed** after completed build.
- `npm run typecheck`: passed after final test addition.
- `npm run build`: passed; existing MapLibre dynamic dependency warning remains.
- An initial broad test run overlapped web build output replacement and static `/` temporarily returned 404. Rerunning after build completed passed. Build and static-output tests must run sequentially; do not treat this transient failure as a deployed endpoint finding.

## Integration and remaining limits

The lead was notified that Host-derived origin equality alone cannot establish a trusted deployment origin or prevent DNS rebinding. Global allowed Host/canonical external origin validation belongs in app/server configuration. Full origin scheme matching requires the explicitly configured external HTTPS origin behind Tailscale termination; blindly trusting forwarded protocol is inappropriate. This file's guard deliberately does not infer that origin from proxy headers. Production remains private Tailscale, not public hosting.

Registration's hourly counter remains process-local and resets on restart; durable installation and mapping capacities still bound storage. Multi-process/restart-resistant registration throttling requires repository/configuration coordination. Job limits are repository-transactional (three active per installation, retained total/mapping/disk bounds); completed/cancelled work consumes retained history capacity until cleanup. Admission across installations/jobs databases remains conservative: ambiguous enqueue failures stay charged. No claim of a single atomic transaction across databases.

Cache leases and quota remain SQLite-backed and fenced; a lost refresh may use a validated newer cached result, never overwrite it or refund the consumed call. Individual adapters retain cancellation/time/byte limits. Cache coalescing itself cannot abort arbitrary uncooperative fetcher code, and synchronous parsing cannot be preempted. Current-policy clock checks use the same wall clock as cache writes; storage/custom-clock tests must align their clocks.

No live browser, physical-device, Tailscale reverse-proxy or production load acceptance is implied by these server tests.
