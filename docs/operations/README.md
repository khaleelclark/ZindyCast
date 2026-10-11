# Production operations

Reviewed October 11, 2026 against the current source and deployment templates. The existing private installation runs the API and worker as separate systemd user services. These instructions also cover a new installation; adapt paths and origin before use. The [September preparation record](preparation-2026-09-11.md) is archived evidence, with obsolete three-database examples.

## Runtime and configuration

Use Node **>=22.22.1 <23**, npm **9.2.0**, and locked dependencies installed with `npm ci --include=dev`. The server/worker run TypeScript with `tsx`, so omitting devDependencies breaks startup. `npm run build` builds and compresses the PWA; it does not compile a standalone backend. The systemd templates deliberately require `/usr/bin/node` **22.22.1 exactly**. Validate a replacement runtime before changing both templates' executable/check. Check `node --version` in the shell used for commands; an unrelated Node installation can take precedence on `PATH`.

Run API and worker from the same checkout with the same database paths and optional-feature configuration. Environment sources differ:

| Launch method | Configuration | Web serving |
| --- | --- | --- |
| Root `npm start` / `npm run start:worker` | Repository `.env`; existing process environment wins | `npm start` enables the built PWA |
| systemd user units | `~/.config/zindycast/runtime.env` only | Set `SERVE_WEB=1` as in the template |
| Docker Compose | Root `.env` supplies Compose interpolation | Image enables the built PWA; data at `/app/var` |
| Web build | `apps/web/.env.local` or build environment | Optional `PUBLIC_MAPBOX_ACCESS_TOKEN` is embedded in assets |
| Android build | `apps/mobile/.env` or build environment | Optional `EXPO_PUBLIC_API_BASE_URL` is embedded in the APK |

Use the [runtime environment template](../../deploy/runtime.env.example) for services and the [root example](../../.env.example) for Node/Compose. Never copy shell expansions such as `$HOME` into `EnvironmentFile` values. Relative database paths resolve against each process's working directory. Keep configuration mode 0600, directories mode 0700, and secrets/backups outside Git. Android releases prompt for a server origin rather than distributing a private hostname.

The private tracker needs the same `ZINDYCAST_WET_BULB_*` settings in both processes. Changing `.env` does not change the systemd environment. Optional Web Push needs all three matching VAPID values; the [configuration helper](../../deploy/README.md) generates keys locally without subscribing or sending. Existing partial keys need deliberate repair. Rotating keys can invalidate existing browser subscriptions.

## New systemd installation

