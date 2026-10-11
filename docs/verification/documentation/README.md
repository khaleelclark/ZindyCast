# Production documentation audit — October 11, 2026

The current guides now describe the deployed PWA and Android **0.1.4 / code 5**, including the four widgets, modeled-versus-observed readings, private HTTPS setup, signing/debug distinctions and actual web update behavior. This is a documentation review with bounded build/test checks; it does not certify every planned feature or physical device.

## Corrected documentation

- [Root README](../../../README.md): current Android release/widgets, separate mobile/deployment tests, complete data inventory, **Update** versus weather **Refresh**, and web/native delivery boundaries.
- [Documentation guide](../../README.md), [current status](../../status.md) and [verification index](../README.md): clear entry points and feature/evidence limits, replacing early wave tables as the current scope summary.
- [Operations](../../operations/README.md): actual active private deployment, launch-specific environment sources, service health and worker maintenance, complete stopped backups of five core databases plus retained/enabled tracker data, private configuration, staged restore, quota/revocation cautions, update/rollback and live-build publication behavior.
- [Deployment guide](../../../deploy/README.md) and [runtime example](../../../deploy/runtime.env.example): current procedure links and disabled optional-tracker placeholders aligned with the root example.
- [Android guide](../../../apps/mobile/README.md), [Android decision](../../decisions/android-app.md) and [security](../../../SECURITY.md): current architecture, widgets, signing, device data and backup recovery boundaries.
- Original [plan](../../implementation-plan.md), [research ledger](../../research/status.md) and [implementation journal](../implementation-status.md): explicitly historical, with current-guide links. Original operations content preserved in the [preparation archive](../../operations/preparation-2026-09-11.md). Research samples and measured results remain unchanged.

## Checks performed

On `/usr/bin/node` **22.22.1**, npm **9.2.0**:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| Mobile `typecheck` / `test` | Passed; **14/14** mobile tests |
| `node --import tsx --test deploy/*.test.ts` | Passed; **9/9** snapshot, configuration, crash-recovery and SQLite failure tests |
| Isolated web workspace production build with `--distPath` | Passed; existing MapLibre dependency-expression warning. Shipped Argonne notice matches its reference bytes |
| Root Docker image build | Passed; includes root web build and compression. Context contained tracked source plus current widget source, without private runtime files or generated native outputs |
| Disposable Docker runtime smoke | With `--network none`, normal `scripts/start.mjs` entry returned health **200 / ok** and web shell **200**. No published ports, production volumes or provider calls |
| Compose configuration | `docker compose --env-file .env.example config --quiet` passed |
| Both systemd templates | `systemd-analyze --user verify` passed with the service user's existing bus environment |
| Snapshot/configuration helper syntax | Both `node --check` commands passed |
| Service status (read-only) | Both existing ZindyCast units active/running, zero automatic restarts at observation |
| Markdown/local links, heading anchors, current shell syntax, Android manifests and environment keys | [Offline checker](check.mjs); exact counts/results in [results.json](results.json) |
| Whitespace | `git diff --check` passed |

The first Docker smoke imported `server.ts` directly, which starts the API without enabling web serving and returned shell 404. Repeating through the documented `scripts/start.mjs` entry, which sets `SERVE_WEB=1`, passed. The first systemd inspection lacked login-session bus variables; setting the existing user bus environment allowed the read-only check. Neither required a service/configuration change.

Run the offline documentation checker from the repository root:

```sh
node docs/verification/documentation/check.mjs
```

Add `--write` to refresh the retained JSON report. It parses all authored Markdown in root/docs/deploy/mobile/reference scope, resolves local links and heading anchors, checks current shell blocks with `bash -n`, and checks current Android release metadata/environment keys. It does not execute installation, backup, service or deployment commands and makes no network requests. The retained upstream LibreWXR README is excluded from local-link checking because it belongs to another repository. Historical screenshot links are reported separately: those images may exist only locally and are intentionally excluded from Git pending privacy review, as described in [shareable evidence](../shareable-evidence.md).

## Verification boundaries

No production deployment, process restart, database modification, subscription or notification send was performed. Docker smoke databases existed only inside its discarded container. Isolated web output and Docker source context were temporary. The docs describe complete backup/restore procedures, but this audit did not stop the private service or conduct a real production restore; retained deployment tests use temporary databases. The new disabled tracker settings affect only the example file.

Physical-phone widgets, WebView behavior, actual push delivery, reboot continuity, off-host disaster recovery and capacity checks remain listed in current status. Historical screenshots and third-party snapshots are evidence with their original scope; this pass does not repeat every historical browser/provider audit or validate every external source link. The pre-existing widget source/release files were already in the working tree when this documentation work started; app runtime code was not changed by this audit.

Operational references checked: [SQLite backup API](https://www.sqlite.org/backup.html), [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), and [Android widget update guidance](https://developer.android.com/develop/ui/views/appwidgets/advanced). Dependency/runtime requirements and UI labels were checked against the local manifests, service templates and source.
