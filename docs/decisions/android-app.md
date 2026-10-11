# Android app in the ZindyCast workspace

Current revision: October 11, 2026. The initial native layout below was superseded in 0.1.2 by the existing PWA rendered in Android WebView. Version 0.1.3 added the ZindyCast launcher/startup artwork; **0.1.4 / code 5** adds four native home-screen widgets. See the [current Android guide](../../apps/mobile/README.md) and [widget release evidence](../verification/android-widgets/README.md).

Decision date: September 28, 2026. The operator authorized an Android app in the existing repository and requested a directly installable APK. The PWA remains in `apps/web`; the Android app lives in `apps/mobile` and uses the existing REST API and shared weather contracts.

## Build and distribution

- Use Expo/React Native with npm workspaces. Pin the Expo-compatible React Native and React versions in the mobile workspace; the web app keeps its own dependency versions.
- Produce a standalone **release APK** with a persistent signing key. A debug APK that requires Metro is not the requested deliverable.
- Keep the signing key, passwords, private API address, and device settings outside git. Losing the signing key prevents updates to an installed APK under the same Android package name.
- No Play Store account or cloud build account is needed for a direct APK. Publishing to a store is a separate decision.

## Runtime boundary

The WebView loads the deployed PWA and its same-origin API over HTTPS. The deployed service is private through Tailscale Serve, so a phone must have tailnet access and the app makes the server origin configurable. It must not bundle a private hostname, credentials, or provider keys. The native widgets request the existing forecast endpoint, preserve schema validation, source attribution, freshness, missing values, requested location identity and time zone semantics, and use modeled values rather than substituting station observations.

The initial 0.1.0 APK supplied a native Today/Tomorrow view. The current WebView boundary shares Today, Maps, History, Compare and Settings with the PWA, including web-delivered performance fixes. Native APK updates are required for shell, icon and widget changes. Browser Web Push does not supply native Android background notifications. Emulator checks do not establish physical-device or manufacturer-launcher acceptance.

References: [Expo SDK compatibility](https://docs.expo.dev/versions/latest/), [Expo monorepo support](https://docs.expo.dev/guides/monorepos/), [Expo local Android release builds](https://docs.expo.dev/guides/local-app-production/), [APK format and installation](https://docs.expo.dev/build-reference/apk/).
