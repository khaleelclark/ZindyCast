# Android app in the ZindyCast workspace

Decision date: September 28, 2026. The operator authorized an Android app in the existing repository and requested a directly installable APK. The PWA remains in `apps/web`; the Android app lives in `apps/mobile` and uses the existing REST API and shared weather contracts.

## Build and distribution

- Use Expo/React Native with npm workspaces. Pin the Expo-compatible React Native and React versions in the mobile workspace; the web app keeps its own dependency versions.
- Produce a standalone **release APK** with a persistent signing key. A debug APK that requires Metro is not the requested deliverable.
- Keep the signing key, passwords, private API address, and device settings outside git. Losing the signing key prevents updates to an installed APK under the same Android package name.
- No Play Store account or cloud build account is needed for a direct APK. Publishing to a store is a separate decision.

## Runtime boundary

The app calls the existing API over HTTPS. The deployed service is private through Tailscale Serve, so a phone must have tailnet access and the app must make the API address configurable. It must not bundle a private hostname, credentials, or provider keys. Native requests preserve schema validation, source attribution, freshness, missing values, requested location identity, and time zone semantics.

The first APK must establish a reliable native Today/Tomorrow experience, location selection, hourly weather, official alerts, and unit preferences. Additional PWA sections can then be ported without replacing the PWA or adding new provider calls from the phone.

References: [Expo SDK compatibility](https://docs.expo.dev/versions/latest/), [Expo monorepo support](https://docs.expo.dev/guides/monorepos/), [Expo local Android release builds](https://docs.expo.dev/guides/local-app-production/), [APK format and installation](https://docs.expo.dev/build-reference/apk/).
