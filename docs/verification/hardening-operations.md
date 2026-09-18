# Persistence and operations hardening — September 11, 2026

Bounded P5/F1/H3 audit and changes in jobs/installations, worker, and deploy only. Read the implementation plan, foundation, full supplied plan artifact, operations README and latest worker reconciliation evidence. No services, Tailscale, live provider calls, production database opens, runtime environment changes, installs or root/shared-contract/storage edits. Tests create private temporary databases and remove them. Existing operations/research evidence remains intact. Running preview services were neither inspected nor restarted in this task.

## Concrete fixes

- `packages/jobs/src/index.ts` and `packages/installations/src/index.ts`: preserve the original transaction error if SQLite already rolled back and the explicit ROLLBACK also fails. Previously a real SQLITE_FULL could become the misleading “cannot rollback - no transaction is active.” Transactions still attempt rollback; no automatic retry, error swallowing of the original failure, schema/config migration, or public interface change.
- `apps/worker/src/shutdown.ts`, `shutdown.test.ts`, `main.ts`: attempt every repository close after the worker loop ends, even when an earlier close fails. Log only a fixed `shutdown_failed` status/time and set exit code 1. Normal shutdown continues to abort pending work, retain running admission/lease, and let existing attempt/expiry rules govern recovery. A failed close is not reported as successful. This test verifies close sequencing with injected failures; it does not force native SQLite close errors in an actual service.
- `deploy/sqlite-snapshot.mjs`: refuse any existing destination `-wal`, `-shm`, or `-journal` before creating the new main file, including dangling symlinks through lstat. Existing sidecars are preserved. Failure cleanup includes newly created journal sidecars. Trusted private directories remain required: this is not an adversarial concurrent-filesystem API. Backup tests now use the terminal retry fence before releasing admission.
- Both `deploy/systemd/*.service` templates add exactly `LimitCORE=0`. This limits ordinary core-file output and reduces accidental memory disclosure; it is not proof that a host pipe-based coredump collector suppresses dumps. No installed units changed. Existing Node pin, private umask, restart delay/burst, 45-second stop deadline, control-group kill, resource limits and logging settings remain.

## Actual checks

On installed Node 22.22.1, SQLite emits its expected experimental warning.

```sh
node --import tsx --test packages/jobs/src/*.test.ts packages/installations/src/*.test.ts apps/worker/src/*.test.ts deploy/*.test.ts
npm run typecheck
node --check deploy/sqlite-snapshot.mjs
env XDG_RUNTIME_DIR="/run/user/$(id -u)" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" systemd-analyze --user verify deploy/systemd/zindycast-api.service deploy/systemd/zindycast-worker.service
```

Results: **37/37 tests passed**, typecheck passed, JavaScript syntax passed, unit verifier passed without diagnostics. Full focused suite took about 1.03 seconds. Tests under deploy are still outside root `npm test`; run the explicit command above. No root script changes were made.

Production build: `npm run build --workspace @zindycast/web -- --dist-path <fresh temporary directory>` passed. Python's TemporaryDirectory owned/removed the output, leaving served assets untouched. Rsbuild reported the expected external-output cleaning warning and existing MapLibre dynamic-dependency warning. A prior shell wrapper was rejected for its rm-style cleanup before execution; the successful wrapper used scoped temporary-directory cleanup. No approval or service action was needed.

### Abrupt process death and restore

`deploy/crash-recovery.test.ts` launches only its own `deploy/fixtures/crash-child.ts` process with temporary paths and an IPC channel. The child opens the same three repository types as the application, writes deterministic synthetic test data, leaves a real uncommitted write transaction open, and signals readiness. The parent sends SIGKILL to that exact child and verifies termination by SIGKILL before reopening. There is no cooperative close, HTTP server, real weather request or running app process kill.

Verified in original reopened databases and in second-generation restored files created via SQLite backup:

- Committed completed result survives WAL recovery; an uncommitted replacement result disappears.
- Valid installation still authenticates, revoked installation does not, ownership remains isolated, revoked job is inactive.
- Failed job's committed admission fence survives; same-ID retry fails. Cancelled job rejects the killed worker's late result.
- Replacement cannot acquire a live lease. At exact expiry it acquires attempt 2; old completion and renewal are rejected. A one-attempt abandoned job becomes failed with `lease_expired_attempts_exhausted`.
- Reconciliation releases only the three confirmed terminal mappings initially and the exhausted mapping afterward. The reserve-before-enqueue absent mapping and running work retain admission. Expiry cleanup removes all six jobs and seven mappings.
- Shared coordination cache survives and its already-exhausted synthetic provider quota remains denied after restore. No quota is reset or refunded.

