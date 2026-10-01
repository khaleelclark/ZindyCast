# ZindyCast Android

Version 0.1.3 is an installable React Native/Expo Android shell that displays the existing mobile PWA in Android WebView. The Today/Tomorrow layout, radar, visible WBGT band graph, maps, history, comparisons and settings therefore use the same web UI and server logic as the PWA. The shell supplies private HTTPS server setup, external-link handling and migration of the previous Android build's selected city and units. The PWA remains independently installable in a browser. The launcher icon, themed icon, and startup screen use the same ZindyCast sun-and-waves mark as the PWA. No Expo cloud build service is required.

## Configure and run

From the monorepo root (Node 22.22.1, npm workspaces; on the release host use `export PATH=/usr/bin:$PATH`):

```sh
npm ci --include=dev
cp apps/mobile/.env.example apps/mobile/.env
```

On first launch, enter your private HTTPS origin. It is saved on the device; the shell loads the PWA from that address. Press Android Back from the PWA's main screen to reopen server settings. For a personal build, `EXPO_PUBLIC_API_BASE_URL` can optionally hold your real device-reachable HTTPS **origin** as a build-time default. Do not append `/api/v1`. This value is embedded in the bundle; never put secrets in it. The server must be reachable from the device, including its tailnet connection when applicable. The example file leaves this value blank so first launch opens setup. Release configuration rejects HTTP, loopback/emulator addresses and reserved example/test placeholders. Do not bundle a private hostname in a distributable build.

For source development, start Metro in one terminal, then run the Android debug build in another:

```sh
npm run start --workspace @zindycast/mobile
```

```sh
npm run android --workspace @zindycast/mobile
```

`localhost` on a phone means the phone. Android emulator host access commonly uses `http://10.0.2.2:4311`; choose the actual API port. HTTP is for local debug development only; standalone release uses HTTPS with a trusted certificate. The configured origin must serve the built PWA and its `/api/v1` routes, not just the API. The PWA makes same-origin requests as it does in a browser.

## Try the released app in Android Studio

1. Download the current **ZindyCast-Android-0.1.3-x86_64-emulator.apk** from Project files for an x86_64 emulator. The separate **ZindyCast-Android-0.1.3-arm64.apk** is for an ARM64 phone or emulator. The older 0.1.0 APKs show the superseded native layout; 0.1.2 has the PWA layout but the default Android icon. An APK with the wrong native architecture will not install.
2. In Android Studio, open **Device Manager**, create a virtual phone with an Android API 36 system image matching the APK architecture, and start it. See Google's [Device Manager guide](https://developer.android.com/studio/run/managing-avds).
3. Drag the downloaded APK onto the running emulator window and open **ZindyCast** from its app list. Google's [APK install guide](https://developer.android.com/studio/run/emulator-install-add-files) shows this flow. Alternatively, run `adb devices` followed by `adb install -r path/to/ZindyCast-Android-0.1.3-x86_64-emulator.apk` in a terminal with Android SDK Platform Tools on `PATH`.
4. On first launch, enter the exact private HTTPS **origin** used for the PWA: its scheme, hostname and port if present. Do not add `/api/v1`, a password, or an API key; example/test hostnames are rejected. If the server uses Tailscale, the **emulator** needs an authorized network path to it. Check that the emulator's browser can open the PWA address before opening the APK. Then use the same Today/Maps/History/Compare/Settings interface you see in the mobile browser.

This is a standalone release build: Android Studio does not need to open the source project, and Metro/Expo Go need not run. The x86_64 APK is for emulator testing; use the ARM64 APK on a physical phone. Both 0.1.3 APKs use the same persistent signing key and higher version code as 0.1.0, so `adb install -r` updates the prior release while retaining app data. If `adb` reports `INSTALL_FAILED_NO_MATCHING_ABIS`, use the matching APK. A debug build from Android Studio uses a different signing key; uninstalling a release app to install it clears saved settings.

## Debug the source in Android Studio

Use Node 22 and JDK 17. On macOS, Android Studio launched from the Dock may have a different `PATH` from your terminal; make sure the Studio process can find Node 22 before syncing or building. Open **`apps/mobile/android`**, not the repository root, as the Android Studio project. From the repository root, install dependencies and generate the native project:

```sh
npm ci --include=dev
npm run generate:android --workspace @zindycast/mobile
```

