# Provisioning artifacts

This directory is intentionally empty. Do not commit account data, Google packages, or downloaded APKs and modules.

Create these directories locally:

```text
artifacts/
├── apks/
│   ├── Google Photos and required user-supplied packages
│   └── PixelMask APK
└── modules/
    └── LSPosed Zygisk release ZIP
```

The selected Redroid image must already contain a working, licensed GApps installation and Magisk. The browser setup service automatically installs every APK and then every Magisk module in lexical order, enables Zygisk, and reboots Android. `bin/fairth-android provision artifacts` provides the same operation as a manual recovery command.

PixelMask's current package name is `com.kinginu.pixelmask`. In LSPosed Manager, enable it and scope it to both PixelMask itself and `com.google.android.apps.photos`, as required by PixelMask's own instructions.
