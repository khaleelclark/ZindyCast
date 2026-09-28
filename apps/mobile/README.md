# ZindyCast Android

Native React Native/Expo client of the existing ZindyCast REST API. City search and explicit selection, on-device server/city/unit preferences, location-local Today/Tomorrow views, modeled current/feels-like, 48-hour detail, 7/10/14-day summaries from one source series, and independently loaded NWS official alerts. It never substitutes sample data for live responses. Missing fields stay missing. No account or Expo cloud build service is required.

## Configure and run

From the monorepo root (Node 22.22.1, npm workspaces; on the release host use `export PATH=/usr/bin:$PATH`):

```sh
npm ci --include=dev
cp apps/mobile/.env.example apps/mobile/.env
```

On first launch, use **Server settings** to enter your private HTTPS origin. It is saved only on the device. For a personal build, `EXPO_PUBLIC_API_BASE_URL` can optionally hold your real device-reachable HTTPS **origin** as a build-time default. Do not append `/api/v1`. This value is embedded in the bundle; never put secrets in it. The API must be reachable from the device, including its tailnet connection when applicable. The example file leaves this value blank so first launch opens server setup. Release configuration rejects HTTP, loopback/emulator addresses and reserved example/test placeholders. Connection failures explain how to check Tailscale and server settings. Do not bundle a private hostname in a distributable build.

For source development, start Metro in one terminal, then run the Android debug build in another:

```sh
npm run start --workspace @zindycast/mobile
```

```sh
npm run android --workspace @zindycast/mobile
```

`localhost` on a phone means the phone. Android emulator host access commonly uses `http://10.0.2.2:4311`; choose the actual API port. HTTP is for local debug development only; standalone release uses HTTPS with a trusted certificate. Use the existing API process or start it with the root `dev:api` command. This app needs GET `/api/v1/locations`, `/api/v1/forecast`, and `/api/v1/alerts`.

## Try the released app in Android Studio

1. Download **ZindyCast-Android-0.1.0-x86_64-emulator.apk** from Project files for an x86_64 emulator. The separately delivered **ZindyCast-Android-0.1.0-arm64.apk** is for an ARM64 phone or ARM64 emulator. An APK with the wrong native architecture will not install.
2. In Android Studio, open **Device Manager**, create a virtual phone with an Android API 36 system image matching the APK architecture, and start it. See Google's [Device Manager guide](https://developer.android.com/studio/run/managing-avds).
3. Drag the downloaded APK onto the running emulator window and open **ZindyCast** from its app list. Google's [APK install guide](https://developer.android.com/studio/run/emulator-install-add-files) shows this flow. Alternatively, run `adb devices` followed by `adb install -r path/to/ZindyCast-Android-0.1.0-x86_64-emulator.apk` in a terminal with Android SDK Platform Tools on `PATH`.
4. In **Server settings**, enter the exact private HTTPS **origin** used for the PWA: its scheme, hostname and port if present. Do not add `/api/v1`, a password, or an API key; example/test hostnames are rejected. If the server uses Tailscale, the **emulator** needs an authorized network path to it. Check that the emulator's browser can open the PWA address before trying city search. Then search for and select a city.

This is a standalone release build: Android Studio does not need to open the source project, and Metro/Expo Go need not run. The x86_64 APK is for emulator testing; use the ARM64 APK delivered in Project files when your phone arrives. If `adb` reports `INSTALL_FAILED_NO_MATCHING_ABIS`, check the emulator image architecture and use the matching APK. A debug build from Android Studio uses a different signing key; uninstalling an existing release app to install it clears saved app settings.

To edit or debug the source instead, run `npm ci --include=dev` and `npm run generate:android --workspace @zindycast/mobile` from the repo root, open `apps/mobile/android` in Android Studio, start Metro with `npm run start --workspace @zindycast/mobile`, and run the `app` configuration on the emulator. That debug build requires Metro while it runs.

## Local standalone APK

