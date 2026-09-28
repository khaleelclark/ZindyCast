# Android PWA visual parity — version 0.1.2

The 0.1.0 Android screen was an independent native weather layout and did not match the approved mobile PWA. Version 0.1.2 replaces that screen with the existing PWA rendered inside Android WebView. The web source in `apps/web` remains independently usable and was not changed for this correction. The native shell handles HTTPS server setup, same-origin navigation, external links and one-time migration of the earlier APK's selected city and units. The configured origin must serve the PWA and its API.

## Signed deliverables

| Project file | Native architecture | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `ZindyCast-Android-0.1.2-x86_64-emulator.apk` | x86_64 | 27,454,241 | `3f983f66fd20c0ebfd9c12f81f14173194ff78a38c6f102f8a96759868c9019b` |
| `ZindyCast-Android-0.1.2-arm64.apk` | arm64-v8a | 27,025,526 | `d7b61e620e9318c2be49855799e670ed053a0f1df5c4f38676848157e1d48fe9` |

Both report package `family.zindycast.app`, version `0.1.2`, version code `3`, minimum API 24 and target API 36. `apksigner verify` passed for both. Their signer certificate SHA-256 is `cbc8cc0a16924d3f3cd4e0fd89c8138b8d14da9211bb1c85125164d8c06c4858`, the same persistent signing identity as version 0.1.0. The embedded Hermes bundles are byte-identical between architectures. The manifest includes coarse and fine location permissions for WebView's permission prompt. No private server hostname or signing key was bundled.

## Checks performed

- `npm run typecheck` and the existing PWA `npm run build` passed; the web build retained its pre-existing MapLibre dynamic-dependency warning.
- `npm run test --workspace @zindycast/mobile`: 11 tests passed, including legacy preference migration and fallback when Android's early WebView injection misses a load.
- `npm run verify:react --workspace @zindycast/mobile`: Metro export passed with one mobile React copy.
- Expo Android prebuild and signed Gradle `assembleRelease` passed for both architectures.
- The signed x86_64 APK installed with `adb install -r` over the earlier release on an Android 16 / API 36 emulator and launched without Metro or Expo Go. It loaded the existing private HTTPS PWA, retained the earlier Austin city and metric units, displayed the PWA's Today navigation and current conditions, and showed the WBGT value with its always-visible colored band graph. The top status-bar text is legible.
- After clearing emulator app data, the fresh server setup loaded the PWA. City search selected Austin and loaded live forecast and station data. Tapping **Use my location** opened Android's location permission prompt; permission was granted, but the emulator did not return a position before the PWA's timeout. A successful physical-device GPS fix is unverified.
- Emulator captures are in Project files as `ZindyCast-Android-0.1.2-emulator-top.png` and `ZindyCast-Android-0.1.2-emulator-wbgt.png`.

The ARM64 artifact was signature, metadata, architecture and bundle-identity checked; it was not installed on a physical phone. Browser Web Push does not become native Android background notifications. GPS fixes, downloads, service-worker/offline behavior, detailed navigation and accessibility still need WebView and physical-device checks before claiming parity with Chrome. The visual match follows from rendering the same PWA source, while these platform behaviors may differ.
