# Android logo update — version 0.1.3

The 0.1.2 Android package used Expo's default launcher and startup artwork. Version 0.1.3 uses the existing PWA sun-and-waves artwork for the Android launcher icon, adaptive icon, optional themed monochrome icon, and startup screen. The PWA and Android WebView content are otherwise unchanged by this release.

## Signed APKs

| Project file | Architecture | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `ZindyCast-Android-0.1.3-arm64.apk` | arm64-v8a phone | 27,044,810 | `b73f21eb5ac9cf1e2fabca1d7e914fc14df3ffc2f53e54a048f5672c9fa93ec9` |
| `ZindyCast-Android-0.1.3-x86_64-emulator.apk` | x86_64 emulator | 27,473,525 | `8f0e34ba36b7d1e7965cc100de284e2285ba9ce8d82cfe7f0252bb603093ccd5` |

Both APKs report Android package `family.zindycast.app`, version name `0.1.3`, version code `4`, minimum API 24, and target API 36. `apksigner verify --print-certs` passed with signer certificate SHA-256 `cbc8cc0a16924d3f3cd4e0fd89c8138b8d14da9211bb1c85125164d8c06c4858`, matching the 0.1.2 release identity. Both include `assets/index.android.bundle`, so the standalone APKs do not require Metro.

## Source and checks

- `apps/mobile/assets/icon.png` is a 1024 px rendering of the existing `apps/web/public/icon.svg`. The transparent adaptive and startup artwork copies the same central sun and waves from `apps/web/public/icon-maskable.svg`; `logo-foreground.svg` records that source geometry. The monochrome variant supplies Android themed icons.
- Expo prebuild produced launcher foreground and monochrome mipmaps, a `#234e47` adaptive background, and a sun-and-waves splash drawable on the same green background. The previous generic Expo splash drawable was removed by regeneration.
- Mobile typecheck passed; all 11 mobile tests passed. `assembleRelease --no-daemon` passed for ARM64 and x86_64 with the persistent release key stored outside git.
- The x86_64 APK installed and opened on an Android 16 emulator. The launcher app drawer displayed the ZindyCast sun-and-waves icon; the capture is in Project files as `ZindyCast-Android-0.1.3-launcher.png`. The app reached first-launch server setup without Metro.
- The ARM64 APK has not been installed on a physical phone here. Launcher appearance and in-place update on the operator's phone still need a device check.

Install the ARM64 Project file on an Android phone. Its higher version code and matching signing identity allow updating the prior signed 0.1.2 app while retaining settings. An Android Studio debug build uses a different signing identity and cannot be updated in place with this release APK.
