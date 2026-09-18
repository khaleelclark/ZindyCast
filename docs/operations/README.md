# Deployment preparation — September 11, 2026

Prepared only; no units installed, service started/stopped, Serve configuration changed, accounts created or production databases opened. Ownership: `deploy/` and `docs/operations/`. Full plan, foundation and supplied plan artifact read. This workspace is already on the deployment host; the plan's SSH skill/connection check applies before remote work. No SSH was needed or attempted.

## Inspected host

The original inspection confirmed a running user manager, no existing `zindycast*` user units, and sufficient free resources. Host identity, UID, resource inventory and unrelated service ports are omitted from this shareable record. Tool versions at verification were Node22.22.1, systemd259.5 and Tailscale1.102.3; these are historical observations, not current requirements.

The chosen application ports were unused at inspection. Existing Serve mappings must all be preserved. A host DNS error (`setLinkDNS: context deadline exceeded`) remained unresolved; this preparation did not modify DNS. Full tailnet account/peer metadata was not retained. Recheck ports, resources and private HTTPS on the actual deployment host.

Private hostnames in this documentation use the non-routable placeholder `weather.example.invalid`. Obtain the real authorized hostname from the operator. If a non-login shell lacks its user session, derive `XDG_RUNTIME_DIR` from `/run/user/$(id -u)` and `DBUS_SESSION_BUS_ADDRESS` from that directory's `bus` socket; do not copy another user's runtime path.

## Concrete activation proposal (not executed)

Lead/user must authorize activation separately: installing/enabling these two user units, writing private runtime config, starting their provider-capable processes and adding exactly the 21443 Serve mapping. Development authorization alone does not activate services. Recheck port ownership, existing Serve mappings and unit absence immediately beforehand. Do not overwrite an existing runtime environment or unit without reviewing it.

From the service user’s login shell (or configure its own session environment as described above), in the project directory:

```sh
/usr/bin/node --version
npm run typecheck
npm run build
npm test
systemd-analyze --user verify deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service
ss -ltn
tailscale serve status --json
install -d -m 700 "$HOME/.config/zindycast" var
install -m 600 deploy/runtime.env.example "$HOME/.config/zindycast/runtime.env"
install -d -m 700 "$HOME/.config/systemd/user"
install -m 644 deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now zindycast-api.service zindycast-worker.service
curl --fail http://127.0.0.1:4311/api/v1/health
systemctl --user status zindycast-api.service zindycast-worker.service
```

Then the exact private HTTPS addition, conditional on port 21443 still unused:

```sh
tailscale serve --bg --https=21443 http://127.0.0.1:4311
tailscale serve status --json
```

Example private URL (replace with the operator-provided hostname): **https://weather.example.invalid:21443/**. This is Serve, accessible according to existing tailnet ACLs; it is not a per-family ACL change. If the CLI requires additional permission or HTTPS enablement, stop for that specific approval. Never use Funnel, `serve reset`, or replace the full Serve configuration. Save a private before/after status and confirm all prior mappings unchanged. Verify the URL on an authorized tailnet device and failure without tailnet connectivity; inspect install/update/navigation and API behavior. A successful local health response does not establish remote HTTPS or worker functionality.

Scoped rollback after activation authorization: `tailscale serve --https=21443 off`, then `systemctl --user disable --now zindycast-api.service zindycast-worker.service`. Only remove the 21443 mapping if still owned by this app. Keep runtime data. Do not stop or reset unrelated services.

## Runtime and shutdown

Both units use the same environment file and exact absolute persistent paths in [runtime template](../../deploy/runtime.env.example): coordination.sqlite, jobs.sqlite, installations.sqlite under project `var/`. Coordination contains quota history as well as cache; it must not be casually discarded. Dedicated jobs/installations DBs retain ownership/credentials. Browser preferences remain on individual devices and are not in server backups.

Services execute `/usr/bin/node --import tsx` directly from the locked workspace; production requires installed devDependencies because tsx executes TypeScript. `npm run build` builds the web assets; it does not compile the server. ExecStartPre requires exactly 22.22.1; system upgrades changing `/usr/bin/node` fail closed until reviewed/retested. SQLite remains experimental on this release; do not suppress its warning. No install/version change was made here.

