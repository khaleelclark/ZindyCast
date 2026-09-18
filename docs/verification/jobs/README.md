# H3 persistent job foundation

Verified September 11, 2026 on installed Node 22.22.1. Owned implementation: [repository](../../../packages/jobs/src/index.ts) and [tests](../../../packages/jobs/src/jobs.test.ts). No actual history retrieval, aggregation, worker loop, routes, notifications or installation credentials are implemented here. Heat, maps, quota/cache storage, contracts and root configuration were not edited. Lead creates the package manifest.

## API

`new JobRepository({path, clock?, busyTimeoutMs?, maxJobs?, maxJsonBytes?, maxTotalJsonBytes?, maxDiskBytes?})` opens a server-only, synchronous, local SQLite database. Use a dedicated persistent jobs file, separate from disposable quota/cache storage, and identical limits on all connections. The schema/configuration version is persisted; mismatches fail closed. Close connections with `close()`.

| Method | Result and semantics |
|---|---|
| `enqueue({id?,kind,payload,expiresAt,maxAttempts,availableAt?})` | New queued `Job`. UUID if ID omitted. Duplicate ID throws without replacing. Caller-supplied IDs can detect ambiguous enqueue success after a lost response; this is not automatic idempotent payload matching. |
| `get(id)` | Job snapshot or null at/after expiration. Includes payload, result, state, attempt, progress, failure code, lease and timestamps. Do not expose the worker lease/token in REST responses. |
| `acquire(owner,ttlMs,kind)` | Oldest eligible job of the explicit kind or null. Queued jobs wait for availability; expired running leases can be recovered. Returns running job with new token, incremented attempt, progress zero and error cleared. |
| `progress(lease,fraction)` | Boolean; only finite [0,1] progress at least the persisted fraction succeeds under the current live lease. Progress 1 alone does not complete a job. |
| `renew(lease,ttlMs)` | Renewed lease or null; never shortens existing expiry, never revives an expired lease, and cannot extend the job lifetime. Token remains stable. |
| `complete(lease,result)` | Boolean; atomically stores bounded JSON, sets completed/progress 1, clears lease. Capacity errors throw without transitioning. Null can be a valid completed result; inspect state. |
| `fail(lease,errorCode)` | Boolean; terminal for this attempt, stores bounded identifier-style error code and clears lease. No implicit provider retry. |
| `retry(id,delayMs=0)` | Boolean; only failed, unexpired jobs with attempts remaining can become queued. Previous error/progress remain until actual acquisition starts the next attempt. |
| `cancel(id)` | Boolean; queued/running only. Clears lease and fences all late writes. Caller separately aborts provider work. Already cancelled returns false. |
| `usage()` / `diskUsage()` | Physical row/JSON usage and separate DB/WAL/SHM byte sizes. Expired rows count until cleanup. |
| `cleanup(batchSize=100)` | Deletes at most batchSize expired jobs of any state, including running. Attempts WAL truncation; returns deleted count/checkpointBusy. |

All times are integer UTC Unix milliseconds. Availability defaults to enqueue time; expiry is fixed, after availability and at most 30 days from enqueue. At exact job expiry, reads return null and worker mutations fail. Expiration is retention/execution admission, not a sixth job state: rows keep their prior state until cleanup removes them. API should distinguish expired/not-found only if it maintains separately authorized metadata; repository does not preserve tombstones. IDs can be reused after physical deletion; old worker tokens still cannot commit against a new job.

Attempts are explicit integers 1–10 chosen at enqueue. Every acquisition, including crash recovery, consumes one. Expired final-attempt running jobs become failed with `lease_expired_attempts_exhausted` when `acquire` is next called for that kind; `get` does not mutate or perform recovery. Until then, running plus expired lease means abandoned work awaiting recovery. Retry never resets the attempt budget. There is no durable intermediate checkpoint/result: recovery starts the task again. Workers can reuse independently validated cached history chunks but must reconstruct the result consistently.

Lease authority is the persisted job ID/owner/token/attempt plus unexpired database deadline and running state. Caller `expiresAt` is informational, so a previously returned lease object remains usable after renewal of the same token. A takeover creates a different token. Completion, failure, progress and renewal all reject old/expired tokens, including exact equality at expiry. Jobs should contain immutable comparison definitions with common period, dataset/method versions and location/time context; this generic repository validates JSON structure, not scientific schemas.

