# Private deployment templates

These are Linux systemd **user** units, not an installer. They default to a
checkout at `~/ZindyCast`, `/usr/bin/node` version 22.22.1, and one shared private
environment file at `~/.config/zindycast/runtime.env`. They do not load the
repository `.env`. Prepare dependencies and the web build using the root README
before starting services; the API serves `apps/web/dist` with `SERVE_WEB=1`.

Copy `runtime.env.example` to the private configuration location and restrict it
to mode 0600 (directory 0700). Copy both service templates into your user systemd
unit directory when ready to install. If the checkout is elsewhere, set
`WorkingDirectory` in **both** installed units or their drop-ins. `%h` is a
systemd home-directory specifier; shell `$HOME` and `~` are not substitutes in
unit directives. If Node is installed elsewhere, update both `ExecStartPre` and
`ExecStart` to its absolute executable path. The templates retain the verified
22.22.1 runtime check; changing that check requires validating the replacement.

The five SQLite path variables must resolve to the same files for API and worker.
Relative paths resolve against `WorkingDirectory`; for persistent data outside
the checkout, supply explicit absolute paths in the private environment file.
Do not put shell expansions in `EnvironmentFile` values. Preserve all five
databases when moving an existing installation. `sqlite-snapshot.mjs SOURCE
NEW_DESTINATION` makes a verified snapshot of one database; stop both application
processes before taking a consistent set across databases.

The API listens on loopback port 4311 by default. Configure your own private HTTPS
proxy separately, and set `ZINDYCAST_PUBLIC_ORIGIN` to its exact browser origin,
including any non-default port and no trailing slash. That origin is used for
request validation; setting it does not install a proxy or provide access control.
No personal hostname or tailnet configuration is bundled here.

Core weather providers need no API keys. Optional Mapbox configuration is a
browser-visible **build-time** value; see `apps/web/.env.example`. Server runtime
configuration must not be used to distribute private provider keys to the web.

Optional Web Push requires a matching `ZINDYCAST_VAPID_PUBLIC_KEY`,
`ZINDYCAST_VAPID_PRIVATE_KEY`, and `ZINDYCAST_VAPID_SUBJECT`. Leave all three unset
or empty to disable push. After setting your HTTPS origin, run:

```sh
node deploy/configure-notifications.mjs /path/to/private/runtime.env
```

The helper defaults to `~/.config/zindycast/runtime.env` if no path is passed.
It requires an existing file and explicit HTTPS origin, generates keys locally,
and leaves any nonempty VAPID configuration unchanged. Empty placeholder entries
are replaced. It creates a private backup alongside the file; keep that backup
private too. It neither subscribes devices nor sends notifications. Existing
partial key configuration must be repaired deliberately; the helper does not
rotate existing keys.

Installing templates, restarting services, and configuring remote access are
operator actions. Merely editing these repository examples changes no running
service.