Independent supervision, 5s restart delay and 5 starts/60s limit prevent unbounded crash loops. Each unit has MemoryHigh384MiB, MemoryMax512MiB, CPUQuota100%, TasksMax64, 4096 file descriptors and a private umask. These are proposed bounds, not load-tested sizing. User cgroup controller enforcement must be checked after activation with `systemctl --user show` and observed memory/CPU. NoNewPrivileges does not isolate processes from other data owned by the service user. Logs go to journal with rate limits; journal retention is host policy, not bounded by these templates.

SIGTERM requests application shutdown; 45s later systemd can kill remaining processes. Worker aborts provider work, closes databases and leaves a running lease recoverable without prematurely releasing admission. API closes Fastify and repositories. No actual service stop, forced crash, disk-full recovery or reboot was exercised. Worker health: active process plus recent minute maintenance journal entries; no independent worker HTTP endpoint exists. Inspect only `journalctl --user -u zindycast-api -u zindycast-worker`; current API request logger is disabled and worker emits generic errors/counts. Never add bearer/auth headers, payloads, precise-location query strings, secrets or upstream URLs with keys to logs. Verify redaction before enabling request diagnostics.

## Backup, restore, update

[Snapshot utility](../../deploy/sqlite-snapshot.mjs) uses SQLite backup API, read-only source, exclusive new destination, mode0600, integrity_check and foreign_key_check. It refuses overwrite and missing source. It does not stop services or promise a transaction across separate databases. Trusted private directories are required; it is an operator utility, not an API endpoint. Use an outer command timeout if a busy live source prevents completion; a killed command can leave an incomplete output, which must not be accepted as verified.

For an application-consistent set, schedule a maintenance window, stop **both** ZindyCast units and verify inactive/no remaining manual ZindyCast processes before backing up. They must stay stopped until all three snapshots complete. Do not copy open DB/WAL files independently. Example, after choosing a new private backup directory:

```sh
systemctl --user stop zindycast-api.service zindycast-worker.service
systemctl --user is-active zindycast-api.service zindycast-worker.service
install -d -m 700 "$HOME/.local/state/zindycast-backups/REVIEWED_BACKUP_NAME"
node deploy/sqlite-snapshot.mjs var/coordination.sqlite "$HOME/.local/state/zindycast-backups/REVIEWED_BACKUP_NAME/coordination.sqlite"
node deploy/sqlite-snapshot.mjs var/jobs.sqlite "$HOME/.local/state/zindycast-backups/REVIEWED_BACKUP_NAME/jobs.sqlite"
node deploy/sqlite-snapshot.mjs var/installations.sqlite "$HOME/.local/state/zindycast-backups/REVIEWED_BACKUP_NAME/installations.sqlite"
```

`is-active` returning nonzero is expected for stopped units; confirm both explicitly. Save exact application revision, lockfile, schema/config settings and UTC backup time with SHA256 hashes. Snapshot the complete set even though the quota/cache DB contains disposable responses: quota reservations are not disposable. Retain backups privately on an existing authorized medium; same-disk backup does not protect against disk loss. No paid/cloud storage is configured. Bound backup retention explicitly (proposed seven successful daily sets); delete only reviewed old ZindyCast sets after a new restore verification.

Restore with both units stopped: keep the entire old `var/` directory (including sidecars) as rollback evidence. Create a new private staging directory and run this same utility from each backup file into three new filenames there; never restore over live files or mix old WAL/SHM with restored main files. Verify hashes, integrity and exact config/revision compatibility. Promote the full staged directory to `var/` only while stopped. This rename/replacement is a reviewed maintenance action, not performed by the utility. Do not reset clocks; persisted clock guards reject rollback. Expired credentials/jobs stay expired, and running leases recover only within attempt/expiry rules. Reconcile terminal ownership/admission before restarting the worker.

