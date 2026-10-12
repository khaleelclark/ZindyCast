# ZindyCast Android 0.1.4

Signed standalone APKs, version code **5**, package `family.zindycast.app`. Includes the ZindyCast launcher/startup artwork and all four home-screen widgets.

| Download | Use | Bytes |
| --- | --- | --- |
| [ARM64 phone APK](ZindyCast-Android-0.1.4-arm64.apk) | ARM64 Android phone | 27,109,838 |
| [x86_64 emulator APK](ZindyCast-Android-0.1.4-x86_64-emulator.apk) | x86_64 Android Studio emulator | 27,538,553 |

On GitHub, open the APK link and select **Download raw file**. Both binaries are also available as Project-file downloads. Install over the prior signed release to retain settings. A differently signed debug installation may need uninstalling first, which clears its data. Minimum Android API 24; target API 36. Metro and Expo Go are not required. Private-server access requires Tailscale connectivity.

These are the exact binaries identified by the original [widget release manifest](../../../docs/verification/android-widgets/apks.json). On October 12, 2026, both SHA-256 values and sizes were verified against that manifest; `apksigner verify --print-certs` passed for both, and package/version, architecture, widget support and bundled JavaScript were checked. The emulator binary was recreated from the unchanged release source and matches the original checksum exactly. Signing-certificate SHA-256: `cbc8cc0a16924d3f3cd4e0fd89c8138b8d14da9211bb1c85125164d8c06c4858`.

Verify downloaded files from this directory:

```sh
sha256sum -c SHA256SUMS
```

See [checksums](SHA256SUMS), [installation and widget instructions](../../../apps/mobile/README.md), and [release evidence and device-testing limits](../../../docs/verification/android-widgets/README.md). Physical-phone testing was not repeated for this packaging update. Web UI changes are delivered by the server separately from native APK updates.
