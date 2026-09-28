# First Android APK — September 28, 2026

## Delivered artifact

The Project file **ZindyCast-Android-0.1.0-arm64.apk** is the directly installable ARM64 release APK. It is 26,721,207 bytes, SHA-256 `71ec68bdec11ed13c88378c71e86afa572818b1adf16714bba070c0df3c44e72`. Its Android package is `family.zindycast.app`, version name `0.1.0`, version code `1`, minimum API 24 and target/compile API 36. The APK contains only `arm64-v8a` native libraries, appropriate for the intended modern Pixel and Samsung phones. It is not an Expo Go or Metro-dependent development build.

The APK was built locally with `apps/mobile/android/gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a` after Expo prebuild. Release signing used a persistent keystore outside git; the source-controlled config plugin fails release tasks without the four signing environment variables. Android `apksigner verify` passed APK Signature Scheme v2 with one signer. The signer certificate SHA-256 is `cbc8cc0a16924d3f3cd4e0fd89c8138b8d14da9211bb1c85125164d8c06c4858`, matching the retained keystore. `aapt` reports only Internet access plus Android's application-scoped dynamic receiver permission; unnecessary template storage, overlay and vibration permissions were blocked in Expo config. No private API hostname, provider key or signing key is bundled.

## Emulator and service check

The same source and key also produced a signed universal APK (70,013,922 bytes, SHA-256 `8785527f83ca66a6c23635ba2e3914ee01c554b6883d1bb5ee2cd75f58a1c508`) for an Android 16 / API 36 x86_64 emulator. `adb install -r` succeeded; the app launched without Metro or Expo Go and had no React Native or Android runtime crash in the launch log. The first-launch HTTPS server setup screen rendered legibly. With the existing authorized private HTTPS API configured at runtime, city search returned distinguishable Austin locations; selecting Austin, Texas loaded a modeled current forecast, Today/feels-like/high/low/hourly rain values and an independent NWS alert response. The app displayed the selected `America/Chicago` local date/time. City, server and metric-unit choices survived force-stop and relaunch.

This check made bounded live requests to the already configured private API. It did not change server settings, register an installation, send a notification or call providers directly from the Android client. The universal emulator APK is not the Project file delivered for ARM64 phones; the ARM64 APK's signature, package metadata and native architecture were checked separately.

## Repository checks

- `npm run typecheck`: passed after mobile integration.
- `npm test`: 484 total, 479 passed, five existing opt-in browser tests skipped, zero failed.
- `npm run test --workspace @zindycast/mobile`: eight focused tests passed (location/timezone, missingness/conversion, alert filtering, HTTPS origin validation and connection errors).
- `npm run generate:android --workspace @zindycast/mobile`: passed with the release signing plugin applied.
- `npm run verify:react --workspace @zindycast/mobile`: Android Metro export passed; source-map check found one mobile React 19.2.3 instance despite the web workspace's separate React version.
- Signed ARM64 and universal `assembleRelease`: passed. Android bundle was embedded in release output.
- Existing PWA `npm run build`: passed after dependency integration; the existing MapLibre dynamic dependency warning remains.

The source files are in `apps/mobile`; generated native files, build output and signing credentials are excluded from git. The PWA is still in `apps/web` and continues to build independently.

## Install and remaining checks

Download **ZindyCast-Android-0.1.0-arm64.apk** from Project files to an ARM64 Android phone. Open it and allow installation from the app used to open the file if Android asks. Launch ZindyCast, enter the existing private HTTPS weather origin under **Server settings** (include its port if present), connect Tailscale if the server is private, then search and select a city. No Play Store account is required.

A physical phone install, private HTTPS connectivity from that phone, large-font/touch behavior and an in-place higher-version update still need device verification. The first native release does not yet include GPS, saved-city lists, radar/maps, history/comparisons, heat guidance, offline forecast storage or native background notifications. The existing browser Web Push subscription cannot be reused as an Android push token; official alerts in this APK are fetched only while the app is open.
