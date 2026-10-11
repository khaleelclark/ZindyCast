# Security and private configuration

Reviewed October 11, 2026. See the [operations guide](docs/operations/README.md) for protected backups and quota/revocation-safe recovery.

Keep `.env`, `apps/web/.env.local`, runtime databases, backups, private keys and service environment files out of Git. Example environment files must contain placeholders only. Browser `PUBLIC_` values are distributed to every visitor and must never contain private credentials.

The API validates its configured host and origin. This is not a user login: restrict access with your network or reverse proxy when hosting privately. Keep the API and worker on the same protected SQLite storage and run them with a dedicated, unprivileged operating-system account. Use HTTPS for access from other devices.

Before sharing a branch, inspect both the working tree and Git history for credentials, personal paths, private hostnames, database files and identifying screenshots. `.gitignore` does not remove files already committed. If a real secret has been committed or shared, revoke or rotate it; deleting the text is insufficient.

Do not include tokens, push subscriptions, exact private locations or database contents in public bug reports. There is no public security-reporting address configured for this repository yet; contact the repository owner through a private channel available on its hosting service.

Third-party services have their own access and usage policies. Provider failures must remain explicit rather than substituting fixtures or relabeling stale data as fresh.

Android signing keys must stay outside the repository in a persistent protected store with a separate backup. APK public environment values are visible in the distributed bundle. The WebView stores its selected server and PWA preferences on the device; home-screen widgets cache modeled readings in app-private storage. Clearing app data or uninstalling removes these local settings. Native widgets do not provide background warning notifications.

Server backups include subscriptions and authentication state. Restoring older data can revive credentials or subscriptions revoked after the snapshot, and provider budgets omit later usage. Reconcile that history before restoring access or delivery; do not delete coordination storage to bypass limits. Browser installation credentials and local preferences are not recoverable from the server backup.