Restoring an older installations DB can resurrect credentials revoked after backup; restoring jobs can reexecute work completed after backup. Recover revocation/cancellation history from trustworthy records or explicitly re-register affected installations before exposure. A backed-up quota ledger omits post-backup usage: absent a trustworthy newer ledger, keep provider-calling processes stopped for the longest configured quota window (currently rolling31days), or implement a reviewed conservative reservation migration. Deleting coordination.sqlite to bypass a quota denial is never recovery. Browser bearer secrets are not backed up; lost local storage has no account recovery.

For updates: retain previous code/build/lockfile and a verified stopped backup set; install/build/test the reviewed revision using the established package workflow; then restart the two units and verify health, worker maintenance and private HTTPS. Never run a dependency update as part of service startup. Schema/config rollback needs compatible code plus a reviewed full data set, not just an old web bundle.

## Notices and remaining release checks

Distribute full [Argonne NOTICE](../../packages/heat/reference/NOTICE.txt), [adaptation record](../../packages/heat/reference/README.md), and dependency/provider license/attribution materials with source/binary deployment and end-user documentation. Required acknowledgment: “This product includes software produced by UChicago Argonne, LLC under Contract No. DE-AC02-06CH11357 with the Department of Energy.” The acknowledgment alone does not replace the complete copyright, conditions and disclaimer. Lead must ensure a user-accessible full-notice page/file is shipped. Do not imply endorsement or release unapproved heat categories/notifications.

Evidence: [isolated backup TAP](backup-tests.tap). Real repository objects in temporary directories, open WAL connections, backup and second backup into restored databases verify ownership/authentication, revoked credentials, completed results, expired leases/recovery, stale writer rejection, expiry, secret absence and no-overwrite. This is not cross-database concurrent snapshot, abrupt-crash, revocation rollback reconciliation or production restore validation. Remaining P5 includes physical devices, resource enforcement/load, quota-safe disaster recovery, attribution distribution, DNS/HTTPS, authorized service activation and family usability.

Sources checked: [SQLite backup semantics](https://www.sqlite.org/backup.html), [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), installed `tailscale serve --help` and systemd verifier. Official Node22 SQLite and systemd web retrieval failed during this run; installed Node22.22.1 backup behavior and local unit syntax were verified directly. No remote host or provider request was needed for these checks.

## Preparation check results

`node --import tsx --test deploy/backup.test.ts`: 1/1 passed. `node --check deploy/sqlite-snapshot.mjs`: passed. `systemd-analyze --user verify deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service` with the service user’s session environment: passed without diagnostics. Initial verifier invocation without session environment failed to initialize manager; providing the existing bus resolved it without changing the host.

`npm run typecheck` and `npm run build`: failed during concurrent station integration because `@zindycast/contracts` did not export StationQuerySchema/StationResponseSchema/StationDataSchema and related station types. Failures affect apps/api/src/stations.ts, apps/web/src/stations.tsx and packages/stations. No out-of-scope changes made; lead must resolve and rerun before activation. Preparation checks do not claim an accepted application build.

## Competitive upgrade additions — September 14, 2026

The existing private installation adds `var/notifications.sqlite` and `var/verification.sqlite` (override with ZINDYCAST_NOTIFICATIONS_PATH / ZINDYCAST_VERIFICATION_PATH). Both API and worker open these repositories. Include all five databases in stopped, verified backup/restore sets; do not use the historical three-database example as a complete current set. Include private runtime configuration/VAPID keys in protected backups, never in repository artifacts or logs. Restoring subscription state can revive previously disabled preferences; reconcile removal/revocation history before sending.

`deploy/configure-notifications.mjs` generates paired P-256 VAPID keys locally and preserves an existing private configuration. It does not register devices or deliver messages. After deployment, unauthenticated GET `/api/v1/notifications` reports configuration availability without exposing subscriptions or private keys. A user must enable a category and allow browser permission before any subscription is stored. Real device delivery remains an acceptance task.

Verification collection requires explicit place/station opt-in. The worker checks installation liveness before scheduling, captures baseline no more often than six hours and two named candidates no more often than daily, and reserves the existing persistent provider quotas. No tracked places means no collection. New collection does not change the primary forecast or erase existing quota history. Initial scorecards are pending; corrections and calibrated uncertainty require later evidence.