Prepare dependencies, checks and web assets using the [root setup guide](../../README.md#local-setup-with-nodejs). Review the checkout path, node executable and both [service templates](../../deploy/README.md). Defaults are `%h/ZindyCast` and `/usr/bin/node`; set `WorkingDirectory` in both installed units or drop-ins if different. Use the service user's login session. Where a non-login session has no bus variables, use only that user's existing `/run/user/$(id -u)` directory and bus.

Before installing, check existing units, listeners and proxy mappings. Preserve existing runtime configuration on an upgrade. For a new installation only:

```sh
install -d -m 700 "$HOME/.config/zindycast" "$HOME/.config/systemd/user" var
install -m 600 deploy/runtime.env.example "$HOME/.config/zindycast/runtime.env"
```

Edit that private file: set the exact external HTTPS origin, database paths and enabled features. Then install the adapted templates:

```sh
systemd-analyze --user verify deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service
install -m 644 deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now zindycast-api.service zindycast-worker.service
```

User services need a user manager that remains available after logout/reboot. Inspect `loginctl show-user "$USER" -p Linger`; configure host policy deliberately if unattended operation requires it. Reboot continuity has not been established by the documentation audit.

## Private HTTPS and access

Bind the API to loopback (default port 4311). Set `ZINDYCAST_PUBLIC_ORIGIN` to the exact external HTTPS origin, including any non-default port and no trailing slash. The reverse proxy must preserve the external `Host` header. Host/origin validation is not a login gate: restrict private access through the network or an access-controlled proxy.

The existing installation uses Tailscale Serve on HTTPS port 21443. A **new** mapping, after checking that port is available and saving the current configuration privately, uses:

```sh
tailscale serve status --json
tailscale serve --bg --https=21443 http://127.0.0.1:4311
tailscale serve status --json
```

Verify all prior mappings are unchanged. Use the real operator-managed HTTPS origin on an authorized tailnet device. `weather.example.invalid` is an unroutable documentation placeholder. Local health alone does not prove DNS, certificates or phone connectivity. Preserve certificate validation; diagnose DNS separately rather than accepting invalid certificates. For scoped removal, `tailscale serve --https=21443 off` applies only while that port is still owned by ZindyCast. Follow the [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve); keep the existing private access model.

## Health, logs and recovery

```sh
curl --fail http://127.0.0.1:4311/api/v1/health
systemctl --user status zindycast-api.service zindycast-worker.service
systemctl --user show zindycast-api.service zindycast-worker.service --property=ActiveState,SubState,NRestarts,MemoryCurrent,MemoryMax,CPUQuotaPerSecUSec
journalctl --user -u zindycast-api.service -u zindycast-worker.service --since '-10 minutes' --no-pager
```

Also check HTML and health through the real HTTPS origin from an authorized client. Health is a process check; it does not prove every provider works. The worker has no HTTP health endpoint: verify it is active and has recent `maintenance` journal entries (normally every minute), then investigate `maintenance_failed` or repeated restarts. Review disk free space and database/WAL growth along with process memory. Template resource limits are not proof of capacity or a strict filesystem quota.

SIGTERM requests shutdown; systemd allows 45 seconds before killing the remaining control group. The templates restart failures after five seconds and limit restart bursts. Running jobs recover according to lease, expiry and attempt rules; provider work can repeat after a crash. Never reuse a job ID or clear coordination storage to bypass admission. Inspect generic diagnostics before restarting a crash loop. Request payloads, exact locations, bearer credentials, subscriptions and private provider URLs must stay out of logs and shared reports.

## Backup and restore

Inventory the actual configured paths first. Current defaults are:

| File | Contents / recovery significance |
| --- | --- |
| `coordination.sqlite` | Shared provider cache, quotas and refresh leases; quota history is not disposable |
| `jobs.sqlite` | Comparison jobs, results and admission fences |
| `installations.sqlite` | Credential hashes, ownership, registration and revocation |
| `notifications.sqlite` | Subscriptions, preferences and delivery reservations |
| `verification.sqlite` | Opted-in forecast verification data |
| `wet-bulb-tracker.sqlite` | Optional private tracker readings; include when enabled or when retained data exists |

Back up a complete application-consistent set with **both** processes stopped and no manual ZindyCast process writing those paths. The [snapshot utility](../../deploy/sqlite-snapshot.mjs) uses the [SQLite backup API](https://www.sqlite.org/backup.html), checks integrity/foreign keys, creates mode-0600 destinations and refuses overwrites or existing destination sidecars. It snapshots one database at a time; stopping writers establishes consistency across the set. Do not independently copy open main/WAL/SHM files.

Stop both services and explicitly confirm each is inactive:

```sh
systemctl --user stop zindycast-api.service zindycast-worker.service
systemctl --user is-active zindycast-api.service
systemctl --user is-active zindycast-worker.service
```

The two `is-active` commands should print `inactive` and return nonzero. If a stop failed or manual writers remain, resolve that before proceeding. From the repository root, for **default** data paths, take the following snapshots in a subshell; any failure leaves services stopped:

```sh
(
  set -eu
  umask 077
  zindycast_backup_dir="$HOME/.local/state/zindycast-backups/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$HOME/.local/state/zindycast-backups"
  mkdir -m 700 "$zindycast_backup_dir"
  for zindycast_database in coordination jobs installations notifications verification; do
    node deploy/sqlite-snapshot.mjs "var/$zindycast_database.sqlite" "$zindycast_backup_dir/$zindycast_database.sqlite"
  done
  if [ -f var/wet-bulb-tracker.sqlite ]; then
    node deploy/sqlite-snapshot.mjs var/wet-bulb-tracker.sqlite "$zindycast_backup_dir/wet-bulb-tracker.sqlite"
  fi
  cp "$HOME/.config/zindycast/runtime.env" "$zindycast_backup_dir/runtime.env"
  git rev-parse HEAD > "$zindycast_backup_dir/revision.txt"
  git status --short > "$zindycast_backup_dir/working-tree.txt"
  cp package-lock.json "$zindycast_backup_dir/package-lock.json"
  (cd "$zindycast_backup_dir" && sha256sum *.sqlite runtime.env revision.txt working-tree.txt package-lock.json > SHA256SUMS)
)
```

Adapt every source path if configuration differs, including a tracker outside `var/`; an enabled tracker must not silently be omitted. This service example copies the systemd configuration. A manually launched Node installation must instead retain its `.env`. Save compatible source/build artifacts and any local changes separately; a revision hash alone cannot recreate a dirty checkout. Preserve browser-public build configuration as needed. Android signing keys require their own protected backup outside the repository and outside ordinary server snapshots.

Confirm the expected files and hashes before restarting both services. Keep backups on an existing authorized separate medium; same-disk copies do not protect against disk loss. Choose and enforce a retention policy only after a new set has been verified. Scheduled/off-host backups are not configured by this guide.

For restore:

1. Stop both processes; preserve the entire old data directory and its sidecars privately as rollback evidence.
2. Verify backup hashes and code/config/schema compatibility. In a new private staging directory, run `node deploy/sqlite-snapshot.mjs BACKUP_FILE NEW_STAGED_FILE` for every database in the set. This rechecks integrity. Do not restore over live files or mix old sidecars with restored main files.
3. Reconcile newer revocations, cancellations, disabled subscriptions and completed jobs. An older backup can resurrect credentials/subscriptions or cause work to run again. Lost browser credentials have no account recovery; re-registration may be required.
4. Recover trustworthy post-backup provider usage, or keep provider-calling processes stopped for the longest configured quota window (currently **31 days**) until conservative recovery is resolved. Restored quotas omit usage after the backup. Deleting the coordination database is not recovery; do not bypass clock guards by resetting system time.
5. Promote the full staged set to the configured paths while stopped, preserving private permissions and ownership. Restore compatible protected configuration. Start API and worker together, verify local/HTTPS health, maintenance and a small functional check before reopening access.

Docker installations store these files in the `zindycast-data` volume, rather than the host checkout's `var/`. Stop both Compose services before a complete volume backup/restore, preserve protected Compose configuration, and use a consistent volume backup tool. Do not use the host-path snapshot example against unrelated host files. Preserve volume ownership for the image's `node` user. `docker compose down -v` deletes runtime data and is not an update or recovery step.

## Updates and rollback

For a backend or schema update, save the prior source/build/lockfile, stop both processes, take a verified complete backup, then install and check the reviewed revision. Do not update dependencies during service startup. Use Node 22 for:

```sh
npm ci --include=dev
npm run typecheck
npm run build
npm test
node --import tsx --test deploy/*.test.ts
npm run typecheck --workspace @zindycast/mobile
npm run test --workspace @zindycast/mobile
```

Restart the API and worker together and verify health, maintenance and private HTTPS. A rollback requires compatible source, dependencies, build, configuration and the complete database set, with the restore cautions above. An old web bundle alone cannot roll back a schema change.

The API serves `apps/web/dist` from disk. A build to that path on the live checkout publishes web assets immediately even without a service restart. During review, build into an isolated temporary directory (`npm run build --workspace @zindycast/web -- --distPath /path/to/isolated-output`), then publish only accepted assets. Root build also generates compression sidecars. Retain previous hashed/lazy assets for an appropriate client migration window; very old open tabs can otherwise need a reload to load an absent chunk.

Clients check for a new shell at startup, on focus and on reconnect. **Update available → Update** appears only for a waiting newer shell, saves preferences before applying, and reloads after activation. Fully reopen with the server reachable; an already-current client has no update banner. **Today → Refresh** updates weather, not the web shell. Do not clear device storage as a routine update: it removes installation preferences/credentials.

Android 0.1.4 renders the deployed PWA and also provides native widgets. Web changes arrive through web delivery; native shell/icon/widget changes require a signed APK with a higher version code and the persistent signing key. Use the [Android guide](../../apps/mobile/README.md) for architecture, signing, Metro/debug troubleshooting and widget installation. Android schedules widget updates and may defer them for battery/network reasons; read the valid-time label. Browser push subscriptions do not become native Android notifications.

## Acceptance and notices

Current delivered scope and remaining device, push, disaster-recovery and load checks are listed in [status](../status.md). Historical test reports do not certify today's external services. Preserve provider attribution and full third-party notices, including the [Argonne notice](../../packages/heat/reference/NOTICE.txt) shipped at `/notices/argonne-wbgt.txt` and the MUI X notice. The modeled WBGT reference does not establish personalized safe exposure limits. Public multi-user hosting needs a separate access, abuse, capacity and licensing review.