## Coordination and limits

Mutations use `BEGIN IMMEDIATE` with no network work inside transactions, WAL, FULL synchronous durability, default 1000ms busy timeout (configurable 0–5000), 256-page auto-checkpoint and 1MiB retained journal target. Acquisition's final-attempt sweep is bounded by the configured total job cap (default 1000, maximum 10,000); cleanup deletion is 1–1000 rows. No process-local lease assumptions. Wall-clock rollback relative to persisted mutation time fails closed on reads/mutations until the clock catches up. A forward jump can expire jobs and leases; operators must maintain host time.

Default limits: 1000 jobs, 2MiB each payload/result JSON, 32MiB total payload+result bytes. All states count and completed jobs remain until their original expiry. Capacity refuses enqueue/result storage rather than evicting valid jobs. JSON accepts plain finite values only, at most depth 32/100,000 nodes, rejecting sparse arrays, accessors, Dates, cycles, undefined and nonfinite numbers. IDs/kind/owner/errorCode use 1–128 ASCII letters/digits/underscore/period/colon/hyphen, with alphanumeric first character. Failure details should stay out of errorCode; no arbitrary stack traces or secrets.

Disk admission at enqueue/complete defaults to 128MiB actual DB+WAL+SHM; a SQLite page-count cap also limits the main database. This is not an absolute filesystem quota: one transaction can overshoot admission, pinned readers can grow WAL through progress/lease updates, and deleted main-file pages remain allocated. `cleanup` attempts checkpoint/truncation and reports busy; no automatic VACUUM, periodic scheduler, backup, restore, abrupt-power-loss or disk-full recovery is supplied. Operators/integration must monitor physical usage and arrange periodic cleanup and safe maintenance. FULL synchronous plus SQLite transactions does not by itself prove recovery against every filesystem/device failure.

No authorization layer is claimed. Keep this file private to the application; REST must authenticate installation ownership before returning/cancelling/retrying jobs and omit lease secrets. Job IDs are not credentials. The repository does not enforce per-installation quotas or fair scheduling. Separate jobs/cache databases have no cross-database atomic transaction: worker fetches must reserve shared provider quota independently, be idempotent on retries, and handle ambiguous crash windows. Exactly-once work/provider calls are not guaranteed. Disk capacity errors, busy errors, config mismatch and malformed arguments throw; false/null denotes state/lease ineligibility. Worker code must catch errors without unbudgeted fallbacks.

## Verification

Commands from root:

```sh
node --import tsx --test packages/jobs/src/jobs.test.ts
npm run typecheck
npm run build
```

Nine tests passed; [TAP evidence](tests.tap). Two independent connections verify exclusive acquisition, exact expiry recovery, stale completion/failure/progress/renewal fencing, monotonic progress, no-shortening renewal, bounded explicit retry/delay, orderly close/reopen persistence, final-attempt exhaustion, cancellation, fixed lifetime, bounded cleanup/WAL truncation, count/individual+aggregate JSON limits, duplicate ID protection, malformed input, config mismatch, clock rollback, kind filtering and held writer lock contention. These are independent SQLite connections with deterministic clock and temporary files, not simultaneous multi-process or abrupt-crash tests. Typecheck and production build pass; Node emits its expected experimental SQLite warning. No live provider calls, installs or services were used.

Official reference checked: [Node SQLite API](https://nodejs.org/api/sqlite.html) documents synchronous DatabaseSync APIs and the busy timeout option added in Node 22.16.0. The exact-version URL `https://nodejs.org/docs/v22.22.1/api/sqlite.html` could not be opened by the browser tool during this turn; current official documentation's version history and installed Node22.22.1 behavior were checked, without claiming the newer API surface is available in Node22. Existing storage audit contains prior version-specific checks. Research [comparison requirements](../../research/station-history.md) and foundation/implementation plan were read; scientific eligibility remains outside this repository.

Remaining H3 acceptance: installation-owned REST contracts, rate/admission policies, actual bounded worker loop and shutdown, comparison schema/aggregation, quota/cache integration, cancellation signal propagation, backup/crash recovery verification and user-facing progress/results. This handoff verifies the bounded repository only.
