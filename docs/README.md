# ZindyCast documentation

Reviewed October 11, 2026. These entry points describe the current application; use the dated reports as evidence for their tested revision.

| Task | Guide |
| --- | --- |
| Install or develop locally; configure Docker | [Root README](../README.md) |
| Understand delivered scope and remaining acceptance checks | [Current status](status.md) |
| Operate the private server, update, back up or restore | [Production operations](operations/README.md) |
| Adapt systemd units and configure optional Web Push | [Deployment templates](../deploy/README.md) |
| Install Android 0.1.4, add widgets or build a signed APK | [Android guide](../apps/mobile/README.md) |
| Protect configuration, data and shared evidence | [Security](../SECURITY.md) |
| Find release and test evidence | [Verification index](verification/README.md) |
| Review scientific and architecture choices | [Decision records](decisions/) |
| Review original sources and retained samples | [Research](research/) |

The [original implementation plan](implementation-plan.md), [research ledger](research/status.md), [early implementation journal](verification/implementation-status.md) and [deployment preparation](operations/preparation-2026-09-11.md) preserve earlier phase instructions. Their pre-DEVELOP, pending-deployment and feature-state statements are historical; the current guides above supersede them for operation. Decision records may contain an initial proposal followed by a later accepted change; read their revisions with [current status](status.md).

Private HTTPS origins, credentials and runtime paths belong in protected local configuration. `weather.example.invalid` and other example addresses are placeholders. APKs are downloaded from Project files; release hashes and verification limits are recorded in the Android reports. Historical screenshots excluded from Git for privacy may be present only in the original workspace. The retained LibreWXR upstream README is a third-party source snapshot whose relative links refer to its own repository.

When updating a release, update root/Android setup, current status, operations/configuration where affected, and the corresponding verification record together. Preserve measured results and scientific sources; add a dated superseding note rather than rewriting old results as new verification. Keep production commands aligned with scripts, environment templates and the actual UI labels.

Documentation validation is described in the [October documentation audit](verification/documentation/README.md).
