# Android widgets — 0.1.4

Four native home-screen widgets: Feels like (temperature gauge), Air temperature, Outdoor WBGT and Together (combined). They use the existing ZindyCast sun-and-waves logo, cream backgrounds, soft green/amber/lilac metric cards, source labels and local valid times. Small widgets request 2×2 cells; Together requests 4×3. All are resizable within advertised minimum dimensions.

## Source and update behavior

Source-controlled Kotlin, layout and resource files live in `apps/mobile/widgets/`. `apps/mobile/plugins/with-widgets.cjs` copies them into the ignored native project, adds four nonexported receivers and a permission-protected refresh JobService, and registers a React Native package. The transform is idempotent and rejects unsupported application templates. Expo prebuild, Kotlin compilation and release lint passed. The normal `ACCESS_NETWORK_STATE` permission is required for the job’s network constraint and is persisted in app.json; it adds no runtime permission prompt. No dependency was added; the lockfile change only aligns the mobile workspace version with 0.1.4.

The shell observes the PWA's existing local preference writes and forwards the selected city and units through a first-party WebView message bridge. TypeScript validates the sender origin, server, units, coordinates, location schema and timezone; Kotlin validates configuration again. Changing city/server invalidates cached data and cancels the old job. Late responses are ignored if configuration changed. Returning to the app can request a refresh when the previous check is older than five minutes.

Widgets make one native HTTPS GET to the existing private forecast endpoint, with finite connect/read timeouts, a 1.5 MB response cap, redirects disabled and normal certificate validation. Receivers only render/schedule; network I/O runs in a cancellable Android JobService. A single job ID coalesces requests from all widgets. It requests network availability and finishes without automatic failure retries. Native data remains in app-private preferences. No JS runtime, map, animation, live location or notification delivery is used for widgets.

Readings are Open-Meteo modeled temperature/apparent temperature and the server's outdoor short-grass reference WBGT estimate. They do not substitute a nearby station's observed temperature. Current conditions must be less than 30 minutes old when selected; otherwise the eligible current hour is used. WBGT requires the corresponding hourly valid time, expected calculation policy/exposure, successful finite component diagnostics, fresh retrieval and a matching hour. Unit conversion preserves nulls. Current source timestamps are never replaced with fetch time. The WBGT widget uses its own hourly valid time; the combined card shows separate air/feels-like and WBGT valid times.

Cached air/feels-like values are labeled old and muted after expiry or an unsuccessful refresh. WBGT is suppressed after expiry, a failed check or malformed/misaligned diagnostics. The app can still display the weather context, original forecast attribution and source notices. NWS Tulsa colors are reference bands with exact endpoints shown at boundaries; no personalized risk categories, exposure timers or notifications were added. A rendered widget can remain on screen while Android delays its next callback; its As of timestamp remains visible.

Android periodically requests widget updates at a minimum 30-minute interval and can delay background work for power/network reasons. See [Android widget update guidance](https://developer.android.com/develop/ui/views/appwidgets/advanced). Tailscale and the private server must remain reachable. Refreshing does not force a provider refresh or bypass the server's existing cache.

## APK and static checks

The package is `family.zindycast.app`, version 0.1.4 / code 5, minimum API 24, target API 36. `apks.json` records exact final APK sizes and SHA-256 values. Both signed APKs contain `assets/index.android.bundle`; Metro is not required. `apksigner verify --print-certs` passed with certificate SHA-256 `cbc8cc0a16924d3f3cd4e0fd89c8138b8d14da9211bb1c85125164d8c06c4858`, matching the prior release identity.

- Root and mobile typechecks passed.
- Root web production build passed with the existing MapLibre dependency-expression warning.
- All 14 mobile tests passed, including first-party preference validation, invalid location/timezone/units/origin rejection, bridge reinjection and preserved preference storage.
- Final `assembleRelease --no-daemon` passed for ARM64 and x86_64; release lint passed.
- Native package-list registration was checked for idempotence and missing-template rejection.

## Emulator verification

Verified on an Android 16 / API 36 x86_64 emulator using the actual four RemoteViews in the standalone verification host. Live private-server readings appeared on all four widgets. Celsius and Fahrenheit changes propagated from the PWA, card taps opened the existing app, and the refresh PendingIntent completed a native weather job without a runtime crash. Changing the selected city from Austin to Honolulu replaced all four city labels and live readings, with Hawaii-local valid times. The previous 0.1.3 app was updated in place with the same signing key and retained its server; subsequent 0.1.4 rebuild updates retained the selected Austin city and units.

The native parser ran 13 deterministic Android-runtime assertions: null/zero preservation, Celsius/Fahrenheit conversion, fresh/expired snapshots, stale response handling, mismatched WBGT diagnostic time, location identity rejection and duplicate forecast-hour rejection. Fixture data is confined to assertions; screenshots show live modeled weather. `screenshots/widgets-fahrenheit.png` and `screenshots/widgets-celsius.png` record rendered values and separate valid times. These captures show a test widget host, not a physical phone or Samsung/Pixel launcher.

The first emulator run exposed a missing `ACCESS_NETWORK_STATE` permission; network-constrained jobs could not schedule. The final app.json/prebuild/manifest includes that normal permission, and the final installed APK completes its native refresh successfully. Temporary bridge diagnostics were removed; configuration failures retain a bounded generic log without names, coordinates, origins or response contents. The test-host bind permission command uses explicit `--user 0`: API 36's shell command mishandles `--user current` as user -2.

Physical-phone, manufacturer-launcher appearance, long-duration battery/Doze behavior and reboot/network-loss behavior are not claimed. Deterministic tests establish stale-value rules; this session does not establish actual background timing on the operator's phone.

`tools/WidgetHost.java` is a standalone local Android verification activity that binds and hosts the actual four RemoteViews. It is never included in ZindyCast. It also runs deterministic checks against the installed APK's actual Kotlin parser on Android, using fixture data only inside assertions. Build it with existing SDK/JDK tools:

```sh
ANDROID_HOME=/path/to/android-sdk bash docs/verification/android-widgets/tools/build-host.sh /tmp/zindycast-widget-host
adb install -r /path/to/ZindyCast-Android-0.1.4-x86_64-emulator.apk
adb install -r /tmp/zindycast-widget-host/widget-host.apk
adb shell appwidget grantbind --package family.zindycast.widgetcheck --user 0
adb shell am start -n family.zindycast.widgetcheck/.WidgetHost
adb logcat -d -s ZindyWidgetChecks:I
```

Open the weather app first and configure the real server/city. The verification host does not generate weather data or modify ZindyCast preferences. It deletes only its own widget host IDs when restarted. Physical-phone and launcher-specific behavior remain unverified until tested on the operator's device.

## Install and use

Install the ARM64 APK over the existing signed app. Open ZindyCast, select a city, then long-press your home screen → Widgets → ZindyCast. Drag a widget into place. All widgets follow the same current app selection and units; per-widget cities are not implemented. Tap a card to open the app, or ↻ to request refresh. The mobile README contains the full user/setup guide.