In Android Studio's Gradle settings, select JDK 17. If Studio created `apps/mobile/android/gradle/gradle-daemon-jvm.properties`, check that it says `toolchainVersion=17`; a daemon JVM criterion takes precedence over `JAVA_HOME` and the Gradle JDK setting. Change an incorrect value (such as 25) to 17, then sync again. The generated `android/` directory is ignored and can be regenerated.

Start the emulator. In one terminal, start Metro with an IPv4 loopback address:

```sh
npm run start:emulator --workspace @zindycast/mobile
```

In another terminal, forward the emulator's port 8081 to Metro on the host, then run the Android Studio `app` configuration:

```sh
adb devices
adb reverse tcp:8081 tcp:8081
```

Keep Metro running while using the debug app, including on a USB-connected phone. If it shows **Unable to load script**, confirm `adb devices` lists the device, repeat `adb reverse tcp:8081 tcp:8081`, and check that Metro reports an Android bundle. Avoid `expo start --localhost` for this emulator setup: on macOS it can listen only on IPv6 `::1`, while the emulator's forwarded connection uses IPv4. This Metro setup is only for source debugging; the signed release APK above contains its own JavaScript bundle and does not need Metro.

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

The source-controlled Expo signing plugin requires all four signing environment variables for release tasks and prevents fallback to the debug key. Generate and retain the private signing key outside this repository through the lead's release procedure. Losing it prevents updates to existing installations. The 0.1.0 release record is in `docs/verification/android-app-release/README.md`; the 0.1.2 visual correction is recorded in `docs/verification/android-pwa-parity/README.md`; the 0.1.3 icon update is recorded in `docs/verification/android-icon-release/README.md`. Supply the same persistent signing key for future updates. Build with `-PreactNativeArchitectures=x86_64` for a smaller emulator APK. Native files are generated/ignored and can be recreated from app.json; do not store a signing key in source control. No EAS account needed. Change the server in the app without rebuilding. A changed environment default requires rebuilding.

## Checks

```sh
npm run typecheck --workspace @zindycast/mobile
npm run test --workspace @zindycast/mobile
npm run build --workspace @zindycast/mobile
npm run verify:react --workspace @zindycast/mobile
```

`build` exports an Android Hermes/Metro bundle, not an APK. `generate:android` creates the native project without installing dependencies. Expo SDK 57.0.25's bundled dependency matrix supplies React 19.2.3 / RN 0.86.3; `metro.config.js` explicitly resolves `react` and every `react/*` subpath to mobile React 19.2.3 for all importers, including hoisted Expo/React Native. The web workspace keeps React 19.3.0. `verify:react` performs a clean Android source-map export and rejects any React module outside mobile's copy. Metro resolves `@zindycast/contracts` source directly.

The 0.1.3 checks cover native-to-PWA preference migration, server validation, React singleton resolution, bundle export, signed APK construction and Android emulator launch. Mobile typecheck and all 11 mobile tests pass; the web build retains its existing MapLibre warning. See the versioned verification records for exact evidence. Physical phone installation is still pending.

## Data behavior and remaining scope

The Android shell loads the deployed PWA. Web UI fixes can arrive without installing another APK: reopen ZindyCast with the private server reachable and tap **Update** when the web app offers it. The update saves city, units and other PWA preferences before reloading. APK updates are still needed for native changes such as the launcher logo. The October 1 pull-to-refresh fixes are available on the private server; browser delivery/update evidence is in `docs/verification/mobile-ux/review.md`. Physical-phone performance has not been verified here.

The web UI owns weather retrieval, freshness, source labels and layout. WebView keeps its own browser storage for PWA preferences; the first 0.1.2 launch seeds it with the earlier native build's city and units if no web preferences exist. The server origin remains in native device storage. The shell opens external links in the device browser and shows retry/server controls if the PWA cannot load.

PWA features shown inside WebView require the configured server and network access. Browser Web Push subscriptions do not become native Android background notifications. Tapping **Use my location** now opens Android's location permission prompt, but a successful GPS fix was not established on the emulator. Downloads, service worker/offline behavior and WebView-specific permissions need separate device checks before being claimed equivalent to Chrome. Official alerts shown in the PWA are foreground information; retain independent warning channels. The browser PWA remains available unchanged.