Install JDK 17 and Android SDK/command-line tools. This generated project uses Android API 36, Build Tools 36.0.0 (some modules also request 35.0.0), NDK 27.1.12297006 and CMake 3.22.1; minimum Android API is 24. Gradle can install missing SDK components when their licenses are already accepted. Set `ANDROID_HOME` to that SDK. From the repo root:

```sh
npm run generate:android --workspace @zindycast/mobile
# Supply these securely from the persistent signing-key store; never commit them:
# ZINDYCAST_ANDROID_KEYSTORE_PATH (absolute keystore path)
# ZINDYCAST_ANDROID_KEYSTORE_PASSWORD
# ZINDYCAST_ANDROID_KEY_ALIAS
# ZINDYCAST_ANDROID_KEY_PASSWORD
cd apps/mobile/android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

The source-controlled Expo signing plugin requires all four signing environment variables for release tasks and prevents fallback to the debug key. Generate and retain the private signing key outside this repository through the lead's release procedure. Losing it prevents updates to existing installations. Debug development builds remain available without it. A persistent-key-signed ARM64 APK was built and verified on September 28, 2026. Its checksum, package metadata and emulator evidence are recorded in `docs/verification/android-app-release/README.md`. Supply the same persistent signing key for future updates. `arm64-v8a` covers the named Pixel/Samsung phones; omit that Gradle flag for the default architecture set, including emulators. Native files are generated/ignored and can be recreated from app.json; do not store a signing key in source control. No EAS account needed. Change the server through in-app settings without rebuilding. A changed environment default requires rebuilding.

## Checks

```sh
npm run typecheck --workspace @zindycast/mobile
npm run test --workspace @zindycast/mobile
npm run build --workspace @zindycast/mobile
npm run verify:react --workspace @zindycast/mobile
```

`build` exports an Android Hermes/Metro bundle, not an APK. `generate:android` creates the native project without installing dependencies. Expo SDK 57.0.25's bundled dependency matrix supplies React 19.2.3 / RN 0.86.3; `metro.config.js` explicitly resolves `react` and every `react/*` subpath to mobile React 19.2.3 for all importers, including hoisted Expo/React Native. The web workspace keeps React 19.3.0. `verify:react` performs a clean Android source-map export and rejects any React module outside mobile's copy. Metro resolves `@zindycast/contracts` source directly.

Tests cover location identity, local dates at UTC midnight/DST, missing measurements, conversions, filtering expired/cancelled/future/test alerts, and invalid API configuration. Mobile and root typecheck, eight tests, prebuild, Android bundle export, and the existing web production build passed locally (web retains a MapLibre build warning). Signing-plugin transformation is idempotent; a Gradle release dry-run without signing variables failed with the intended explicit signing error after plugin prebuild. A signed universal APK was installed and launched in an Android 16 emulator; the configured private HTTPS API returned Austin city search, forecast and official alerts, and city/unit preferences survived force-stop/relaunch. Physical device interaction/installation has not been verified; check search, selected-city races, app return refresh, units after restart, offline/server failure, large text and scrolling on each target phone.

## Data behavior and remaining scope

Requests have a 20-second timeout and cancel on city change; previous-city results are hidden immediately. Forecast and alerts fail independently. Refreshes clear prior responses, so network failure shows unavailable rather than presenting old data as live. Preferences persist; weather responses do not. Pull to refresh, app foreground, and five-minute foreground checks reload both resources. Time labels use the selected city's timezone; current timestamps, retrieval, source issue time, classification, attribution and source grid are visible. Forecast responses are marked stale when the server says stale or retrieval is over 30 minutes old; alerts are marked old after five minutes. This is a retrieval-age check, not a claim about model issuance. Partial days show their available-hour count. Rain summaries are explicitly peak hourly probability, not a derived daily probability.

This first native slice has manual city selection; it does not yet request GPS permission, implement saved-city lists, maps, history/compare, heat policy/guidance, background push, or offline forecast storage. Official alerts are foreground only and do not replace official warning channels. The existing PWA remains separate and unchanged.
