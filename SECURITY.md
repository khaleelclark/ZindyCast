# Security and private configuration

Keep `.env`, `apps/web/.env.local`, runtime databases, backups, private keys and service environment files out of Git. Example environment files must contain placeholders only. Browser `PUBLIC_` values are distributed to every visitor and must never contain private credentials.

The API validates its configured host and origin. This is not a user login: restrict access with your network or reverse proxy when hosting privately. Keep the API and worker on the same protected SQLite storage and run them with a dedicated, unprivileged operating-system account. Use HTTPS for access from other devices.

Before sharing a branch, inspect both the working tree and Git history for credentials, personal paths, private hostnames, database files and identifying screenshots. `.gitignore` does not remove files already committed. If a real secret has been committed or shared, revoke or rotate it; deleting the text is insufficient.

Do not include tokens, push subscriptions, exact private locations or database contents in public bug reports. There is no public security-reporting address configured for this repository yet; contact the repository owner through a private channel available on its hosting service.

Third-party services have their own access and usage policies. Provider failures must remain explicit rather than substituting fixtures or relabeling stale data as fresh.