The child transfers generated test credentials/leases through memory-only IPC. It writes no bearer/session-state file and its output is suppressed. Tests do not use the actual application's configuration or databases. Snapshot set is taken with no concurrent writes; this does not demonstrate cross-database consistency while applications are mutating them. No power-loss, filesystem-corruption, arbitrary kill timing, actual provider execution after restart, reboot, or supervisor restart claim.

### Actual SQLite exhaustion

`deploy/persistence-failure.test.ts` uses a 1 MiB per-connection max_page_count limit and a temporary test trigger attempting a 2 MiB zeroblob. Both real repository mutation paths produce SQLite error number 13 (SQLITE_FULL), with the original full-database message preserved. Both test tables and requested application rows remain empty after the failure. Removing the fixture trigger allows the same repository connection to write successfully; integrity_check returns ok. No filesystem was filled. This establishes page-allocation rollback/error recovery, not host ENOSPC, WAL append failure, hardware I/O error, or successful cleanup when absolutely no disk space remains.

### Backup safeguards

`deploy/backup.test.ts` retains existing open-WAL backup/restore coverage for results, ownership, authentication/revocation, lease recovery/fencing, expiry, raw-secret absence, 0600 destination permissions, missing source and no overwrite. A new case verifies each of the three existing sidecar types causes refusal before creation and remains byte-identical. Backup and restored copies pass the utility's SQLite integrity/foreign-key checks. Atomic multi-database publication, interrupted backup promotion, directory fsync, and disaster recovery from an older real snapshot are not demonstrated.

## Audit conclusions and remaining production gates

Cancellation/fencing is preserved: repository cancellation invalidates late publication; worker polling aborts pending fetch work and rechecks ownership before completion. An independent revocation can race the final ownership read, so API authorization must continue checking current credentials before releasing results. Running job recovery consumes attempts; provider work can repeat after a crash. No exactly-once execution guarantee. Terminal admission closure and release remain two commits with a conservative crash window; the existing durable fence/reconciler repairs retained capacity without allowing unsafe retry. Missing job rows remain ambiguous until expiry. Server-generated job IDs must never be reused. No new migration or payload format is introduced here; the earlier admission-fence rollout restriction still applies to older binaries that lack that fence.

Cleanup is bounded by row batches and SQLite busy timeouts, but database main-file max_page_count plus pre-admission disk checks are **not a strict total filesystem quota**. WAL can grow under pinned readers; lease/state updates also write WAL, and cleanup may fail under true ENOSPC. Checkpoint failure/busy status remains observable through existing maintenance results. Current page-limit test does not establish a durable total-WAL cap. A production resource gate still needs observed cgroup enforcement, pinned-reader/load behavior, memory/WAL high-water measurements, and a safe free-space recovery margin. No new arbitrary disk quota or retention setting was inserted into persistent config.

Lead-owned follow-ups found by static review:

1. `packages/storage/src/index.ts` transaction catch still unconditionally runs ROLLBACK, the same original-error masking pattern fixed here. Apply the analogous bounded fix and a coordination-repository SQLITE_FULL regression test. Storage ownership prohibited editing it in this task.
2. `apps/api/src/server.ts` invokes `void app.close()` in signal callbacks without handling rejection. Review API close-hook sequencing and report generic shutdown failure with nonzero exit status; avoid dumping secrets/error payloads. API ownership prohibited edits here.
3. Apply template changes only in an authorized, reviewed deployment step. Verify effective LimitCORE and host coredump policy; user service limits are not comprehensive filesystem isolation. Do not introduce ProtectSystem/ProtectHome/PrivateTmp assumptions without testing user-namespace support and exact repository/env/DB access.
4. Preserve the operations README's complete three-DB stopped-backup/restore procedure. Restoring an older auth snapshot can revive later-revoked credentials; restoring jobs can repeat completed work. The restored quota test proves retained pre-backup usage only. Recover newer trustworthy quota/revocation/cancellation history or keep provider-capable processes paused for the longest configured rolling quota window (currently 31 days) until conservative recovery is reviewed. Never discard coordination.sqlite to recover availability.
5. Actual graceful shutdown/restart, supervisor crash recovery, reboot, resource enforcement, private HTTPS/devices and family acceptance remain release checks. This task does not alter their existing status or claim that the deployed process has loaded these source changes.

See [operations procedure](../operations/README.md) and [worker race/reconciliation contract](worker/README.md). These documents describe the existing constraints; this new evidence narrows only the specific unverified cases tested above.
