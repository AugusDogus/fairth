# Provisioning artifacts

This directory is intentionally empty. Do not commit account data, Google packages, or downloaded APKs and modules.

Create these directories locally:

```text
artifacts/
├── apks/
│   └── PixelMask and other additional APKs
└── modules/
    └── LSPosed Zygisk release ZIP
```

The selected Redroid image must already contain a working, licensed GApps installation, Google Photos, and Magisk. The included Fairth image builder adds Google Photos from OpenGApps. The Android worker automatically installs every additional APK and then every Magisk module in lexical order, enables Zygisk, and reboots Android. Run `bin/fairth-android reconcile` to retry automatic provisioning after changing the artifacts.

PixelMask's current package name is `com.kinginu.pixelmask`. After installation, Fairth enables it in LSPosed, scopes it to PixelMask and `com.google.android.apps.photos`, restarts Android, and verifies those rows. The worker changes only PixelMask's LSPosed module and scope records.
